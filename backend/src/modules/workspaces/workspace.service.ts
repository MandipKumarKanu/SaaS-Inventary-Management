import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../config/logger.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '../../services/config.service.js';

// Phase 7b: default role bundles come from the role_templates TABLE (seeded
// by run-migrations from ROLE_TEMPLATE_SEED) — no hardcoded role→permission
// record lives in application source anymore.

interface CreateWorkspaceParams {
  name: string;
  slug?: string;
  currency?: string;
  userId: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  NPR: 'रू',
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  AED: 'AED',
  SGD: 'S$',
  JPY: '¥',
};

export class WorkspaceService {
  /**
   * Create a new workspace with full initialization:
   * 1. Create workspace
   * 2. Create owner membership
   * 3. Create default roles with permissions
   * 4. Assign Owner role to creator
   * 5. Create trial subscription
   * 6. Initialize usage tracking
   */
  static async create(params: CreateWorkspaceParams) {
    const { name, userId, currency = 'NPR' } = params;
    const baseCurrency = (currency || 'NPR').toUpperCase();
    const symbol = CURRENCY_SYMBOLS[baseCurrency] || '$';

    // Generate slug from name if not provided
    const slug = params.slug || this.generateSlug(name);

    // Check slug uniqueness
    const { data: existing } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      throw AppError.conflict('A workspace with this slug already exists', 'SLUG_EXISTS');
    }

    // Ensure user profile exists in public.users table before creating workspace
    const { data: userProfile } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!userProfile) {
      let email = 'user@example.com';
      let name = 'User';
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (authUser?.user) {
          email = authUser.user.email?.toLowerCase() || email;
          name = authUser.user.user_metadata?.name || authUser.user.email?.split('@')[0] || name;
        }
      } catch (err: any) {
        logger.warn('Failed to fetch user from Supabase auth', { error: err?.message, userId });
      }

      const { error: upsertErr } = await supabaseAdmin.from('users').upsert(
        {
          id: userId,
          email,
          name,
          status: 'active',
        },
        { onConflict: 'id' }
      );
      if (upsertErr) {
        logger.error('Failed to ensure user profile before workspace creation', { error: upsertErr.message, userId });
      }
    }

    // 1. Create workspace
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name,
        slug,
        created_by: userId,
        settings: {
          currency: baseCurrency,
          default_currency: baseCurrency,
          currency_symbol: symbol,
        },
      })
      .select()
      .single();

    if (wsError || !workspace) {
      logger.error('Failed to create workspace', { error: wsError?.message });
      throw AppError.internal(wsError?.message || 'Failed to create workspace');
    }

    // Seed base currency rate row
    try {
      await supabaseAdmin
        .from('currency_rates')
        .insert({
          workspace_id: workspace.id,
          currency_code: baseCurrency,
          symbol: symbol,
          exchange_rate: 1.0,
        });
    } catch (err: any) {
      logger.warn('Failed to seed base currency rate', { error: err?.message });
    }

    try {

      // 2. Create owner membership
      const { data: member, error: memberError } = await supabaseAdmin
        .from('workspace_members')
        .insert({
          user_id: userId,
          workspace_id: workspace.id,
          status: 'active',
        })
        .select()
        .single();

      if (memberError || !member) throw new Error(`Membership failed: ${memberError?.message}`);

      // 3. Create default roles with permissions
      const ownerRoleId = await this.createDefaultRoles(workspace.id);

      // 4. Assign Owner role to creator
      if (ownerRoleId) {
        await supabaseAdmin.from('member_roles').insert({
          member_id: member.id,
          role_id: ownerRoleId,
        });
      }

      // 5. Create trial subscription — plan tier + trial length from config
      // (config_defaults table → env fallback), never hardcoded tier names.
      const defaultTier = await ConfigService.getOr<string>('default_plan_tier', 'free');
      const trialDays = await ConfigService.getOr<number>('trial_days', 14);

      const { data: starterPlan } = await supabaseAdmin
        .from('subscription_plans')
        .select('id, limits')
        .eq('name', defaultTier)
        .maybeSingle();

      if (starterPlan) {
        await supabaseAdmin.from('subscriptions').insert({
          workspace_id: workspace.id,
          plan_id: starterPlan.id,
          status: 'trialing',
          trial_ends_at: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString(),
        });

        // 6. Initialize usage tracking — limits come straight from the plan
        // row's limits JSONB. No `|| 2` style fallbacks: a plan with a missing
        // metric gets limit_value 0 (deny-by-default), never a magic number.
        const limits = (starterPlan.limits as Record<string, number>) || {};
        const usageMetrics = ['users', 'products', 'warehouses'].map((metric) => ({
          metric,
          limit_value: typeof limits[metric] === 'number' ? limits[metric] : 0,
        }));

        await supabaseAdmin.from('usage_records').insert(
          usageMetrics.map(m => ({
            workspace_id: workspace.id,
            metric: m.metric,
            current_value: m.metric === 'users' ? 1 : 0, // Creator counts as 1 user
            limit_value: m.limit_value,
          }))
        );
      } else {
        logger.warn('Default plan tier not found in subscription_plans — workspace created without a subscription', { tier: defaultTier });
      }

      // Audit
      await AuditService.log({
        workspaceId: workspace.id,
        userId,
        action: 'workspace.created',
        entity: 'workspace',
        entityId: workspace.id,
        newValue: { name, slug },
      });

      return workspace;
    } catch (err: any) {
      // Rollback: delete workspace (cascades members, roles, etc.)
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      logger.error('Workspace creation rollback', { error: err.message });
      throw AppError.internal(err.message || 'Failed to create workspace');
    }
  }

  /**
   * Create default roles for a workspace FROM THE role_templates TABLE
   * (Phase 7b). Returns the owner role id (template with is_owner = TRUE).
   * Empty/missing templates = no default roles (deployments configure their
   * own bundles); the workspace still works — roles are manageable via API.
   */
  private static async createDefaultRoles(workspaceId: string): Promise<string | null> {
    const { data: templates, error: tplError } = await supabaseAdmin
      .from('role_templates')
      .select('name, description, is_owner, permissions')
      .order('sort_order', { ascending: true });

    if (tplError) {
      logger.error('Failed to load role_templates', { error: tplError.message });
      return null;
    }
    if (!templates || templates.length === 0) {
      logger.warn('No role_templates configured — skipping default role creation', { workspaceId });
      return null;
    }

    let ownerRoleId: string | null = null;

    for (const tpl of templates) {
      const { data: role, error: roleError } = await supabaseAdmin
        .from('roles')
        .insert({
          workspace_id: workspaceId,
          name: tpl.name,
          description: tpl.description || `Default ${tpl.name} role`,
          is_system: true,
        })
        .select()
        .single();

      if (roleError || !role) {
        logger.error(`Failed to create role: ${tpl.name}`, { error: roleError?.message });
        continue;
      }

      if (tpl.is_owner) {
        ownerRoleId = role.id;
      }

      // Assign permissions to role
      const permCodes: string[] = tpl.permissions || [];
      if (permCodes.length > 0) {
        // Look up permission IDs
        const { data: perms } = await supabaseAdmin
          .from('permissions')
          .select('id, code')
          .in('code', permCodes);

        if (perms && perms.length > 0) {
          await supabaseAdmin.from('role_permissions').insert(
            perms.map(p => ({ role_id: role.id, permission_id: p.id }))
          );
        }
      }
    }

    return ownerRoleId;
  }

  /**
   * List workspaces for a user
   */
  static async listForUser(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        workspace:workspaces(id, name, slug, logo_url, status, created_at),
        status,
        joined_at
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      logger.error('Failed to list workspaces', { error: error.message });
      throw AppError.internal('Failed to list workspaces');
    }

    return (data || [])
      .map(d => ({ ...d.workspace as any, membership_status: d.status, joined_at: d.joined_at }))
      .filter(w => w.id); // Filter out nulls
  }

  /**
   * Get workspace by ID or slug
   */
  static async getByIdOrSlug(idOrSlug: string) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .select('*')
      .eq(isUUID ? 'id' : 'slug', idOrSlug)
      .single();

    if (error || !data) {
      throw AppError.notFound('Workspace not found');
    }

    return data;
  }

  /**
   * Update workspace
   */
  static async update(workspaceId: string, userId: string, updates: Record<string, any>) {
    const { data: current } = await supabaseAdmin
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single();

    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId)
      .select()
      .single();

    if (error) {
      throw AppError.internal('Failed to update workspace');
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: 'workspace.updated',
      entity: 'workspace',
      entityId: workspaceId,
      previousValue: current,
      newValue: updates,
    });

    return data;
  }

  /**
   * Check if a workspace slug is available
   */
  static async checkSlug(slug: string): Promise<{ available: boolean; reason: string; message: string }> {
    const isValidFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
    if (!isValidFormat) {
      return {
        available: false,
        reason: 'FORMAT_INVALID',
        message: 'Slug must be lowercase alphanumeric with hyphens (e.g. acme-corp)',
      };
    }

    const { data: existing } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      return {
        available: false,
        reason: 'TAKEN',
        message: 'A workspace with this slug already exists',
      };
    }

    return {
      available: true,
      reason: 'AVAILABLE',
      message: 'Slug is available!',
    };
  }

  /**
   * Generate a URL-safe slug from a name
   */
  private static generateSlug(name: string): string {
    let slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (slug.length < 2) slug = slug + '-workspace';
    // Add random suffix for uniqueness
    const suffix = Math.random().toString(36).substring(2, 6);
    return `${slug}-${suffix}`;
  }
}

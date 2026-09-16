import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../config/logger.js';
import { AuditService } from '../audit/audit.service.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../../shared/permissions.js';

interface CreateWorkspaceParams {
  name: string;
  slug?: string;
  userId: string;
}

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
    const { name, userId } = params;

    // Generate slug from name if not provided
    const slug = params.slug || this.generateSlug(name);

    // Check slug uniqueness
    const { data: existing } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      throw AppError.conflict('A workspace with this slug already exists', 'SLUG_EXISTS');
    }

    // 1. Create workspace
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .insert({ name, slug, created_by: userId })
      .select()
      .single();

    if (wsError || !workspace) {
      logger.error('Failed to create workspace', { error: wsError?.message });
      throw AppError.internal('Failed to create workspace');
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

      // 5. Create trial subscription
      const { data: freePlan } = await supabaseAdmin
        .from('subscription_plans')
        .select('id, limits')
        .eq('name', 'free')
        .single();

      if (freePlan) {
        await supabaseAdmin.from('subscriptions').insert({
          workspace_id: workspace.id,
          plan_id: freePlan.id,
          status: 'trialing',
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
        });

        // 6. Initialize usage tracking
        const limits = freePlan.limits as Record<string, number>;
        const usageMetrics = [
          { metric: 'users', limit_value: limits.users || 2 },
          { metric: 'products', limit_value: limits.products || 100 },
          { metric: 'warehouses', limit_value: limits.warehouses || 1 },
        ];

        await supabaseAdmin.from('usage_records').insert(
          usageMetrics.map(m => ({
            workspace_id: workspace.id,
            metric: m.metric,
            current_value: m.metric === 'users' ? 1 : 0, // Creator counts as 1 user
            limit_value: m.limit_value,
          }))
        );
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
      throw AppError.internal('Failed to create workspace');
    }
  }

  /**
   * Create default roles for a workspace
   * Returns the Owner role ID
   */
  private static async createDefaultRoles(workspaceId: string): Promise<string | null> {
    const roleNames = Object.keys(DEFAULT_ROLE_PERMISSIONS);
    let ownerRoleId: string | null = null;

    for (const roleName of roleNames) {
      const { data: role, error: roleError } = await supabaseAdmin
        .from('roles')
        .insert({
          workspace_id: workspaceId,
          name: roleName,
          description: `Default ${roleName} role`,
          is_system: true,
        })
        .select()
        .single();

      if (roleError || !role) {
        logger.error(`Failed to create role: ${roleName}`, { error: roleError?.message });
        continue;
      }

      if (roleName === 'Owner') {
        ownerRoleId = role.id;
      }

      // Assign permissions to role
      const permCodes = DEFAULT_ROLE_PERMISSIONS[roleName];
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

import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { logger } from '../../config/logger.js';
import { loadEffectivePermissions } from '../../middleware/workspace.middleware.js';

export class MemberService {
  /**
   * List members of a workspace
   */
  static async list(workspaceId: string, page = 1, pageSize = 25) {
    const { data, error, count } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id,
        user_id,
        workspace_id,
        status,
        joined_at,
        user:users(id, email, name, avatar_url),
        member_roles(
          role:roles(id, name)
        )
      `, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .neq('status', 'removed')
      .order('joined_at', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) {
      logger.error('Failed to list members', { error: error.message });
      throw AppError.internal('Failed to list members');
    }

    // Flatten roles
    const members = (data || []).map(m => ({
      ...m,
      roles: (m.member_roles as any[])?.map((mr: any) => mr.role).filter(Boolean) || [],
      member_roles: undefined,
    }));

    return {
      data: members,
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    };
  }

  /**
   * Get the current user's membership in a workspace, including roles,
   * direct permissions, and effective permission codes.
   * Powers GET /workspaces/:workspaceId/members/me (app shell bootstrap).
   */
  static async getMe(userId: string, workspaceId: string) {
    const { data: member, error } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error || !member) {
      throw AppError.notFound('Membership not found');
    }

    const detail = await this.getById(member.id, workspaceId);
    const permissions = await loadEffectivePermissions(member.id);

    return { ...detail, permissions };
  }

  /**
   * Get a single member
   */
  static async getById(memberId: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id,
        user_id,
        workspace_id,
        status,
        joined_at,
        user:users(id, email, name, avatar_url),
        member_roles(
          role:roles(id, name)
        ),
        member_permissions(
          permission:permissions(id, code, group_name, description)
        )
      `)
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      throw AppError.notFound('Member not found');
    }

    return {
      ...data,
      roles: (data.member_roles as any[])?.map((mr: any) => mr.role).filter(Boolean) || [],
      direct_permissions: (data.member_permissions as any[])?.map((mp: any) => mp.permission).filter(Boolean) || [],
      member_roles: undefined,
      member_permissions: undefined,
    };
  }

  /**
   * Update member roles
   */
  static async updateRoles(memberId: string, workspaceId: string, roleIds: string[], userId: string) {
    // Verify member belongs to workspace
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('id, user_id')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) throw AppError.notFound('Member not found');

    // Delete existing roles
    await supabaseAdmin.from('member_roles').delete().eq('member_id', memberId);

    // Insert new roles (verify they belong to workspace)
    if (roleIds.length > 0) {
      const { data: validRoles } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('id', roleIds);

      if (validRoles && validRoles.length > 0) {
        await supabaseAdmin.from('member_roles').insert(
          validRoles.map(r => ({ member_id: memberId, role_id: r.id }))
        );
      }
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: 'member.roles_updated',
      entity: 'workspace_member',
      entityId: memberId,
      newValue: { roleIds },
    });

    return this.getById(memberId, workspaceId);
  }

  /**
   * Update direct permissions for a member
   */
  static async updateDirectPermissions(memberId: string, workspaceId: string, permissionCodes: string[], userId: string) {
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) throw AppError.notFound('Member not found');

    // Delete existing direct permissions
    await supabaseAdmin.from('member_permissions').delete().eq('member_id', memberId);

    // Insert new direct permissions
    if (permissionCodes.length > 0) {
      const { data: perms } = await supabaseAdmin
        .from('permissions')
        .select('id')
        .in('code', permissionCodes);

      if (perms && perms.length > 0) {
        await supabaseAdmin.from('member_permissions').insert(
          perms.map(p => ({ member_id: memberId, permission_id: p.id }))
        );
      }
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: 'member.permissions_updated',
      entity: 'workspace_member',
      entityId: memberId,
      newValue: { permissionCodes },
    });

    return this.getById(memberId, workspaceId);
  }

  /**
   * Remove a member from workspace (soft delete)
   */
  static async remove(memberId: string, workspaceId: string, userId: string) {
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('id, user_id')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) throw AppError.notFound('Member not found');

    // Don't allow removing yourself if you're the only owner
    // Check if member has Owner role
    const { data: ownerCheck } = await supabaseAdmin
      .from('member_roles')
      .select('role:roles(name)')
      .eq('member_id', memberId);

    const isOwner = ownerCheck?.some((mr: any) => mr.role?.name === 'Owner');

    if (isOwner) {
      // Count other owners
      const { count } = await supabaseAdmin
        .from('member_roles')
        .select('id', { count: 'exact' })
        .eq('role_id', (ownerCheck?.find((mr: any) => mr.role?.name === 'Owner') as any)?.role_id)
        .neq('member_id', memberId);

      if (!count || count === 0) {
        throw AppError.badRequest('Cannot remove the last owner of a workspace');
      }
    }

    await supabaseAdmin
      .from('workspace_members')
      .update({ status: 'removed' })
      .eq('id', memberId);

    // Clean up roles and permissions
    await supabaseAdmin.from('member_roles').delete().eq('member_id', memberId);
    await supabaseAdmin.from('member_permissions').delete().eq('member_id', memberId);

    await AuditService.log({
      workspaceId,
      userId,
      action: 'member.removed',
      entity: 'workspace_member',
      entityId: memberId,
      previousValue: { user_id: member.user_id },
    });

    // Update usage counter
    try {
      await supabaseAdmin.rpc('decrement_usage', {
        p_workspace_id: workspaceId,
        p_metric: 'users',
      });
    } catch {
      // RPC ignored if not existing
    }
  }
}

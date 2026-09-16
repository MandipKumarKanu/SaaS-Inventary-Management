import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { logger } from '../../config/logger.js';

interface CreateRoleParams {
  workspaceId: string;
  name: string;
  description?: string;
  permissionCodes: string[];
  userId: string;
}

export class RoleService {
  /**
   * List roles for a workspace
   */
  static async list(workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('roles')
      .select(`
        id,
        workspace_id,
        name,
        description,
        is_system,
        created_at,
        role_permissions(
          permission:permissions(id, code, group_name, description)
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('is_system', { ascending: false })
      .order('name');

    if (error) {
      throw AppError.internal('Failed to list roles');
    }

    return (data || []).map(role => ({
      ...role,
      permissions: (role.role_permissions as any[])?.map((rp: any) => rp.permission).filter(Boolean) || [],
      role_permissions: undefined,
    }));
  }

  /**
   * Get a role by ID
   */
  static async getById(roleId: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('roles')
      .select(`
        *,
        role_permissions(
          permission:permissions(id, code, group_name, description)
        )
      `)
      .eq('id', roleId)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      throw AppError.notFound('Role not found');
    }

    return {
      ...data,
      permissions: (data.role_permissions as any[])?.map((rp: any) => rp.permission).filter(Boolean) || [],
      role_permissions: undefined,
    };
  }

  /**
   * Create a custom role
   */
  static async create(params: CreateRoleParams) {
    const { workspaceId, name, description, permissionCodes, userId } = params;

    // Check for duplicate name
    const { data: existing } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .single();

    if (existing) {
      throw AppError.conflict('A role with this name already exists');
    }

    // Create role
    const { data: role, error } = await supabaseAdmin
      .from('roles')
      .insert({
        workspace_id: workspaceId,
        name,
        description: description || null,
        is_system: false,
      })
      .select()
      .single();

    if (error || !role) {
      throw AppError.internal('Failed to create role');
    }

    // Assign permissions
    if (permissionCodes.length > 0) {
      const { data: perms } = await supabaseAdmin
        .from('permissions')
        .select('id')
        .in('code', permissionCodes);

      if (perms && perms.length > 0) {
        await supabaseAdmin.from('role_permissions').insert(
          perms.map(p => ({ role_id: role.id, permission_id: p.id }))
        );
      }
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: 'role.created',
      entity: 'role',
      entityId: role.id,
      newValue: { name, permissionCodes },
    });

    return this.getById(role.id, workspaceId);
  }

  /**
   * Update a role (not system roles)
   */
  static async update(roleId: string, workspaceId: string, updates: { name?: string; description?: string; permissionCodes?: string[] }, userId: string) {
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, is_system, name')
      .eq('id', roleId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!role) throw AppError.notFound('Role not found');
    if (role.is_system) throw AppError.badRequest('System roles cannot be modified');

    // Update role details
    if (updates.name || updates.description !== undefined) {
      await supabaseAdmin
        .from('roles')
        .update({
          ...(updates.name && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
        })
        .eq('id', roleId);
    }

    // Update permissions
    if (updates.permissionCodes) {
      // Delete existing
      await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);

      // Insert new
      if (updates.permissionCodes.length > 0) {
        const { data: perms } = await supabaseAdmin
          .from('permissions')
          .select('id')
          .in('code', updates.permissionCodes);

        if (perms && perms.length > 0) {
          await supabaseAdmin.from('role_permissions').insert(
            perms.map(p => ({ role_id: roleId, permission_id: p.id }))
          );
        }
      }
    }

    await AuditService.log({
      workspaceId,
      userId,
      action: 'role.updated',
      entity: 'role',
      entityId: roleId,
      newValue: updates,
    });

    return this.getById(roleId, workspaceId);
  }

  /**
   * Delete a custom role
   */
  static async delete(roleId: string, workspaceId: string, userId: string) {
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, is_system, name')
      .eq('id', roleId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!role) throw AppError.notFound('Role not found');
    if (role.is_system) throw AppError.badRequest('System roles cannot be deleted');

    // Check if any members are using this role
    const { count } = await supabaseAdmin
      .from('member_roles')
      .select('id', { count: 'exact' })
      .eq('role_id', roleId);

    if (count && count > 0) {
      throw AppError.badRequest(`Cannot delete role "${role.name}" because ${count} member(s) are assigned to it`);
    }

    await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
    await supabaseAdmin.from('roles').delete().eq('id', roleId);

    await AuditService.log({
      workspaceId,
      userId,
      action: 'role.deleted',
      entity: 'role',
      entityId: roleId,
      previousValue: { name: role.name },
    });
  }

  /**
   * List all available permissions (global, not workspace-scoped)
   */
  static async listPermissions() {
    const { data, error } = await supabaseAdmin
      .from('permissions')
      .select('*')
      .order('group_name')
      .order('code');

    if (error) {
      throw AppError.internal('Failed to list permissions');
    }

    return data || [];
  }
}

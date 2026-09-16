import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { logger } from '../../config/logger.js';
import { UsageService } from '../../services/usage.service.js';

interface CreateInvitationParams {
  email: string;
  workspaceId: string;
  invitedBy: string;
  roleId?: string;
  customPermissions?: string[];
}

export class InvitationService {
  /**
   * Create an invitation
   */
  static async create(params: CreateInvitationParams) {
    const { email, workspaceId, invitedBy, roleId, customPermissions } = params;

    // Check if user is already a member
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      const { data: existingMember } = await supabaseAdmin
        .from('workspace_members')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMember && existingMember.status === 'active') {
        throw AppError.conflict('User is already a member of this workspace');
      }
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .eq('status', 'pending')
      .single();

    if (existingInvite) {
      throw AppError.conflict('An invitation is already pending for this email');
    }

    // Check usage limits via the shared service (Phase 3) — live counts,
    // DB-driven plan limits, structured PLAN_LIMIT_REACHED error.
    await UsageService.assertWithinLimit(workspaceId, 'users');

    // Validate role belongs to workspace
    if (roleId) {
      const { data: role } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('id', roleId)
        .eq('workspace_id', workspaceId)
        .single();

      if (!role) {
        throw AppError.badRequest('Invalid role for this workspace');
      }
    }

    // Create invitation
    const { data: invitation, error } = await supabaseAdmin
      .from('workspace_invitations')
      .insert({
        email,
        workspace_id: workspaceId,
        invited_by: invitedBy,
        role_id: roleId || null,
        custom_permissions: customPermissions || [],
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error || !invitation) {
      logger.error('Failed to create invitation', { error: error?.message });
      throw AppError.internal('Failed to create invitation');
    }

    await AuditService.log({
      workspaceId,
      userId: invitedBy,
      action: 'invitation.created',
      entity: 'workspace_invitation',
      entityId: invitation.id,
      newValue: { email, roleId },
    });

    // TODO: Send invitation email

    return invitation;
  }

  /**
   * List invitations for a workspace
   */
  static async listForWorkspace(workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('workspace_invitations')
      .select(`
        *,
        inviter:users!invited_by(id, name, email),
        role:roles(id, name)
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      throw AppError.internal('Failed to list invitations');
    }

    return data || [];
  }

  /**
   * List pending invitations for a user (by email)
   */
  static async listForUser(email: string) {
    const { data, error } = await supabaseAdmin
      .from('workspace_invitations')
      .select(`
        *,
        workspace:workspaces(id, name, slug, logo_url),
        inviter:users!invited_by(id, name, email)
      `)
      .eq('email', email)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      throw AppError.internal('Failed to list invitations');
    }

    return data || [];
  }

  /**
   * Accept an invitation
   * Creates workspace membership + assigns role/permissions
   */
  static async accept(invitationId: string, userId: string, userEmail: string) {
    // Get invitation
    const { data: invitation, error } = await supabaseAdmin
      .from('workspace_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('email', userEmail)
      .eq('status', 'pending')
      .single();

    if (error || !invitation) {
      throw AppError.notFound('Invitation not found or already processed');
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      await supabaseAdmin
        .from('workspace_invitations')
        .update({ status: 'expired' })
        .eq('id', invitationId);
      throw AppError.badRequest('This invitation has expired');
    }

    // Create membership
    const { data: member, error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .upsert({
        user_id: userId,
        workspace_id: invitation.workspace_id,
        status: 'active',
      }, { onConflict: 'user_id,workspace_id' })
      .select()
      .single();

    if (memberError || !member) {
      logger.error('Failed to create membership', { error: memberError?.message });
      throw AppError.internal('Failed to accept invitation');
    }

    // Assign role
    if (invitation.role_id) {
      await supabaseAdmin.from('member_roles').upsert({
        member_id: member.id,
        role_id: invitation.role_id,
      }, { onConflict: 'member_id,role_id' });
    }

    // Assign custom permissions
    if (invitation.custom_permissions && invitation.custom_permissions.length > 0) {
      const { data: perms } = await supabaseAdmin
        .from('permissions')
        .select('id')
        .in('code', invitation.custom_permissions);

      if (perms && perms.length > 0) {
        await supabaseAdmin.from('member_permissions').upsert(
          perms.map(p => ({ member_id: member.id, permission_id: p.id })),
          { onConflict: 'member_id,permission_id' }
        );
      }
    }

    // Update invitation status
    await supabaseAdmin
      .from('workspace_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitationId);

    // Refresh usage cache via the shared service (Phase 3)
    await UsageService.refreshUsage(invitation.workspace_id, 'users');

    await AuditService.log({
      workspaceId: invitation.workspace_id,
      userId,
      action: 'invitation.accepted',
      entity: 'workspace_invitation',
      entityId: invitationId,
      newValue: { email: userEmail, role_id: invitation.role_id },
    });

    return { workspace_id: invitation.workspace_id, member_id: member.id };
  }

  /**
   * Revoke an invitation
   */
  static async revoke(invitationId: string, workspaceId: string, userId: string) {
    const { data: invitation } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id, status')
      .eq('id', invitationId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!invitation) {
      throw AppError.notFound('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw AppError.badRequest('Only pending invitations can be revoked');
    }

    await supabaseAdmin
      .from('workspace_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);

    await AuditService.log({
      workspaceId,
      userId,
      action: 'invitation.revoked',
      entity: 'workspace_invitation',
      entityId: invitationId,
    });
  }
}

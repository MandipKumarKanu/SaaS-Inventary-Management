/**
 * Platform Admin RBAC (PRD §38, §65, §76, §78).
 *
 * The admin panel is a separate administration surface with its own
 * role hierarchy — platform admins are NOT workspace admins with extra
 * buttons. Authorization is enforced here, server-side, per endpoint.
 *
 * Roles (highest → lowest):
 *   SUPER_ADMIN     — full platform access
 *   PLATFORM_ADMIN  — users, workspaces, subscriptions (no plan pricing edits)
 *   SUPPORT_ADMIN   — users, workspaces, subscriptions, support actions
 *   BILLING_ADMIN   — plans, subscriptions, payments, coupons
 *
 * Env-bootstrapped admins (PLATFORM_ADMIN_EMAILS) are treated as
 * SUPER_ADMIN; DB rows carry an explicit role column.
 */

export type PlatformAdminRole = 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN';

export const PLATFORM_PERMISSIONS = {
  // Dashboard / overview
  'platform.overview.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  // Users
  'platform.users.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  'platform.users.manage': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN'],
  // Workspaces
  'platform.workspaces.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  'platform.workspaces.manage': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN'],
  // Plans
  'platform.plans.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'BILLING_ADMIN'],
  'platform.plans.manage': ['SUPER_ADMIN', 'BILLING_ADMIN'],
  // Subscriptions
  'platform.subscriptions.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  'platform.subscriptions.manage': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  // Coupons
  'platform.coupons.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'BILLING_ADMIN'],
  'platform.coupons.manage': ['SUPER_ADMIN', 'BILLING_ADMIN'],
  // Billing / payments / webhooks
  'platform.billing.view': ['SUPER_ADMIN', 'BILLING_ADMIN'],
  // Usage & analytics
  'platform.analytics.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'BILLING_ADMIN'],
  // Audit
  'platform.audit.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'],
  // System health / jobs / diagnostics
  'platform.system.view': ['SUPER_ADMIN', 'PLATFORM_ADMIN'],
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export function roleHasPermission(role: PlatformAdminRole, permission: PlatformPermission): boolean {
  return (PLATFORM_PERMISSIONS[permission] as readonly PlatformAdminRole[]).includes(role);
}

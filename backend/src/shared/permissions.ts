// All granular permissions used throughout the system
export const PERMISSIONS = {
  // Products
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_ARCHIVE: 'products.archive',

  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_COUNT: 'inventory.count',

  // Warehouses
  WAREHOUSES_VIEW: 'warehouses.view',
  WAREHOUSES_CREATE: 'warehouses.create',
  WAREHOUSES_UPDATE: 'warehouses.update',
  WAREHOUSES_ARCHIVE: 'warehouses.archive',

  // Purchases
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_APPROVE: 'purchases.approve',
  PURCHASES_RECEIVE: 'purchases.receive',

  // Sales
  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',
  SALES_RESERVE: 'sales.reserve',
  SALES_FULFILL: 'sales.fulfill',
  SALES_CANCEL: 'sales.cancel',

  // Transfers
  TRANSFERS_VIEW: 'transfers.view',
  TRANSFERS_CREATE: 'transfers.create',
  TRANSFERS_APPROVE: 'transfers.approve',
  TRANSFERS_SHIP: 'transfers.ship',
  TRANSFERS_RECEIVE: 'transfers.receive',

  // Returns
  RETURNS_VIEW: 'returns.view',
  RETURNS_CREATE: 'returns.create',
  RETURNS_APPROVE: 'returns.approve',
  RETURNS_INSPECT: 'returns.inspect',
  RETURNS_RESTOCK: 'returns.restock',

  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  // Team
  TEAM_VIEW: 'team.view',
  TEAM_INVITE: 'team.invite',
  TEAM_MANAGE: 'team.manage',

  // Roles
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',

  // Settings
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  // Billing
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Permission groups for UI display
export const PERMISSION_GROUPS: Record<string, { label: string; permissions: string[] }> = {
  products: {
    label: 'Products',
    permissions: [PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_UPDATE, PERMISSIONS.PRODUCTS_ARCHIVE],
  },
  inventory: {
    label: 'Inventory',
    permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_COUNT],
  },
  warehouses: {
    label: 'Warehouses',
    permissions: [PERMISSIONS.WAREHOUSES_VIEW, PERMISSIONS.WAREHOUSES_CREATE, PERMISSIONS.WAREHOUSES_UPDATE, PERMISSIONS.WAREHOUSES_ARCHIVE],
  },
  purchases: {
    label: 'Purchasing',
    permissions: [PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_CREATE, PERMISSIONS.PURCHASES_APPROVE, PERMISSIONS.PURCHASES_RECEIVE],
  },
  sales: {
    label: 'Sales',
    permissions: [PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_RESERVE, PERMISSIONS.SALES_FULFILL, PERMISSIONS.SALES_CANCEL],
  },
  transfers: {
    label: 'Transfers',
    permissions: [PERMISSIONS.TRANSFERS_VIEW, PERMISSIONS.TRANSFERS_CREATE, PERMISSIONS.TRANSFERS_APPROVE, PERMISSIONS.TRANSFERS_SHIP, PERMISSIONS.TRANSFERS_RECEIVE],
  },
  returns: {
    label: 'Returns',
    permissions: [PERMISSIONS.RETURNS_VIEW, PERMISSIONS.RETURNS_CREATE, PERMISSIONS.RETURNS_APPROVE, PERMISSIONS.RETURNS_INSPECT, PERMISSIONS.RETURNS_RESTOCK],
  },
  reports: {
    label: 'Reports',
    permissions: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT],
  },
  team: {
    label: 'Team',
    permissions: [PERMISSIONS.TEAM_VIEW, PERMISSIONS.TEAM_INVITE, PERMISSIONS.TEAM_MANAGE],
  },
  roles: {
    label: 'Roles',
    permissions: [PERMISSIONS.ROLES_VIEW, PERMISSIONS.ROLES_MANAGE],
  },
  settings: {
    label: 'Settings',
    permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
  },
  billing: {
    label: 'Billing',
    permissions: [PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE],
  },
};

// ── Phase 7b: DEFAULT ROLE → PERMISSION MAPPINGS REMOVED FROM CODE ──
//
// Role templates (name → permission bundle, plus the is_owner flag) are now
// DATABASE ROWS in `role_templates` (migration 019), seeded from the
// ROLE_TEMPLATE_SEED environment variable by run-migrations.ts. Workspace
// creation instantiates roles from those rows (WorkspaceService), and
// ownership is detected via the is_owner flag — never a hardcoded role name.
//
// This file keeps ONLY the permission CODE constants (the vocabulary the
// catalog in `permissions` table uses) and the display grouping for the UI.

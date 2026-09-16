import { TestDb } from './supabase-mock';
import { PERMISSIONS } from '../../src/shared/permissions';

const PERM_CODES = Object.values(PERMISSIONS) as string[];

/** Deterministic UUID-ish ids for readability in test output. */
export function wsId(n: number) {
  return `11111111-1111-4111-8111-00000000000${n}`;
}
export function userId(n: number) {
  return `22222222-2222-4222-8222-00000000000${n}`;
}
export function roleId(n: number) {
  return `33333333-3333-4333-8333-00000000000${n}`;
}
export function memberId(n: number) {
  return `44444444-4444-4444-8444-00000000000${n}`;
}

export interface World {
  workspaces: { id: string; name: string; slug: string }[];
  users: { id: string; email: string }[];
}

/**
 * Role templates — the TEST mirror of the role_templates TABLE that
 * run-migrations seeds from ROLE_TEMPLATE_SEED in production. Same shape,
 * deterministic ids. Ownership is flagged via is_owner (no name matching).
 */
const ROLE_TEMPLATE_SEED = [
  { name: 'Owner', is_owner: true, sort_order: 1, permissions: PERM_CODES },
  {
    name: 'Warehouse Staff',
    is_owner: false,
    sort_order: 2,
    permissions: [
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_COUNT,
      PERMISSIONS.WAREHOUSES_VIEW,
      PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_RECEIVE,
      PERMISSIONS.TRANSFERS_VIEW, PERMISSIONS.TRANSFERS_CREATE, PERMISSIONS.TRANSFERS_SHIP, PERMISSIONS.TRANSFERS_RECEIVE,
      PERMISSIONS.RETURNS_VIEW, PERMISSIONS.RETURNS_INSPECT, PERMISSIONS.RETURNS_RESTOCK,
    ],
  },
  {
    name: 'Sales Staff',
    is_owner: false,
    sort_order: 3,
    permissions: [
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.WAREHOUSES_VIEW,
      PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_RESERVE, PERMISSIONS.SALES_FULFILL,
      PERMISSIONS.RETURNS_VIEW, PERMISSIONS.RETURNS_CREATE,
      PERMISSIONS.REPORTS_VIEW,
    ],
  },
];

export { ROLE_TEMPLATE_SEED };

/**
 * Seeds the standard multi-tenant world:
 *   - ws1 "alpha"  : alice (Owner via roles), bob  (Warehouse Staff)
 *   - ws2 "beta"   : alice (Owner),            carol (Sales Staff)
 *   - dave         : authenticated, belongs to NO workspace
 *   - admin@example.com : platform admin candidate (env fallback list)
 *
 * Mirrors the PRODUCTION flow: role templates live in a TABLE; workspace
 * roles are instantiated per-workspace from those templates.
 */
export function seedWorld(db: TestDb): World {
  const W1 = wsId(1);
  const W2 = wsId(2);

  const alice = { id: userId(1), email: 'alice@example.com', name: 'Alice Owner', status: 'active' };
  const bob = { id: userId(2), email: 'bob@example.com', name: 'Bob Staff', status: 'active' };
  const carol = { id: userId(3), email: 'carol@example.com', name: 'Carol Sales', status: 'active' };
  const dave = { id: userId(4), email: 'dave@example.com', name: 'Dave Lurker', status: 'active' };

  db.__insert('users', [alice, bob, carol, dave]);

  db.__insert('workspaces', [
    { id: W1, name: 'Alpha Traders', slug: 'alpha', status: 'active', created_by: alice.id },
    { id: W2, name: 'Beta Electronics', slug: 'beta', status: 'active', created_by: alice.id },
  ]);

  // Members: alice(owner ws1), bob(ws1), alice(owner ws2), carol(ws2)
  db.__insert('workspace_members', [
    { id: memberId(1), user_id: alice.id, workspace_id: W1, status: 'active' },
    { id: memberId(2), user_id: bob.id, workspace_id: W1, status: 'active' },
    { id: memberId(3), user_id: alice.id, workspace_id: W2, status: 'active' },
    { id: memberId(4), user_id: carol.id, workspace_id: W2, status: 'active' },
  ]);

  // Permissions catalog (matches migration 002 shape)
  const permRows = PERM_CODES.map((code, i) => ({
    id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`,
    code,
    group_name: code.split('.')[0],
    description: code,
  }));
  db.__insert('permissions', permRows);
  const permIdByCode = new Map(permRows.map((p) => [p.code, p.id]));

  // ROLE TEMPLATES (the DB-driven source — mirrors migration 019 + env seed)
  db.__insert(
    'role_templates',
    ROLE_TEMPLATE_SEED.map((t, i) => ({
      id: `tpl-${i + 1}`,
      name: t.name,
      description: `Default ${t.name} role`,
      is_owner: t.is_owner,
      is_system: true,
      permissions: t.permissions,
      sort_order: t.sort_order,
    }))
  );

  // Roles per workspace — instantiated FROM the templates (same bundles)
  const roleDefs: Array<{ n: number; ws: string; tplIndex: number }> = [
    { n: 1, ws: W1, tplIndex: 0 }, // Owner @ ws1
    { n: 2, ws: W1, tplIndex: 1 }, // Warehouse Staff @ ws1
    { n: 3, ws: W2, tplIndex: 0 }, // Owner @ ws2
    { n: 4, ws: W2, tplIndex: 2 }, // Sales Staff @ ws2
  ];
  db.__insert(
    'roles',
    roleDefs.map((r) => ({
      id: roleId(r.n),
      workspace_id: r.ws,
      name: ROLE_TEMPLATE_SEED[r.tplIndex].name,
      is_system: true,
    }))
  );

  // role_permissions resolved from the template bundles (same as
  // instantiate_role_templates() does in SQL)
  const rpRows: Row[] = [];
  for (const r of roleDefs) {
    for (const code of ROLE_TEMPLATE_SEED[r.tplIndex].permissions) {
      rpRows.push({ role_id: roleId(r.n), permission_id: permIdByCode.get(code)! });
    }
  }
  db.__insert('role_permissions', rpRows);

  // member_roles — Owner assignment via the is_owner template, not name matching
  db.__insert('member_roles', [
    { member_id: memberId(1), role_id: roleId(1) }, // alice -> Owner @ ws1
    { id: '66666666-6666-4666-8666-000000000001', member_id: memberId(2), role_id: roleId(2) }, // bob -> Warehouse Staff @ ws1
    { member_id: memberId(3), role_id: roleId(3) }, // alice -> Owner @ ws2
    { id: '66666666-6666-4666-8666-000000000002', member_id: memberId(4), role_id: roleId(4) }, // carol -> Sales Staff @ ws2
  ]);

  // Products prove workspace scoping of data reads
  db.__insert('products', [
    { id: '77777777-7777-4777-8777-000000000001', workspace_id: W1, name: 'Alpha Widget', sku: 'ALPHA-1', unit: 'pcs' },
    { id: '77777777-7777-4777-8777-000000000002', workspace_id: W2, name: 'Beta Gadget', sku: 'BETA-1', unit: 'pcs' },
  ]);

  // config_defaults (mirrors migration 019 + env seeding)
  db.__insert('config_defaults', [
    { key: 'default_plan_tier', value: 'free', description: 'Plan tier assigned to new workspaces' },
    { key: 'trial_days', value: 14, description: 'Trial length for new workspaces (days)' },
    { key: 'count_approval_threshold_pct', value: 100, description: 'Count variance % requiring a second approver' },
    { key: 'expiry_alert_days', value: [30, 14, 7, 1], description: 'Batch expiry alert thresholds (days)' },
  ]);

  return {
    workspaces: [
      { id: W1, name: 'Alpha Traders', slug: 'alpha' },
      { id: W2, name: 'Beta Electronics', slug: 'beta' },
    ],
    users: [alice, bob, carol, dave],
  };
}

// local Row type to avoid extra import churn
type Row = Record<string, any>;

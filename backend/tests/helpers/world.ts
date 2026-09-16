import { TestDb } from './supabase-mock';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../../src/shared/permissions';

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
 * Seeds the standard multi-tenant world:
 *   - ws1 "alpha"  : alice (Owner via roles), bob  (Warehouse Staff)
 *   - ws2 "beta"   : alice (Owner),            carol (Sales Staff)
 *   - dave         : authenticated, belongs to NO workspace
 *   - admin@example.com : platform admin candidate (env fallback list)
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

  // Roles per workspace (Owner, Warehouse Staff, Sales Staff)
  const roleDefs: Array<{ n: number; ws: string; name: string }> = [
    { n: 1, ws: W1, name: 'Owner' },
    { n: 2, ws: W1, name: 'Warehouse Staff' },
    { n: 3, ws: W2, name: 'Owner' },
    { n: 4, ws: W2, name: 'Sales Staff' },
  ];
  db.__insert(
    'roles',
    roleDefs.map((r) => ({
      id: roleId(r.n),
      workspace_id: r.ws,
      name: r.name,
      is_system: true,
    }))
  );

  // role_permissions from the shared defaults (the same source the app uses)
  const rpRows: Row[] = [];
  for (const r of roleDefs) {
    const codes = DEFAULT_ROLE_PERMISSIONS[r.name] || [];
    for (const code of codes) {
      rpRows.push({ role_id: roleId(r.n), permission_id: permIdByCode.get(code)! });
    }
  }
  db.__insert('role_permissions', rpRows);

  // member_roles
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

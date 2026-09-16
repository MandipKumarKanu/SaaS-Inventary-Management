import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { testDb, issueToken } from '../setup';
import { StateMachine } from '../../src/shared/state-machines';
import { PERMISSIONS } from '../../src/shared/permissions';

/**
 * Phase 4 suite (PRD §76, Rule #17, §41):
 *   - Every illegal transition → 422 INVALID_STATUS_TRANSITION
 *   - Legal paths (single-step via strict gate; composite-forward via the
 *     stock-moving gate only)
 *   - Per-transition permission denials → 403 TRANSITION_PERMISSION_DENIED
 *   - Audit rows stamped with user-agent/ip via audit-context middleware
 *
 * The pg pool is mocked like transactions.test.ts (transfer ship opens a
 * transaction); the stock upsert is stubbed to succeed.
 */

const h = vi.hoisted(() => ({ fakeClient: null as any }));

vi.mock('../../src/db/pool.js', () => ({
  withTransaction: async (fn: any) => {
    if (!h.fakeClient) throw new Error('fakeClient not configured');
    return fn(h.fakeClient);
  },
  closePgPool: async () => {},
}));

const app = buildTestApp();
const W1 = wsId(1);
const ALICE = userId(1);
const BOB = userId(2); // Warehouse Staff in W1

let aliceToken: string;
let bobToken: string;

const OWNER_PERMS = Object.values(PERMISSIONS) as string[];

function makeFakeClient() {
  return {
    async query(text: string, params: any[] = []) {
      const t = text.toLowerCase();
      if (t.includes('from inventory_transactions') && t.includes('idempotency_key = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (t.includes('insert into inventory as inv')) {
        return { rows: [{ id: 'inv_x', quantity: 90 }], rowCount: 1 };
      }
      if (t.trim().toLowerCase().startsWith('insert into inventory_transactions')) {
        return { rows: [{ id: 'tx_x', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      // In-tx audit rows: materialize into the shared mock so assertions can read them
      if (t.includes('insert into audit_logs')) {
        testDb.__insert('audit_logs', [{
          workspace_id: params[0],
          user_id: params[1],
          action: params[2],
          entity: params[3],
          entity_id: params[4],
          previous_value: params[5] ? JSON.parse(params[5]) : null,
          new_value: params[6] ? JSON.parse(params[6]) : null,
          ip_address: params[7],
          user_agent: params[8],
        }]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

beforeEach(async () => {
  seedWorld(testDb);
  h.fakeClient = null;
  aliceToken = issueToken(ALICE, 'alice@example.com');
  bobToken = issueToken(BOB, 'bob@example.com');
});

// ============================================
// Pure state-machine unit tests
// ============================================
describe('StateMachine unit (all entities)', () => {
  it('rejects every illegal jump with 422 INVALID_STATUS_TRANSITION', () => {
    const illegal: Array<[any, string, string]> = [
      ['purchase_order', 'draft', 'received'], // skip approval + ordering
      ['purchase_order', 'draft', 'closed'],
      ['purchase_order', 'received', 'draft'], // backwards
      ['purchase_order', 'cancelled', 'approved'], // terminal
      ['purchase_order', 'closed', 'received'], // terminal
      ['sales_order', 'draft', 'shipped'], // skips reservation/packing without stock ops
      ['sales_order', 'delivered', 'shipped'], // terminal + backwards
      ['sales_order', 'shipped', 'cancelled'], // post-shipment cancel forbidden
      ['stock_transfer', 'requested', 'completed'], // skip approval + ship (no stock moved)
      ['stock_transfer', 'completed', 'shipped'], // terminal + backwards
      ['customer_return', 'requested', 'completed'], // never received/inspected
      ['customer_return', 'completed', 'requested'], // terminal + backwards
      ['inventory_count', 'in_progress', 'completed'], // stock-derived: only via approveCount
      ['inventory_count', 'review', 'completed'], // stock-derived: only via approveCount
      ['inventory_count', 'cancelled', 'review'], // terminal
    ];
    for (const [entity, from, to] of illegal) {
      let threw = false;
      try {
        StateMachine.assertTransition(entity, from, to);
      } catch (err: any) {
        threw = true;
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('INVALID_STATUS_TRANSITION');
        expect(err.details).toMatchObject({ entity, from, to });
      }
      expect(threw, `${entity}: ${from} → ${to} should be illegal`).toBe(true);
    }
  });

  it('accepts every legal single-step edge', () => {
    const legal: Array<[any, string, string]> = [
      ['purchase_order', 'draft', 'pending_approval'],
      ['purchase_order', 'pending_approval', 'approved'],
      ['purchase_order', 'approved', 'ordered'],
      ['purchase_order', 'ordered', 'closed'],
      ['purchase_order', 'approved', 'cancelled'],
      ['sales_order', 'draft', 'confirmed'],
      ['sales_order', 'confirmed', 'reserved'],
      ['sales_order', 'reserved', 'picking'],
      ['sales_order', 'picking', 'packed'],
      ['sales_order', 'shipped', 'delivered'],
      ['sales_order', 'confirmed', 'cancelled'],
      ['stock_transfer', 'requested', 'approved'],
      ['stock_transfer', 'requested', 'cancelled'],
      ['customer_return', 'requested', 'approved'],
      ['customer_return', 'approved', 'received'],
      ['customer_return', 'received', 'inspected'],
      ['inventory_count', 'in_progress', 'review'],
      ['inventory_count', 'in_progress', 'cancelled'],
    ];
    for (const [entity, from, to] of legal) {
      expect(() => StateMachine.assertTransition(entity, from, to), `${entity}: ${from} → ${to}`).not.toThrow();
    }
  });

  it('STRICT gate forbids stock-derived states — clients cannot fake receipts/shipments', () => {
    expect(() => StateMachine.assertTransition('sales_order', 'confirmed', 'shipped')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('sales_order', 'packed', 'shipped')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('stock_transfer', 'approved', 'shipped')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('stock_transfer', 'shipped', 'completed')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('purchase_order', 'ordered', 'received')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('inventory_count', 'review', 'completed')).toThrowError(/Invalid status transition/);
  });

  it('STOCK-MOVING gate allows composite-forward edges, never backwards/terminal', () => {
    // Forward composite: legal for stock-moving operations
    expect(() => StateMachine.assertStockTransition('sales_order', 'packed', 'shipped')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('stock_transfer', 'approved', 'shipped')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('stock_transfer', 'shipped', 'completed')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('purchase_order', 'ordered', 'received')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('inventory_count', 'in_progress', 'completed')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('customer_return', 'approved', 'completed')).not.toThrow();

    // Backwards composite: illegal even via the stock gate
    expect(() => StateMachine.assertStockTransition('sales_order', 'shipped', 'confirmed')).toThrowError();
    expect(() => StateMachine.assertStockTransition('stock_transfer', 'completed', 'requested')).toThrowError();
    // Terminal escape via stock gate: illegal
    expect(() => StateMachine.assertStockTransition('purchase_order', 'closed', 'received')).toThrowError();
  });

  it('cancellation is only allowed from the cancellable states', () => {
    expect(() => StateMachine.assertTransition('purchase_order', 'ordered', 'cancelled')).toThrowError(/Invalid status transition/);
    expect(() => StateMachine.assertTransition('sales_order', 'packed', 'cancelled')).not.toThrow();
    expect(() => StateMachine.assertTransition('sales_order', 'shipped', 'cancelled')).toThrowError(/Invalid status transition/);
  });

  it('maps per-transition permissions (pre-flight decision #3)', () => {
    expect(StateMachine.requiredPermission('purchase_order', 'approved', 'ordered')).toBe('purchases.approve');
    expect(StateMachine.requiredPermission('purchase_order', 'ordered', 'partially_received')).toBe('purchases.receive');
    expect(StateMachine.requiredPermission('sales_order', 'confirmed', 'shipped')).toBe('sales.fulfill');
    expect(StateMachine.requiredPermission('sales_order', 'confirmed', 'cancelled')).toBe('sales.cancel');
    expect(StateMachine.requiredPermission('stock_transfer', 'requested', 'approved')).toBe('transfers.approve');
    expect(StateMachine.requiredPermission('stock_transfer', 'approved', 'shipped')).toBe('transfers.ship');
    expect(StateMachine.requiredPermission('stock_transfer', 'shipped', 'completed')).toBe('transfers.receive');
    expect(StateMachine.requiredPermission('customer_return', 'requested', 'approved')).toBe('returns.approve');
    expect(StateMachine.requiredPermission('inventory_count', 'review', 'completed')).toBe('inventory.count');
    expect(StateMachine.requiredPermission('purchase_order', 'draft', 'pending_approval')).toBeNull();
  });

  it('assertCanTransition denies without the permission (403 TRANSITION_PERMISSION_DENIED)', () => {
    expect(() =>
      StateMachine.assertCanTransition('stock_transfer', 'requested', 'approved', ['transfers.view'])
    ).toThrowError(/transfers\.approve/);
    try {
      StateMachine.assertCanTransition('stock_transfer', 'requested', 'approved', ['transfers.view']);
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('TRANSITION_PERMISSION_DENIED');
    }
  });
});

// ============================================
// HTTP-level: transfer pipeline through the real route
// ============================================
describe('Transfer pipeline through the API (permissions per transition)', () => {
  let counter = 0;

  function seedTransfer(status = 'requested') {
    counter += 1;
    const id = `tr-${counter}`;
    testDb.__insert('warehouses', [
      { id: `wh-src-${counter}`, workspace_id: W1, name: 'Main', code: `M${counter}` },
      { id: `wh-dst-${counter}`, workspace_id: W1, name: 'West', code: `W${counter}` },
    ]);
    testDb.__insert('stock_transfers', [{
      id,
      workspace_id: W1,
      transfer_number: `TR-${String(counter).padStart(6, '0')}`,
      source_warehouse_id: `wh-src-${counter}`,
      destination_warehouse_id: `wh-dst-${counter}`,
      status, notes: null, created_by: ALICE, shipped_at: null,
    }]);
    testDb.__insert('stock_transfer_items', [
      { id: `tri-${counter}`, transfer_id: id, product_id: '77777777-7777-4777-8777-000000000001', requested_qty: 5 },
    ]);
    return id;
  }

  it('warehouse staff (transfers.ship but NOT transfers.approve) cannot approve; owner approves, staff ships', async () => {
    h.fakeClient = makeFakeClient(); // updateStatus always opens a tx (audit rows in-tx)
    const trId = seedTransfer('requested');

    // Bob is Warehouse Staff: has transfers.ship + transfers.receive, no approve
    const approve = await request(app)
      .patch(`/api/v1/workspaces/${W1}/transfers/${trId}/status`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ status: 'approved' });
    expect(approve.status).toBe(403);
    expect(approve.body.error.code).toBe('TRANSITION_PERMISSION_DENIED');

    // Owner approves
    const ownerApprove = await request(app)
      .patch(`/api/v1/workspaces/${W1}/transfers/${trId}/status`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ status: 'approved' });
    expect(ownerApprove.status).toBe(200);
    expect(ownerApprove.body.data.status).toBe('approved');

    // Now staff can ship (single-step approved → shipped)
    const ship = await request(app)
      .patch(`/api/v1/workspaces/${W1}/transfers/${trId}/status`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ status: 'shipped' });
    expect(ship.status).toBe(200);
    expect(ship.body.data.status).toBe('shipped');
  });

  it('audits status transitions with previous/new values', async () => {
    h.fakeClient = makeFakeClient();
    const trId = seedTransfer('requested');
    await request(app)
      .patch(`/api/v1/workspaces/${W1}/transfers/${trId}/status`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ status: 'approved' });

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'transfer.approved');
    expect(audits).toHaveLength(1);
    expect(audits[0].previous_value).toMatchObject({ status: 'requested' });
    expect(audits[0].new_value).toMatchObject({ status: 'approved' });
  });

  it('stamps audit rows with user-agent and IP from the request', async () => {
    h.fakeClient = makeFakeClient();
    const trId = seedTransfer('requested');
    await request(app)
      .patch(`/api/v1/workspaces/${W1}/transfers/${trId}/status`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('User-Agent', 'TestAgent/1.0')
      .send({ status: 'approved' });

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'transfer.approved');
    expect(audits).toHaveLength(1);
    expect(audits[0].user_agent).toBe('TestAgent/1.0');
    expect(audits[0].ip_address).toBeTruthy();
  });
});

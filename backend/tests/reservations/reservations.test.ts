import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 7 suite — Reservations & Fulfillment (PRD §30, §31, Rule #15):
 *   - Creating an SO NEVER changes stock; reserving holds it; shipping
 *     converts the hold into exactly one deduction
 *   - Over-reservation is impossible (competing SO → 422 with breakdown)
 *   - Cancel releases holds; the reservation invariant holds after every op
 *   - Reservation-first enforcement: confirmed → shipped is unreachable
 *   - Picking list / packing slip are status-gated
 *   - Reorder / routing / external API all respect reservations (Rule #15)
 *
 * The pg pool is mocked with the same recording fake pattern; all Supabase
 * reads/writes run against the in-memory mock via the REAL services.
 */

const h = vi.hoisted(() => ({
  fakeClient: null as any,
  journal: [] as string[],
}));

vi.mock('../../src/db/pool.js', () => ({
  withTransaction: async (fn: any) => {
    if (!h.fakeClient) throw new Error('fakeClient not configured');
    h.journal.push('BEGIN');
    try {
      const result = await fn(h.fakeClient);
      h.journal.push('COMMIT');
      return result;
    } catch (err) {
      h.journal.push('ROLLBACK');
      throw err;
    }
  },
  closePgPool: async () => {},
}));

import { SalesService } from '../../src/modules/sales/sales.service';
import { ReorderService } from '../../src/modules/reorder/reorder.service';
import { RoutingService } from '../../src/modules/routing/routing.service';
import { ExternalApiService } from '../../src/modules/external/external_api.service';
import { StateMachine } from '../../src/shared/state-machines';
import { seedWorld, wsId, userId } from '../helpers/world';
import { testDb } from '../setup';
import { PERMISSIONS } from '../../src/shared/permissions';

const OWNER_PERMS = Object.values(PERMISSIONS) as string[];
const W1 = wsId(1);
const ALICE = userId(1);

/** Inventory row id convention: inv-<productId>-<warehouseId> */
function invRowId(productId: string, warehouseId: string) {
  return `inv-${productId}-${warehouseId}`;
}

function makeFakeClient() {
  const queries: Array<{ text: string; params: any[] }> = [];
  return {
    queries,
    ledgerInserts() {
      return queries.filter((q) => q.text.trim().toLowerCase().startsWith('insert into inventory_transactions'));
    },
    async query(text: string, params: any[] = []) {
      queries.push({ text, params });
      const t = text.toLowerCase().replace(/\s+/g, ' ');

      // --- Idempotency pre-check: never duplicate in tests ---
      if (t.includes('from inventory_transactions') && t.includes('idempotency_key = $2')) {
        return { rows: [], rowCount: 0 };
      }

      // --- Reservation guarded increment (Phase 7 core gate) ---
      // UPDATE inventory SET reserved_quantity = reserved_quantity + $5
      //   WHERE ... AND quantity - reserved_quantity >= $5 RETURNING ...
      if (t.startsWith('update inventory') && t.includes('reserved_quantity') && t.includes('returning')) {
        const ws = params[0];
        const productId = params[1];
        const warehouseId = params[3 - 1 + 1 - 1] ?? params[3]; // $3? params: $1 ws, $2 product, $3 warehouse, $4 variant, $5 qty
        const qty = params[4];
        const row = testDb
          .__all('inventory')
          .find((r) => r.workspace_id === ws && r.product_id === productId && r.warehouse_id === warehouseId);
        if (!row || row.quantity - (row.reserved_quantity || 0) < qty) {
          return { rows: [], rowCount: 0 }; // guard rejected
        }
        row.reserved_quantity = (row.reserved_quantity || 0) + qty;
        return { rows: [{ id: row.id, quantity: row.quantity, reserved_quantity: row.reserved_quantity }], rowCount: 1 };
      }

      // --- Reservation insert (RETURNING *) ---
      if (t.startsWith('insert into inventory_reservations')) {
        const [ws, productId, variantId, warehouseId, soId, soItemId, qty, createdBy] = params;
        const existing = testDb.__all('inventory_reservations').find((r) => r.sales_order_item_id === soItemId);
        if (existing) {
          const err: any = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
        const row = {
          id: `res-${soItemId}`,
          workspace_id: ws,
          product_id: productId,
          variant_id: variantId,
          warehouse_id: warehouseId,
          sales_order_id: soId,
          sales_order_item_id: soItemId,
          quantity: qty,
          status: 'active',
          created_by: createdBy,
          released_at: null,
          converted_at: null,
          created_at: new Date().toISOString(),
        };
        testDb.__insert('inventory_reservations', [row]);
        return { rows: [row], rowCount: 1 };
      }

      // --- Reservation SELECT ... FOR UPDATE (release / convert) ---
      if (t.startsWith('select') && t.includes('from inventory_reservations') && t.includes('for update')) {
        const ws = params[0];
        const soId = params[1];
        const rows = testDb
          .__all('inventory_reservations')
          .filter((r) => r.workspace_id === ws && r.sales_order_id === soId && r.status === 'active');
        return { rows, rowCount: rows.length };
      }

      // --- Release: mark rows released ---
      if (t.startsWith('update inventory_reservations') && t.includes("status = 'released'")) {
        const ws = params[0];
        const soId = params[1];
        const rows = testDb
          .__all('inventory_reservations')
          .filter((r) => r.workspace_id === ws && r.sales_order_id === soId && r.status === 'active');
        for (const r of rows) {
          r.status = 'released';
          r.released_at = new Date().toISOString();
        }
        return { rows: [...rows], rowCount: rows.length };
      }

      // --- Convert: mark ONE row converted (WHERE id = $1 AND status = 'active') ---
      if (t.startsWith('update inventory_reservations') && t.includes("status = 'converted'")) {
        const id = params[0];
        const row = testDb.__all('inventory_reservations').find((r) => r.id === id && r.status === 'active');
        if (row) {
          row.status = 'converted';
          row.converted_at = new Date().toISOString();
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // --- Plain inventory UPDATE (release/convert decrements: no RETURNING) ---
      // SQL shape: reserved_quantity = reserved_quantity - $3  (delta param is POSITIVE,
      // the subtraction is in the SQL text)
      if (t.startsWith('update inventory') && !t.includes('returning')) {
        const ws = params[0];
        const productId = params[1];
        const isDecrement = /reserved_quantity\s*=\s*reserved_quantity\s*-/.test(t);
        const delta = isDecrement ? -params[2] : params[2];
        const row = testDb
          .__all('inventory')
          .find((r) => r.workspace_id === ws && r.product_id === productId);
        if (row) {
          row.reserved_quantity = Math.max(0, (row.reserved_quantity || 0) + delta);
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      // --- Stock movement engine (same shapes as Phase 2 fake) ---
      if (t.includes('insert into inventory as inv')) {
        // Apply to the shared mock so available-stock reads see deductions
        const [ws, productId, , warehouseId, , qty] = params;
        let row = testDb
          .__all('inventory')
          .find((r) => r.workspace_id === ws && r.product_id === productId && r.warehouse_id === warehouseId);
        if (!row) {
          row = {
            id: invRowId(productId, warehouseId),
            workspace_id: ws,
            product_id: productId,
            warehouse_id: warehouseId,
            quantity: 0,
            reserved_quantity: 0,
          };
          testDb.__insert('inventory', [row]);
        }
        if (row.quantity + qty < 0) return { rows: [], rowCount: 0 }; // guard
        row.quantity += qty;
        return { rows: [{ id: row.id, quantity: row.quantity }], rowCount: 1 };
      }
      if (t.trim().startsWith('insert into inventory_transactions')) {
        return { rows: [{ id: 'tx_x', created_at: new Date().toISOString() }], rowCount: 1 };
      }

      // --- Batches synced_quantity decrement ---
      if (t.startsWith('update batches set synced_quantity')) {
        const id = params[1];
        const row = testDb.__all('batches').find((b) => b.id === id);
        if (row) row.synced_quantity = (row.synced_quantity || 0) + params[0];
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      // --- SO item fulfilled_qty increment ---
      if (t.startsWith('update sales_order_items')) {
        const id = params[1];
        const row = testDb.__all('sales_order_items').find((r) => r.id === id);
        if (row) row.fulfilled_qty = (row.fulfilled_qty || 0) + params[0];
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      // --- Audit rows materialize into the mock ---
      if (t.includes('insert into audit_logs')) {
        testDb.__insert('audit_logs', [
          {
            workspace_id: params[0],
            user_id: params[1],
            action: params[2],
            entity: params[3],
            entity_id: params[4],
            previous_value: params[5] ? JSON.parse(params[5]) : null,
            new_value: params[6] ? JSON.parse(params[6]) : null,
          },
        ]);
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

function seedSO(opts: { status?: string; orderedQty?: number; productId?: string } = {}) {
  const status = opts.status ?? 'confirmed';
  const productId = opts.productId ?? '77777777-7777-4777-8777-000000000001';
  testDb.__insert('warehouses', [{ id: 'wh-1', workspace_id: W1, name: 'Main', code: 'MAIN', status: 'active' }]);
  testDb.__insert('customers', [{ id: 'cust-1', workspace_id: W1, name: 'Acme Corp' }]);
  testDb.__insert('sales_orders', [
    {
      id: 'so-1',
      workspace_id: W1,
      so_number: 'SO-000001',
      customer_id: 'cust-1',
      warehouse_id: 'wh-1',
      status,
      subtotal: 100,
      total_amount: 100,
      created_by: ALICE,
      shipping_address: '1 Test Way',
      notes: 'leave at door',
    },
  ]);
  testDb.__insert('sales_order_items', [
    {
      id: 'soi-1',
      so_id: 'so-1',
      product_id: productId,
      ordered_qty: opts.orderedQty ?? 10,
      fulfilled_qty: 0,
      unit_price: 10,
      product: { id: productId, name: 'Alpha Widget', sku: 'ALPHA-1', track_expiry: false },
    },
  ]);
  return { soId: 'so-1', itemId: 'soi-1', productId, warehouseId: 'wh-1' };
}

function seedStock(productId: string, warehouseId: string, quantity: number, reserved = 0) {
  testDb.__insert('inventory', [
    {
      id: invRowId(productId, warehouseId),
      workspace_id: W1,
      product_id: productId,
      warehouse_id: warehouseId,
      quantity,
      reserved_quantity: reserved,
    },
  ]);
}

/** Reconciliation invariant: SUM(active reservations) == inventory.reserved_quantity */
function assertInvariant() {
  const active = testDb.__all('inventory_reservations').filter((r) => r.status === 'active');
  const byKey = new Map<string, number>();
  for (const r of active) {
    const key = `${r.product_id}|${r.warehouse_id}`;
    byKey.set(key, (byKey.get(key) || 0) + r.quantity);
  }
  for (const inv of testDb.__all('inventory')) {
    const expected = byKey.get(`${inv.product_id}|${inv.warehouse_id}`) || 0;
    expect(inv.reserved_quantity || 0, `invariant for ${inv.product_id}@${inv.warehouse_id}`).toBe(expected);
  }
}

beforeEach(() => {
  h.fakeClient = null;
  h.journal.length = 0;
  seedWorld(testDb);
});

describe('SO lifecycle without reservations leaking stock changes', () => {
  it('createSO leaves stock untouched; reserve holds it; ship deducts exactly once', async () => {
    const { soId, itemId, productId, warehouseId } = seedSO();
    seedStock(productId, warehouseId, 50);

    // Fulfill path: confirmed → reserved (holds) → picking → packed → shipped
    h.fakeClient = makeFakeClient();
    const so = await SalesService.getById(soId, W1);
    expect(so.status).toBe('confirmed');

    await SalesService.updateStatus(soId, W1, 'reserved', ALICE, OWNER_PERMS);
    let inv = testDb.__all('inventory').find((r) => r.product_id === productId)!;
    expect(inv.quantity).toBe(50); // on-hand UNCHANGED by reserving (PRD rule)
    expect(inv.reserved_quantity).toBe(10);
    assertInvariant();

    await SalesService.updateStatus(soId, W1, 'picking', ALICE, OWNER_PERMS);
    await SalesService.updateStatus(soId, W1, 'packed', ALICE, OWNER_PERMS);
    inv = testDb.__all('inventory').find((r) => r.product_id === productId)!;
    expect(inv.quantity).toBe(50); // floor states move no stock

    await SalesService.fulfillOrder(soId, W1, ALICE, OWNER_PERMS);
    inv = testDb.__all('inventory').find((r) => r.product_id === productId)!;
    expect(inv.quantity).toBe(40); // deducted exactly the reserved qty
    expect(inv.reserved_quantity).toBe(0); // hold converted
    assertInvariant();

    const item = testDb.__all('sales_order_items').find((r) => r.id === itemId)!;
    expect(item.fulfilled_qty).toBe(10);
  });

  it('competing SO over-reservation fails with a per-item breakdown', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    seedSO({ orderedQty: 8 });
    seedStock(productId, 'wh-1', 10);

    h.fakeClient = makeFakeClient();
    await SalesService.updateStatus('so-1', W1, 'reserved', ALICE, OWNER_PERMS);
    assertInvariant();

    // Second SO wants 5 more but only 2 available
    testDb.__insert('sales_orders', [
      {
        id: 'so-2', workspace_id: W1, so_number: 'SO-000002', customer_id: 'cust-1',
        warehouse_id: 'wh-1', status: 'confirmed', subtotal: 50, total_amount: 50, created_by: ALICE,
      },
    ]);
    testDb.__insert('sales_order_items', [
      { id: 'soi-2', so_id: 'so-2', product_id: productId, ordered_qty: 5, fulfilled_qty: 0, unit_price: 10, product: { id: productId, name: 'Alpha Widget', sku: 'ALPHA-1', track_expiry: false } },
    ]);

    await expect(SalesService.updateStatus('so-2', W1, 'reserved', ALICE, OWNER_PERMS)).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_STOCK',
    });
    // SO-2 stays confirmed, nothing was half-reserved
    expect(testDb.__all('sales_orders').find((s) => s.id === 'so-2')!.status).toBe('confirmed');
    assertInvariant();
  });

  it('cancelling a reserved SO releases the hold', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    seedSO();
    seedStock(productId, 'wh-1', 50);

    h.fakeClient = makeFakeClient();
    await SalesService.updateStatus('so-1', W1, 'reserved', ALICE, OWNER_PERMS);
    expect(testDb.__all('inventory')[0].reserved_quantity).toBe(10);

    await SalesService.updateStatus('so-1', W1, 'cancelled', ALICE, OWNER_PERMS);

    const inv = testDb.__all('inventory').find((r) => r.product_id === productId)!;
    expect(inv.reserved_quantity).toBe(0);
    expect(inv.quantity).toBe(50); // never deducted
    const res = testDb.__all('inventory_reservations')[0];
    expect(res.status).toBe('released');
    expect(res.released_at).not.toBeNull();
    assertInvariant();

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'reservation.released');
    expect(audits).toHaveLength(1);
  });

  it('double fulfill (retry) is a no-op — one ledger row, stable reserved', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    seedSO();
    seedStock(productId, 'wh-1', 50);

    const client = makeFakeClient();
    h.fakeClient = client;

    await SalesService.updateStatus('so-1', W1, 'reserved', ALICE, OWNER_PERMS);
    await SalesService.fulfillOrder('so-1', W1, ALICE, OWNER_PERMS);
    const invAfterFirst = testDb.__all('inventory').find((r) => r.product_id === productId)!.quantity;

    // Status is now 'shipped' (terminal-ish) — a second fulfill throws (already shipped)
    await expect(SalesService.fulfillOrder('so-1', W1, ALICE, OWNER_PERMS)).rejects.toThrow();
    expect(testDb.__all('inventory').find((r) => r.product_id === productId)!.quantity).toBe(invAfterFirst);

    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(1); // exactly one sales_shipped movement
  });

  it('reservation-first enforcement: confirmed → shipped is unreachable', () => {
    // Generic strict gate: never allowed
    expect(() => StateMachine.assertTransition('sales_order', 'confirmed', 'shipped')).toThrowError();
    // Stock gate: composite removed in Phase 7 — must now throw
    expect(() => StateMachine.assertStockTransition('sales_order', 'confirmed', 'shipped')).toThrowError();
    // Reserved/picking/packed → shipped remain legal via the stock gate
    expect(() => StateMachine.assertStockTransition('sales_order', 'reserved', 'shipped')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('sales_order', 'picking', 'shipped')).not.toThrow();
    expect(() => StateMachine.assertStockTransition('sales_order', 'packed', 'shipped')).not.toThrow();
  });

  it('legacy SO without reservations still fulfills via direct deduction', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    // Status 'reserved' but NO reservation rows (pre-Phase-7 data)
    seedSO({ status: 'reserved' });
    seedStock(productId, 'wh-1', 50);
    // Patch the state machine gate by seeding the SO as 'reserved' (legal from-state)

    h.fakeClient = makeFakeClient();
    await SalesService.fulfillOrder('so-1', W1, ALICE, OWNER_PERMS);

    const inv = testDb.__all('inventory').find((r) => r.product_id === productId)!;
    expect(inv.quantity).toBe(40); // direct deduction fallback
    expect(inv.reserved_quantity).toBe(0);
  });
});

describe('Picking list & packing slip (PRD §31)', () => {
  it('picking list is status-gated and includes bin locations', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    seedSO({ status: 'reserved' });
    seedStock(productId, 'wh-1', 50);
    testDb.__insert('warehouse_locations', [{ id: 'loc-1', warehouse_id: 'wh-1', code: 'A-01-02', zone: 'A', rack: '01', shelf: '02' }]);
    testDb.__all('inventory')[0].location_id = 'loc-1';

    h.fakeClient = makeFakeClient();

    // reserved → not yet pickable
    await expect(SalesService.getPickingList('so-1', W1)).rejects.toMatchObject({ code: 'PICKING_NOT_ALLOWED' });

    await SalesService.updateStatus('so-1', W1, 'picking', ALICE, OWNER_PERMS);
    const list = await SalesService.getPickingList('so-1', W1);
    expect(list.lines).toHaveLength(1);
    expect(list.lines[0].qty_to_pick).toBe(10);
    expect(list.lines[0].location?.code).toBe('A-01-02');
  });

  it('packing slip exposes shipping data from picking onward', async () => {
    const productId = '77777777-7777-4777-8777-000000000001';
    seedSO({ status: 'confirmed' });
    seedStock(productId, 'wh-1', 50);
    h.fakeClient = makeFakeClient();

    await expect(SalesService.getPackingSlip('so-1', W1)).rejects.toMatchObject({ code: 'PACKING_NOT_ALLOWED' });

    testDb.__all('sales_orders')[0].status = 'picking';
    const slip = await SalesService.getPackingSlip('so-1', W1);
    expect(slip.customer?.name).toBe('Acme Corp');
    expect(slip.shipping_address).toBe('1 Test Way');
    expect(slip.lines[0].shipped_qty).toBe(0);
  });
});

describe('Available-stock formula consumers (Rule #15)', () => {
  const productId = '77777777-7777-4777-8777-000000000001';

  it('reorder recommendations, routing, and external API all respect reservations', async () => {
    seedSO({ status: 'reserved' }); // seeds wh-1 + item
    // 50 on hand, 10 reserved → 38... (50-10=40 available; reorder point 10 → no reorder)
    seedStock(productId, 'wh-1', 50, 10);
    // A second warehouse with stock for routing comparison
    testDb.__insert('warehouses', [{ id: 'wh-2', workspace_id: W1, name: 'West', code: 'WEST', status: 'active' }]);
    seedStock(productId, 'wh-2', 30, 25); // only 5 available

    // --- Reorder: available (40+5=45) above reorder point 10 → no recommendation
    const recs = await ReorderService.getRecommendations(W1);
    expect(recs.data.find((r: any) => r.product.id === productId)).toBeUndefined();

    // Push available below reorder point via a reservation → CRITICAL/HIGH appears
    testDb.__all('inventory').forEach((r) => {
      if (r.product_id === productId) r.reserved_quantity = r.quantity; // fully reserved
    });
    const recs2 = await ReorderService.getRecommendations(W1);
    const rec = recs2.data.find((r: any) => r.product.id === productId);
    expect(rec).toBeDefined();
    expect(rec.currentStock).toBe(0); // available, not on-hand (80 total on hand!)

    // --- Routing: ranks by AVAILABLE, so wh-2 (0 avail) loses to... both 0; tie-break picks wh-1 (50 on-hand) vs wh-2 (30) → first after sort by available desc is stable — assert it never picks a negative
    const routing = await RoutingService.optimizeFulfillmentLocation(W1, 'nowhere-region', productId);
    expect(routing.recommended_warehouse_id).toMatch(/wh-1|wh-2/);
    expect(routing.match_reason).toContain('available');

    // --- External API: quantity_available = on-hand - reserved
    const inv = await ExternalApiService.listInventory(W1);
    const row1 = inv.find((r: any) => r.product?.id === productId && r.quantity_on_hand === 50);
    expect(row1.quantity_available).toBe(0);
    expect(row1.quantity_reserved).toBe(50);
  });
});

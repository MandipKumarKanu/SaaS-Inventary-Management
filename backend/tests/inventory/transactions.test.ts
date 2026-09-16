import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Transaction-orchestration tests (Phase 2).
 *
 * The pg pool module is mocked with a recording fake that mirrors real
 * BEGIN/COMMIT/ROLLBACK semantics, and the inventory engine is driven through
 * the REAL services (transfer, purchase, sales, counts) using the in-memory
 * Supabase mock for all non-stock data. Concurrency tests against a real
 * Postgres live in concurrency.test.ts (opt-in).
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

import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { TransferService } from '../../src/modules/transfers/transfer.service';
import { PurchaseService } from '../../src/modules/purchases/purchase.service';
import { CountService } from '../../src/modules/inventory_counts/count.service';
import { seedWorld, wsId, userId } from '../helpers/world';
import { testDb } from '../setup';
import { PERMISSIONS } from '../../src/shared/permissions';

/**
 * Phase 2 tests call services directly (no HTTP layer), so they must pass the
 * member permissions the state machine now checks (Phase 4). Alice is Owner.
 */
const OWNER_PERMS = Object.values(PERMISSIONS) as string[];

function makeFakeClient(
  opts: {
    upsertRows?: any[];
    idempotencyRows?: any[];
    /** Called with the 1-based upsert counter; returns the query result rows */
    onUpsert?: (n: number, params: any[]) => any[];
  } = {}
) {
  const queries: Array<{ text: string; params: any[] }> = [];
  let upsertCount = 0;
  return {
    queries,
    lastUpsertParams() {
      const q = [...queries].reverse().find((q) => q.text.toLowerCase().includes('insert into inventory as inv'));
      return q?.params;
    },
    ledgerInserts() {
      return queries.filter((q) => q.text.trim().toLowerCase().startsWith('insert into inventory_transactions'));
    },
    async query(text: string, params: any[] = []) {
      queries.push({ text, params });
      const t = text.toLowerCase();
      if (t.includes('from inventory_transactions') && t.includes('idempotency_key = $2')) {
        return { rows: opts.idempotencyRows || [], rowCount: (opts.idempotencyRows || []).length };
      }
      if (t.includes('insert into inventory as inv')) {
        upsertCount += 1;
        const rows = opts.onUpsert
          ? opts.onUpsert(upsertCount, params)
          : opts.upsertRows || [];
        return { rows, rowCount: rows.length };
      }
      if (t.trim().toLowerCase().startsWith('insert into inventory_transactions')) {
        return { rows: [{ id: 'tx_generated', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      // Apply simple UPDATE shapes against the shared mock world so services
      // reading state afterwards (e.g. PO status derivation) observe them:
      //   UPDATE tbl SET col = col + $1 WHERE id = $N   (increment)
      //   UPDATE tbl SET col = $1 WHERE id = $N         (assign)
      //   UPDATE tbl SET col = TRUE WHERE id = $N       (flag)
      const upd = text.match(/update\s+(\w+)\s+set\s+(\w+)\s*=\s*(.+?)\s+where\s+id\s*=\s*\$(\d+)/i);
      if (upd) {
        const [, table, col, expr, pIdx] = upd;
        const id = params[Number(pIdx) - 1];
        const row = testDb.__all(table).find((r) => r.id === id);
        if (row) {
          const inc = expr.match(/^(\w+)\s*\+\s*\$(\d+)$/i);
          if (inc) row[col] = (row[col] || 0) + params[Number(inc[2]) - 1];
          else if (/^\$\d+$/i.test(expr)) row[col] = params[Number(expr.slice(1)) - 1];
          else if (/^true$/i.test(expr)) row[col] = true;
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const W1 = wsId(1);
const ALICE = userId(1);

beforeEach(() => {
  h.fakeClient = null;
  h.journal.length = 0;
  seedWorld(testDb);
});

describe('InventoryService.adjustStockTx (engine)', () => {
  it('commits balance upsert + ledger insert with computed before/after', async () => {
    const client = makeFakeClient({ upsertRows: [{ id: 'inv_1', quantity: 137 }] });
    h.fakeClient = client;

    const result = await InventoryService.adjustStock({
      workspaceId: W1,
      productId: 'p1',
      warehouseId: 'wh1',
      qtyChange: 12,
      movementType: 'purchase_received',
      userId: ALICE,
      idempotencyKey: 'k1',
    });

    expect(result.qtyAfter).toBe(137);
    expect(result.qtyBefore).toBe(125); // derived from locked DB state
    expect(result.duplicate).toBe(false);

    const upsert = client.lastUpsertParams();
    expect(upsert).toEqual([W1, 'p1', null, 'wh1', null, 12]);

    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].params[7]).toBe('purchase_received');
    expect(ledger[0].params[13]).toBe('k1'); // idempotency key stored (Phase 6: batch_id at 10 shifted it from 12 to 13)

    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rejects zero-delta movements before touching the database', async () => {
    const client = makeFakeClient();
    h.fakeClient = client;

    await expect(
      InventoryService.adjustStock({ workspaceId: W1, productId: 'p1', warehouseId: 'wh1', qtyChange: 0, movementType: 'adjustment', userId: ALICE })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(client.queries).toHaveLength(0);
  });

  it('throws INSUFFICIENT_STOCK when the locked upsert is rejected', async () => {
    const client = makeFakeClient({ upsertRows: [] }); // WHERE qty >= 0 rejected the mutation
    h.fakeClient = client;

    await expect(
      InventoryService.adjustStock({ workspaceId: W1, productId: 'p1', warehouseId: 'wh1', qtyChange: -50, movementType: 'sales_shipped', userId: ALICE })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    // No ledger row was written for the failed movement
    expect(client.ledgerInserts()).toHaveLength(0);
    // The transaction rolled back
    expect(h.journal).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('short-circuits duplicate idempotency keys without a new movement', async () => {
    const client = makeFakeClient({ idempotencyRows: [{ id: 'tx_existing' }] });
    h.fakeClient = client;

    const result = await InventoryService.adjustStock({
      workspaceId: W1, productId: 'p1', warehouseId: 'wh1', qtyChange: 5,
      movementType: 'adjustment', userId: ALICE, idempotencyKey: 'already-applied',
    });

    expect(result.duplicate).toBe(true);
    expect(client.queries.find((q) => q.text.toLowerCase().includes('insert into inventory as inv'))).toBeUndefined();
    expect(client.ledgerInserts()).toHaveLength(0);
  });
});

describe('InventoryService.adjustStockMany (atomic multi-item)', () => {
  it('applies all movements inside one transaction', async () => {
    const client = makeFakeClient({ onUpsert: (n) => [{ id: `inv_${n}`, quantity: 100 }] });
    h.fakeClient = client;

    const results = await InventoryService.adjustStockMany([
      { workspaceId: W1, productId: 'p1', warehouseId: 'whA', qtyChange: -10, movementType: 'transfer_out', userId: ALICE },
      { workspaceId: W1, productId: 'p1', warehouseId: 'whB', qtyChange: 10, movementType: 'transfer_in', userId: ALICE },
    ]);

    expect(results).toHaveLength(2);
    expect(client.lastUpsertParams()).toEqual([W1, 'p1', null, 'whB', null, 10]);
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back ALL movements when a later movement fails', async () => {
    // First movement succeeds, second is rejected (insufficient stock)
    const client = makeFakeClient({
      onUpsert: (n) => (n === 1 ? [{ id: 'inv_1', quantity: 10 }] : []),
    });
    h.fakeClient = client;

    await expect(
      InventoryService.adjustStockMany([
        { workspaceId: W1, productId: 'p1', warehouseId: 'whA', qtyChange: -10, movementType: 'transfer_out', userId: ALICE },
        { workspaceId: W1, productId: 'p2', warehouseId: 'whB', qtyChange: -9999, movementType: 'transfer_in', userId: ALICE },
      ])
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    expect(h.journal).toEqual(['BEGIN', 'ROLLBACK']);
    // The whole batch aborted — including the ledger insert of movement 1
    expect(client.ledgerInserts()).toHaveLength(1); // attempted, but rolled back
    expect(h.journal.includes('COMMIT')).toBe(false);
  });
});

describe('TransferService atomic ship/receive (PRD §22, §24)', () => {
  function seedTransfer(status: string, shippedAt: string | null = null) {
    testDb.__insert('warehouses', [
      { id: 'wh-src', workspace_id: W1, name: 'Main', code: 'MAIN' },
      { id: 'wh-dst', workspace_id: W1, name: 'West', code: 'WEST' },
    ]);
    testDb.__insert('stock_transfers', [{
      id: 'tr-1', workspace_id: W1, transfer_number: 'TR-000001',
      source_warehouse_id: 'wh-src', destination_warehouse_id: 'wh-dst',
      status, notes: null, created_by: ALICE, shipped_at: shippedAt,
    }]);
    testDb.__insert('stock_transfer_items', [
      { id: 'tri-1', transfer_id: 'tr-1', product_id: 'p1', requested_qty: 10 },
      { id: 'tri-2', transfer_id: 'tr-1', product_id: 'p2', requested_qty: 4 },
    ]);
  }

  it('ships: deducts ALL items from source atomically with retry keys', async () => {
    seedTransfer('requested');
    const client = makeFakeClient({ onUpsert: (n) => [{ id: `inv_${n}`, quantity: 90 }] });
    h.fakeClient = client;

    await TransferService.updateStatus('tr-1', W1, 'shipped', ALICE, OWNER_PERMS);

    // Two movements, both inside ONE transaction
    const upserts = client.queries.filter((q) => q.text.toLowerCase().includes('insert into inventory as inv'));
    expect(upserts).toHaveLength(2);
    expect(upserts[0].params[3]).toBe('wh-src'); // source warehouse
    expect(upserts[0].params[5]).toBe(-10); // negative delta
    expect(upserts[1].params[5]).toBe(-4);
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);

    // Retry-safe keys per item — Phase 6 partials: keys now carry the
    // cumulative shipped position (qty are incremental, position is truth)
    const idem = client.queries.filter((q) => q.text.includes('idempotency_key = $2'));
    expect(idem[0].params[1]).toBe('transfer:tr-1:ship:tri-1:0+10');
    expect(idem[1].params[1]).toBe('transfer:tr-1:ship:tri-2:0+4');

    // Header + item quantities updated
    expect(testDb.__all('stock_transfers')[0].status).toBe('shipped');
  });

  it('receives: adds stock to destination only after shipping', async () => {
    seedTransfer('shipped', new Date().toISOString());
    // Phase 6: receiving is capped by shipped_qty — reflect the prior shipment
    for (const it of testDb.__all('stock_transfer_items')) it.shipped_qty = it.requested_qty;
    const client = makeFakeClient({ onUpsert: (n) => [{ id: `inv_${n}`, quantity: 110 }] });
    h.fakeClient = client;

    await TransferService.updateStatus('tr-1', W1, 'completed', ALICE, OWNER_PERMS);

    const upserts = client.queries.filter((q) => q.text.toLowerCase().includes('insert into inventory as inv'));
    expect(upserts[0].params[3]).toBe('wh-dst'); // destination warehouse
    expect(upserts[0].params[5]).toBe(10); // positive delta
  });

  it('refuses to receive a transfer that was never shipped', async () => {
    seedTransfer('requested');
    const client = makeFakeClient();
    h.fakeClient = client;

    await expect(TransferService.updateStatus('tr-1', W1, 'completed', ALICE, OWNER_PERMS))
      .rejects.toMatchObject({ code: 'NOT_SHIPPED' });

    expect(h.journal).toEqual([]); // no transaction was even opened
  });
});

describe('PurchaseService.receiveItems atomic receiving', () => {
  function seedPO() {
    testDb.__insert('suppliers', [{ id: 'sup-1', workspace_id: W1, name: 'Acme' }]);
    testDb.__insert('warehouses', [{ id: 'wh-1', workspace_id: W1, name: 'Main', code: 'MAIN' }]);
    testDb.__insert('purchase_orders', [{
      id: 'po-1', workspace_id: W1, po_number: 'PO-000001', supplier_id: 'sup-1',
      warehouse_id: 'wh-1', status: 'ordered', subtotal: 100, total_amount: 100, created_by: ALICE,
    }]);
    testDb.__insert('purchase_order_items', [
      { id: 'poi-1', po_id: 'po-1', product_id: 'p1', ordered_qty: 50, received_qty: 0, unit_cost: 2 },
      { id: 'poi-2', po_id: 'po-1', product_id: 'p2', ordered_qty: 20, received_qty: 0, unit_cost: 1 },
    ]);
  }

  it('receives multiple items in one transaction with incremental received_qty', async () => {
    seedPO();
    const client = makeFakeClient({ onUpsert: (_n, params) => [{ id: `inv_x`, quantity: params[5] }] });
    h.fakeClient = client;

    await PurchaseService.receiveItems('po-1', W1, [
      { itemId: 'poi-1', qtyToReceive: 30 },
      { itemId: 'poi-2', qtyToReceive: 20 },
    ], ALICE, OWNER_PERMS);

    const upserts = client.queries.filter((q) => q.text.toLowerCase().includes('insert into inventory as inv'));
    expect(upserts).toHaveLength(2);
    expect(upserts[0].params[5]).toBe(30);
    expect(upserts[1].params[5]).toBe(20);
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
    expect(testDb.__all('purchase_orders')[0].status).toBe('partially_received');
  });

  it('rejects over-receipt before opening a transaction', async () => {
    seedPO();
    h.fakeClient = makeFakeClient();

    await expect(
      PurchaseService.receiveItems('po-1', W1, [{ itemId: 'poi-1', qtyToReceive: 60 }], ALICE, OWNER_PERMS)
    ).rejects.toMatchObject({ code: 'OVER_RECEIPT' });

    expect(h.journal).toEqual([]); // fail-fast: nothing started
  });

  it('rejects unknown item ids before opening a transaction', async () => {
    seedPO();
    h.fakeClient = makeFakeClient();

    await expect(
      PurchaseService.receiveItems('po-1', W1, [{ itemId: 'nope', qtyToReceive: 1 }], ALICE, OWNER_PERMS)
    ).rejects.toMatchObject({ code: 'UNKNOWN_PO_ITEM' });
    expect(h.journal).toEqual([]);
  });
});

describe('CountService.approveCount atomic corrections', () => {
  it('applies variances as stock_count_correction movements in one transaction', async () => {
    testDb.__insert('warehouses', [{ id: 'wh-1', workspace_id: W1, name: 'Main', code: 'MAIN' }]);
    testDb.__insert('inventory_counts', [{
      id: 'cnt-1', workspace_id: W1, warehouse_id: 'wh-1',
      count_number: 'CNT-000001', status: 'review', created_by: ALICE,
    }]);
    testDb.__insert('inventory_count_items', [
      { id: 'ci-1', count_id: 'cnt-1', product_id: 'p1', system_qty: 100, physical_qty: 97 },
      { id: 'ci-2', count_id: 'cnt-1', product_id: 'p2', system_qty: 50, physical_qty: 55 },
      { id: 'ci-3', count_id: 'cnt-1', product_id: 'p3', system_qty: 20, physical_qty: 20 }, // no variance
    ]);

    const client = makeFakeClient({ onUpsert: (_n, params) => [{ id: 'inv_c', quantity: params[5] > 0 ? params[5] : 0 }] });
    h.fakeClient = client;

    await CountService.approveCount('cnt-1', W1, ALICE, OWNER_PERMS);

    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(2); // only the two variance items
    expect(ledger[0].params[7]).toBe('stock_count_correction');
    expect(ledger[0].params[5]).toBe(-3); // 97 - 100
    expect(ledger[1].params[5]).toBe(5); // 55 - 50
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
    expect(testDb.__all('inventory_counts')[0].status).toBe('completed');
  });
});

describe('In-transaction audit rows (AuditService.logTx, PRD §41)', () => {
  function auditInserts(client: ReturnType<typeof makeFakeClient>) {
    return client.queries.filter((q) => q.text.toLowerCase().includes('insert into audit_logs'));
  }

  it('transfer.shipped writes the audit row inside the same transaction', async () => {
    testDb.__insert('warehouses', [
      { id: 'wh-src', workspace_id: W1, name: 'Main', code: 'MAIN' },
      { id: 'wh-dst', workspace_id: W1, name: 'West', code: 'WEST' },
    ]);
    testDb.__insert('stock_transfers', [{
      id: 'tr-a', workspace_id: W1, transfer_number: 'TR-000009',
      source_warehouse_id: 'wh-src', destination_warehouse_id: 'wh-dst',
      status: 'requested', notes: null, created_by: ALICE, shipped_at: null,
    }]);
    testDb.__insert('stock_transfer_items', [
      { id: 'tri-a', transfer_id: 'tr-a', product_id: 'p1', requested_qty: 5 },
    ]);

    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv_x', quantity: 95 }] });
    h.fakeClient = client;

    await TransferService.updateStatus('tr-a', W1, 'shipped', ALICE, OWNER_PERMS);

    const audits = auditInserts(client);
    expect(audits).toHaveLength(1);
    // Params: workspace_id, user_id, action, entity, entity_id, prev, next
    expect(audits[0].params.slice(0, 5)).toEqual([W1, ALICE, 'transfer.shipped', 'stock_transfer', 'tr-a']);
    // Journal proves the audit insert was issued between BEGIN and COMMIT
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
  });

  it('purchase receiving writes po.goods_received inside the transaction', async () => {
    testDb.__insert('suppliers', [{ id: 'sup-9', workspace_id: W1, name: 'Acme' }]);
    testDb.__insert('warehouses', [{ id: 'wh-9', workspace_id: W1, name: 'Main', code: 'MAIN' }]);
    testDb.__insert('purchase_orders', [{
      id: 'po-9', workspace_id: W1, po_number: 'PO-000009', supplier_id: 'sup-9',
      warehouse_id: 'wh-9', status: 'ordered', subtotal: 10, total_amount: 10, created_by: ALICE,
    }]);
    testDb.__insert('purchase_order_items', [
      { id: 'poi-9', po_id: 'po-9', product_id: 'p1', ordered_qty: 10, received_qty: 0, unit_cost: 1 },
    ]);

    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv_y', quantity: 10 }] });
    h.fakeClient = client;

    await PurchaseService.receiveItems('po-9', W1, [{ itemId: 'poi-9', qtyToReceive: 10 }], ALICE, OWNER_PERMS);

    const audits = auditInserts(client);
    expect(audits).toHaveLength(1);
    expect(audits[0].params[2]).toBe('po.goods_received');
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
  });

  it('rolls back the WHOLE transaction (stock movements included) when the audit write fails', async () => {
    testDb.__insert('warehouses', [
      { id: 'wh-s2', workspace_id: W1, name: 'Main', code: 'MAIN' },
      { id: 'wh-d2', workspace_id: W1, name: 'West', code: 'WEST' },
    ]);
    testDb.__insert('stock_transfers', [{
      id: 'tr-b', workspace_id: W1, transfer_number: 'TR-000010',
      source_warehouse_id: 'wh-s2', destination_warehouse_id: 'wh-d2',
      status: 'requested', notes: null, created_by: ALICE, shipped_at: null,
    }]);
    testDb.__insert('stock_transfer_items', [
      { id: 'tri-b1', transfer_id: 'tr-b', product_id: 'p1', requested_qty: 5 },
    ]);

    // Movements succeed, but the audit insert blows up (e.g. constraint/abort)
    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv_1', quantity: 10 }] });
    const realQuery = client.query.bind(client);
    client.query = async (text: string, params: any[] = []) => {
      if (text.toLowerCase().includes('insert into audit_logs')) {
        throw new Error('audit_logs insert failed');
      }
      return realQuery(text, params);
    };
    h.fakeClient = client;

    await expect(TransferService.updateStatus('tr-b', W1, 'shipped', ALICE, OWNER_PERMS))
      .rejects.toThrow('audit_logs insert failed');

    // Stock movements were attempted, but the transaction rolled back —
    // no "movement without its audit record" can ever commit (PRD §41).
    expect(client.queries.some((q) => q.text.toLowerCase().includes('insert into inventory as inv'))).toBe(true);
    expect(h.journal).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('mid-loop stock failure means the audit row is never attempted (fail-fast)', async () => {
    testDb.__insert('warehouses', [
      { id: 'wh-s3', workspace_id: W1, name: 'Main', code: 'MAIN' },
      { id: 'wh-d3', workspace_id: W1, name: 'West', code: 'WEST' },
    ]);
    testDb.__insert('stock_transfers', [{
      id: 'tr-c', workspace_id: W1, transfer_number: 'TR-000011',
      source_warehouse_id: 'wh-s3', destination_warehouse_id: 'wh-d3',
      status: 'requested', notes: null, created_by: ALICE, shipped_at: null,
    }]);
    testDb.__insert('stock_transfer_items', [
      { id: 'tri-c1', transfer_id: 'tr-c', product_id: 'p1', requested_qty: 5 },
      { id: 'tri-c2', transfer_id: 'tr-c', product_id: 'p2', requested_qty: 999999 }, // second leg fails
    ]);

    const client = makeFakeClient({
      onUpsert: (n) => (n === 1 ? [{ id: 'inv_1', quantity: 10 }] : []),
    });
    h.fakeClient = client;

    await expect(TransferService.updateStatus('tr-c', W1, 'shipped', ALICE, OWNER_PERMS))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    // Nothing committed: no audit row, and the header status was never updated
    expect(auditInserts(client)).toHaveLength(0);
    expect(h.journal).toEqual(['BEGIN', 'ROLLBACK']);
    expect(testDb.__all('stock_transfers')[0].status).toBe('requested');
  });
});

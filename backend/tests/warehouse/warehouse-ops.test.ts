import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 6 suite — Warehouse Ops Completion (PRD §24, §33, §34, §35, §38):
 *   - Blind counts: NULL physical before submit, threshold + second approver
 *   - Partial transfers: ship 30 then 20, two receipts, derived status
 *   - Batches: create/adjust move real stock, ledger carries batch_id
 *   - FEFO: earliest-expiry consumption order, EXPIRED_STOCK strict policy
 *   - Serials: receipt registration, duplicates, lifecycle transitions
 *   - Expiration alerts: idempotent worker notifications
 *
 * The pg pool module is mocked with the same recording fake as
 * transactions.test.ts (Phase 2); all Supabase reads go through the
 * in-memory mock driven by the REAL services.
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

import { CountService } from '../../src/modules/inventory_counts/count.service';
import { TransferService } from '../../src/modules/transfers/transfer.service';
import { BatchService } from '../../src/modules/batches/batch.service';
import { SalesService } from '../../src/modules/sales/sales.service';
import { SerialService } from '../../src/modules/serials/serial.service';
import { BackgroundWorkerService } from '../../src/services/worker.service';
import { seedWorld, wsId, userId } from '../helpers/world';
import { testDb } from '../setup';
import { PERMISSIONS } from '../../src/shared/permissions';

const OWNER_PERMS = Object.values(PERMISSIONS) as string[];
const W1 = wsId(1);
const ALICE = userId(1);
const BOB = userId(2);

function makeFakeClient(opts: { upsertRows?: any[]; onUpsert?: (n: number, params: any[]) => any[] } = {}) {
  const queries: Array<{ text: string; params: any[] }> = [];
  let upsertCount = 0;
  let grnCount = 0;
  return {
    queries,
    ledgerInserts() {
      return queries.filter((q) => q.text.trim().toLowerCase().startsWith('insert into inventory_transactions'));
    },
    async query(text: string, params: any[] = []) {
      queries.push({ text, params });
      const t = text.toLowerCase();

      if (t.includes('from inventory_transactions') && t.includes('idempotency_key = $2')) {
        return { rows: [], rowCount: 0 };
      }
      // Phase 8: goods-receipt document writes (GRN numbering + header/items)
      if (t.includes('next_document_number')) {
        grnCount += 1;
        return { rows: [{ number: `GRN-2026-00000${grnCount}` }], rowCount: 1 };
      }
      if (t.trim().toLowerCase().startsWith('insert into goods_receipts')) {
        return { rows: [{ id: `grn_${grnCount}` }], rowCount: 1 };
      }
      if (t.trim().toLowerCase().startsWith('insert into goods_receipt_items')) {
        return { rows: [], rowCount: 1 };
      }
      // SELECT serial state for lifecycle validation
      if (t.includes('from serial_numbers') && t.includes('select serial_number, status')) {
        const ws = params[0];
        const prod = params[1];
        const serials = params.slice(2);
        const found = testDb.__all('serial_numbers').filter(
          (r) => r.workspace_id === ws && r.product_id === prod && serials.includes(r.serial_number)
        );
        return { rows: found.map((r) => ({ serial_number: r.serial_number, status: r.status })), rowCount: found.length };
      }
      if (t.includes('insert into inventory as inv')) {
        upsertCount += 1;
        const rows = opts.onUpsert ? opts.onUpsert(upsertCount, params) : opts.upsertRows || [];
        return { rows, rowCount: rows.length };
      }
      if (t.trim().toLowerCase().startsWith('insert into inventory_transactions')) {
        return { rows: [{ id: 'tx_x', created_at: new Date().toISOString() }], rowCount: 1 };
      }
      if (t.trim().toLowerCase().startsWith('insert into serial_numbers')) {
        // Emulate the (workspace, product, serial) unique constraint
        const ws = params[0];
        const productId = params[1];
        const warehouseId = params[2];
        const serials = params.slice(3, params.length - 1);
        for (const s of serials) {
          const dup = testDb.__all('serial_numbers').find(
            (r) => r.workspace_id === ws && r.product_id === productId && r.serial_number === s
          );
          if (dup) {
            const err: any = new Error(`duplicate key value violates unique constraint`);
            err.code = '23505';
            throw err;
          }
          testDb.__insert('serial_numbers', [
            {
              id: `ser_${s}`,
              workspace_id: ws,
              product_id: productId,
              warehouse_id: warehouseId,
              serial_number: s,
              status: 'available',
              last_movement_ref: params[params.length - 1],
            },
          ]);
        }
        return { rows: [], rowCount: serials.length };
      }
      if (t.trim().toLowerCase().startsWith('insert into batches')) {
        // INSERT ... RETURNING id — persist a batch row like the real DB
        const [ws, productId, warehouseId, variantId, batchNumber, mfg, expiry, qty] = params;
        const id = `batch_${batchNumber}`;
        testDb.__insert('batches', [
          {
            id,
            workspace_id: ws,
            product_id: productId,
            warehouse_id: warehouseId,
            variant_id: variantId,
            batch_number: batchNumber,
            mfg_date: mfg,
            expiry_date: expiry,
            quantity: qty,
            synced_quantity: qty,
            created_at: new Date().toISOString(),
          },
        ]);
        return { rows: [{ id }], rowCount: 1 };
      }
      if (t.trim().toLowerCase().startsWith('insert into audit_logs')) {
        return { rows: [], rowCount: 1 };
      }
      // UPDATE shapes: increment / assign / status flips against shared mock
      const upd = text.match(/update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)$/is);
      if (upd) {
        const [, table, setPart, wherePart] = upd;
        const tbl = testDb.__all(table);
        // Match "id = $N" / "workspace_id = $1 AND product_id = $2 AND serial_number = ANY($3)"
        const assignments = setPart.split(',').map((s) => s.trim());
        const findMatchingRows = (): any[] => {
          const idM = wherePart.match(/\bid\s*=\s*\$(\d+)/i);
          if (idM) {
            const id = params[Number(idM[1]) - 1];
            return tbl.filter((r) => r.id === id);
          }
          // serial updates: workspace_id/product_id/serial_number/status combos
          const wsM = wherePart.match(/workspace_id\s*=\s*\$(\d+)/i);
          const prodM = wherePart.match(/product_id\s*=\s*\$(\d+)/i);
          const anyM = wherePart.match(/serial_number\s*=\s*ANY\(\$(\d+)\)/i);
          const serialInM = wherePart.match(/serial_number\s+in\s*\(([^)]+)\)/i);
          const statusM = wherePart.match(/status\s*=\s*'(\w+)'/i);
          if (wsM && prodM && (anyM || serialInM)) {
            const ws = params[Number(wsM[1]) - 1];
            const prod = params[Number(prodM[1]) - 1];
            const serialList = anyM
              ? params[Number(anyM[1]) - 1]
              : (serialInM![1].match(/\$\d+/g) || []).map((p) => params[Number(p.slice(1)) - 1]);
            return tbl.filter(
              (r) =>
                r.workspace_id === ws &&
                r.product_id === prod &&
                serialList.includes(r.serial_number) &&
                (!statusM || r.status === statusM[1])
            );
          }
          return [];
        };
        const matched = findMatchingRows();
        for (const row of matched) {
          for (const a of assignments) {
            const inc = a.match(/^(\w+)\s*=\s*(\w+)\s*([+-])\s*\$(\d+)$/i);
            const plain = a.match(/^(\w+)\s*=\s*\$(\d+)$/i);
            const nowStamp = a.match(/^(\w+)\s*=\s*NOW\(\)$/i);
            if (inc) {
              row[inc[1]] = (row[inc[1]] || 0) + (inc[3] === '-' ? -1 : 1) * params[Number(inc[4]) - 1];
            } else if (plain) {
              row[plain[1]] = params[Number(plain[2]) - 1];
            } else if (nowStamp) {
              row[nowStamp[1]] = new Date().toISOString();
            }
          }
        }
        return { rows: [], rowCount: matched.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Seed a warehouse + product with helper defaults; returns ids */
function seedProductWarehouse(over: Record<string, any> = {}) {
  testDb.__insert('warehouses', [{ id: 'wh-1', workspace_id: W1, name: 'Main', code: 'MAIN', status: 'active' }]);
  const product = {
    id: 'p-1',
    workspace_id: W1,
    name: 'Tracked Product',
    sku: 'TP-1',
    unit: 'pcs',
    track_expiry: false,
    track_serials: false,
    ...over.product,
  };
  testDb.__insert('products', [product]);
  return { warehouseId: 'wh-1', productId: 'p-1', product };
}

beforeEach(() => {
  h.fakeClient = null;
  h.journal.length = 0;
  seedWorld(testDb);
});

// ===========================================================================
// BLIND COUNTS (PRD §35)
// ===========================================================================
describe('Blind cycle counts', () => {
  it('creates a BLIND count sheet: physical_qty is NULL before submission', async () => {
    seedProductWarehouse();
    testDb.__insert('inventory', [{ id: 'inv-1', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', quantity: 100 }]);

    const count = await CountService.createCountSheet({ workspaceId: W1, warehouseId: 'wh-1', userId: ALICE });

    expect(count.items).toHaveLength(1);
    expect(count.items[0].physical_qty).toBeNull(); // blind — no expected qty leaked
    expect(count.items[0].system_qty).toBe(100);
  });

  it('variance within threshold: single approver completes the count', async () => {
    seedProductWarehouse();
    testDb.__insert('inventory', [{ id: 'inv-1', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', quantity: 100 }]);
    const sheet = await CountService.createCountSheet({ workspaceId: W1, warehouseId: 'wh-1', userId: ALICE });

    const client = makeFakeClient({ onUpsert: (_n, params) => [{ id: 'inv-c', quantity: params[5] }] });
    h.fakeClient = client;

    await CountService.submitPhysicalCounts(sheet.id, W1, [{ itemId: sheet.items[0].id, physicalQty: 97 }], BOB);
    const approved = await CountService.approveCount(sheet.id, W1, ALICE, OWNER_PERMS);

    expect(approved.status).toBe('completed');
    expect(approved.approved_by).toBe(ALICE);
    // One ledger correction: 97 - 100 = -3
    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].params[5]).toBe(-3);
    expect(ledger[0].params[7]).toBe('stock_count_correction');
  });

  it('variance above threshold: submitter cannot approve their own count', async () => {
    seedProductWarehouse();
    testDb.__insert('workspaces_rows', []); // no-op, keeps structure obvious
    (testDb.__all('workspaces')[0] as any).settings = { count_approval_threshold_pct: 10 };

    testDb.__insert('inventory', [{ id: 'inv-1', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', quantity: 100 }]);
    const sheet = await CountService.createCountSheet({ workspaceId: W1, warehouseId: 'wh-1', userId: ALICE });

    // 50% variance > 10% threshold
    await CountService.submitPhysicalCounts(sheet.id, W1, [{ itemId: sheet.items[0].id, physicalQty: 50 }], BOB);

    h.fakeClient = makeFakeClient({ onUpsert: (_n, params) => [{ id: 'inv-c', quantity: params[5] }] });

    // BOB submitted → BOB cannot approve (four-eyes)
    await expect(CountService.approveCount(sheet.id, W1, BOB, OWNER_PERMS)).rejects.toMatchObject({
      code: 'COUNT_SECOND_APPROVER_REQUIRED',
    });

    // ALICE (different user) can approve
    const approved = await CountService.approveCount(sheet.id, W1, ALICE, OWNER_PERMS);
    expect(approved.status).toBe('completed');
  });
});

// ===========================================================================
// PARTIAL TRANSFERS (PRD §24)
// ===========================================================================
describe('Partial transfers', () => {
  function seedTransfer(status: string, shippedAt: string | null = null) {
    testDb.__insert('warehouses', [
      { id: 'wh-src', workspace_id: W1, name: 'Main', code: 'MAIN', status: 'active' },
      { id: 'wh-dst', workspace_id: W1, name: 'West', code: 'WEST', status: 'active' },
    ]);
    testDb.__insert('stock_transfers', [
      {
        id: 'tr-1',
        workspace_id: W1,
        transfer_number: 'TR-000001',
        source_warehouse_id: 'wh-src',
        destination_warehouse_id: 'wh-dst',
        status,
        notes: null,
        created_by: ALICE,
        shipped_at: shippedAt,
      },
    ]);
    testDb.__insert('stock_transfer_items', [
      { id: 'tri-1', transfer_id: 'tr-1', product_id: 'p1', requested_qty: 50, shipped_qty: 0, received_qty: 0 },
    ]);
  }

  it('ships 30 of 50, then the remaining 20 — fully_shipped path', async () => {
    seedTransfer('approved');
    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-x', quantity: 70 }] });
    h.fakeClient = client;

    // First shipment: 30 units
    await TransferService.updateStatus('tr-1', W1, 'shipped', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 30 }]);
    expect(testDb.__all('stock_transfer_items')[0].shipped_qty).toBe(30);
    expect(testDb.__all('stock_transfers')[0].fully_shipped_at).toBeUndefined();

    // Second shipment: 20 units
    await TransferService.updateStatus('tr-1', W1, 'shipped', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 20 }]);
    expect(testDb.__all('stock_transfer_items')[0].shipped_qty).toBe(50);
    expect(testDb.__all('stock_transfers')[0].fully_shipped_at).not.toBeNull();

    // Ledger: two transfer_out movements (-30, -20)
    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(2);
    expect(ledger[0].params[5]).toBe(-30);
    expect(ledger[1].params[5]).toBe(-20);
  });

  it('receives in two legs (30 then 20) and derives completed status', async () => {
    seedTransfer('shipped', new Date().toISOString());
    // Fully shipped in a previous call
    testDb.__all('stock_transfer_items')[0].shipped_qty = 50;

    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-y', quantity: 80 }] });
    h.fakeClient = client;

    await TransferService.updateStatus('tr-1', W1, 'received', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 30 }]);
    expect(testDb.__all('stock_transfer_items')[0].received_qty).toBe(30);
    expect(testDb.__all('stock_transfers')[0].status).toBe('received');

    await TransferService.updateStatus('tr-1', W1, 'completed', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 20 }]);
    expect(testDb.__all('stock_transfer_items')[0].received_qty).toBe(50);
    expect(testDb.__all('stock_transfers')[0].status).toBe('completed');
  });

  it('rejects over-shipment without opening a transaction', async () => {
    seedTransfer('approved');
    h.fakeClient = makeFakeClient();

    await expect(
      TransferService.updateStatus('tr-1', W1, 'shipped', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 60 }])
    ).rejects.toMatchObject({ code: 'OVER_SHIPMENT' });

    expect(h.journal).toEqual([]);
  });

  it('rejects over-receipt beyond the shipped quantity', async () => {
    seedTransfer('shipped', new Date().toISOString());
    testDb.__all('stock_transfer_items')[0].shipped_qty = 30;
    h.fakeClient = makeFakeClient();

    await expect(
      TransferService.updateStatus('tr-1', W1, 'received', ALICE, OWNER_PERMS, [{ itemId: 'tri-1', qty: 40 }])
    ).rejects.toMatchObject({ code: 'OVER_RECEIPT' });
  });
});

// ===========================================================================
// BATCHES MOVE STOCK (PRD §33)
// ===========================================================================
describe('Batches that actually move stock', () => {
  it('create adds inventory AND writes a ledger row carrying batch_id', async () => {
    seedProductWarehouse();
    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-b', quantity: 25 }] });
    h.fakeClient = client;

    const batch = await BatchService.create({
      workspaceId: W1,
      productId: 'p-1',
      warehouseId: 'wh-1',
      batchNumber: 'LOT-001',
      expiryDate: '2027-06-30',
      quantity: 25,
      userId: ALICE,
    });

    expect(batch.batch_number).toBe('LOT-001');
    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].params[5]).toBe(25); // +25 into inventory
    expect(ledger[0].params[10]).toBe('batch_LOT-001'); // batch_id on the ledger row
    expect(h.journal).toEqual(['BEGIN', 'COMMIT']);
  });

  it('adjust writes off expired units from both batch and inventory', async () => {
    seedProductWarehouse();
    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-b', quantity: 20 }] });
    h.fakeClient = client;

    testDb.__insert('batches', [
      {
        id: 'batch-9',
        workspace_id: W1,
        product_id: 'p-1',
        warehouse_id: 'wh-1',
        batch_number: 'LOT-009',
        synced_quantity: 25,
        quantity: 25,
        expiry_date: '2026-01-01',
        product: { id: 'p-1', name: 'Tracked Product', sku: 'TP-1', track_expiry: true },
      },
    ]);

    const updated = await BatchService.adjust('batch-9', {
      workspaceId: W1,
      qtyChange: -5,
      reason: 'expired',
      userId: ALICE,
    });

    expect(updated.synced_quantity).toBe(20);
    const ledger = client.ledgerInserts();
    expect(ledger[0].params[5]).toBe(-5);
    expect(ledger[0].params[7]).toBe('expired'); // movement_type (index 7 after batch_id at 10)
  });

  it('rejects duplicate batch numbers for the same product+warehouse', async () => {
    seedProductWarehouse();
    testDb.__insert('batches', [
      { id: 'batch-dup', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'LOT-001', synced_quantity: 1, quantity: 1 },
    ]);
    h.fakeClient = makeFakeClient();

    await expect(
      BatchService.create({
        workspaceId: W1,
        productId: 'p-1',
        warehouseId: 'wh-1',
        batchNumber: 'LOT-001',
        quantity: 10,
        userId: ALICE,
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_BATCH' });

    expect(h.journal).toEqual([]); // never opened a transaction
  });
});

// ===========================================================================
// FEFO FULFILLMENT (PRD §33)
// ===========================================================================
describe('FEFO consumption in SO fulfillment', () => {
  function seedSO() {
    testDb.__insert('warehouses', [{ id: 'wh-1', workspace_id: W1, name: 'Main', code: 'MAIN', status: 'active' }]);
    testDb.__insert('customers', [{ id: 'cust-1', workspace_id: W1, name: 'Acme Corp' }]);
    testDb.__insert('sales_orders', [
      {
        id: 'so-1',
        workspace_id: W1,
        so_number: 'SO-000001',
        customer_id: 'cust-1',
        warehouse_id: 'wh-1',
        // Phase 7: fulfillment ships from reserved/picking/packed only —
        // 'confirmed' must reserve first, so seed past the reservation gate.
        status: 'reserved',
        subtotal: 100,
        total_amount: 100,
        created_by: ALICE,
      },
    ]);
    testDb.__insert('sales_order_items', [
      { id: 'soi-1', so_id: 'so-1', product_id: 'p-1', ordered_qty: 40, fulfilled_qty: 0, unit_price: 2.5 },
    ]);
  }

  function seedBatches() {
    testDb.__insert('batches', [
      { id: 'b-exp30', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'EXP-30D', expiry_date: futureIso(30), synced_quantity: 10, quantity: 10 },
      { id: 'b-exp10', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'EXP-10D', expiry_date: futureIso(10), synced_quantity: 15, quantity: 15 },
      { id: 'b-exp20', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'EXP-20D', expiry_date: futureIso(20), synced_quantity: 20, quantity: 20 },
    ]);
  }

  function futureIso(days: number) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it('consumes batches in expiry order: 10d → 20d → 30d', async () => {
    seedProductWarehouse({ product: { track_expiry: true } });
    seedSO();
    seedBatches();
    // getById embed resolves product for SO items — set track_expiry via select
    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-s', quantity: 60 }] });
    h.fakeClient = client;

    await SalesService.fulfillOrder('so-1', W1, ALICE, OWNER_PERMS);

    const ledger = client.ledgerInserts();
    expect(ledger).toHaveLength(3);
    // FEFO order: 15 from 10d, 20 from 20d, 5 from 30d
    expect(ledger[0].params[5]).toBe(-15);
    expect(ledger[1].params[5]).toBe(-20);
    expect(ledger[2].params[5]).toBe(-5);
    // batch_id recorded on every movement
    expect(ledger[0].params[10]).toBe('b-exp10');
    expect(ledger[1].params[10]).toBe('b-exp20');
    expect(ledger[2].params[10]).toBe('b-exp30');
  });

  it('EXPIRED_STOCK: fails when only expired batches remain (strict policy)', async () => {
    seedProductWarehouse({ product: { track_expiry: true } });
    seedSO();
    testDb.__insert('batches', [
      { id: 'b-old', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'OLD', expiry_date: '2020-01-01', synced_quantity: 99, quantity: 99 },
    ]);
    h.fakeClient = makeFakeClient({ onUpsert: () => [{ id: 'inv-s', quantity: 60 }] });

    await expect(SalesService.fulfillOrder('so-1', W1, ALICE, OWNER_PERMS)).rejects.toMatchObject({
      code: 'EXPIRED_STOCK',
    });
  });
});

// ===========================================================================
// SERIALS (PRD §34)
// ===========================================================================
describe('Serial number lifecycle', () => {
  it('PO receipt registers serials in-tx; duplicates abort the whole receipt', async () => {
    seedProductWarehouse({ product: { track_serials: true } });
    testDb.__insert('suppliers', [{ id: 'sup-1', workspace_id: W1, name: 'Acme' }]);
    testDb.__insert('purchase_orders', [
      {
        id: 'po-1', workspace_id: W1, po_number: 'PO-000001', supplier_id: 'sup-1',
        warehouse_id: 'wh-1', status: 'ordered', subtotal: 10, total_amount: 10, created_by: ALICE,
      },
    ]);
    testDb.__insert('purchase_order_items', [
      { id: 'poi-1', po_id: 'po-1', product_id: 'p-1', ordered_qty: 2, received_qty: 0, unit_cost: 5 },
    ]);

    const client = makeFakeClient({ onUpsert: () => [{ id: 'inv-p', quantity: 2 }] });
    h.fakeClient = client;

    await (await import('../../src/modules/purchases/purchase.service')).PurchaseService.receiveItems(
      'po-1', W1,
      [{ itemId: 'poi-1', qtyToReceive: 2, serials: ['SN-001', 'SN-002'] }],
      ALICE, OWNER_PERMS
    );

    const serials = testDb.__all('serial_numbers');
    expect(serials).toHaveLength(2);
    expect(serials.every((s) => s.status === 'available')).toBe(true);
  });

  it('serial transitions enforce the lifecycle map', async () => {
    const client = makeFakeClient();
    h.fakeClient = client;
    testDb.__insert('serial_numbers', [
      { id: 'ser-1', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', serial_number: 'SN-100', status: 'available' },
    ]);

    // available → sold is legal
    await SerialService.markShipped(client, {
      workspaceId: W1, productId: 'p-1', serials: ['SN-100'], soId: 'so-x', userId: ALICE,
    });
    expect(testDb.__all('serial_numbers')[0].status).toBe('sold');

    // sold → in_transit is illegal
    await expect(
      SerialService.markTransferredOut(client, {
        workspaceId: W1, productId: 'p-1', serials: ['SN-100'], transferId: 'tr-x', userId: ALICE,
      })
    ).rejects.toMatchObject({ code: 'INVALID_SERIAL_TRANSITION' });
  });

  it('unknown serials are rejected with 404', async () => {
    const client = makeFakeClient();
    h.fakeClient = client;

    await expect(
      SerialService.markShipped(client, {
        workspaceId: W1, productId: 'p-1', serials: ['NOPE'], soId: 'so-x', userId: ALICE,
      })
    ).rejects.toMatchObject({ code: 'UNKNOWN_SERIAL' });
  });
});

// ===========================================================================
// EXPIRATION ALERTS (PRD §38)
// ===========================================================================
describe('Expiration alert worker', () => {
  it('creates notifications for batches inside the alert window; re-run adds no duplicates', async () => {
    seedProductWarehouse({ product: { track_expiry: true } });
    const expiringIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    testDb.__insert('batches', [
      { id: 'b-alert', workspace_id: W1, product_id: 'p-1', warehouse_id: 'wh-1', batch_number: 'SOON', expiry_date: expiringIso, synced_quantity: 5, quantity: 5, product: { id: 'p-1', name: 'Tracked Product', sku: 'TP-1' } },
    ]);

    // Emulate the unique partial index (workspace, batch, day): the mock's
    // insert() must return an error shaped like a DB constraint violation.
    const db = testDb as any;
    const realFrom = db.from.bind(db);
    db.from = (table: string, opts?: any) => {
      const builder = realFrom(table, opts);
      if (table === 'notifications') {
        const realInsert = builder.insert.bind(builder);
        builder.insert = (rows: any) => {
          const list = Array.isArray(rows) ? rows : [rows];
          for (const r of list) {
            const dup = testDb.__all('notifications').find(
              (n) => n.workspace_id === r.workspace_id && n.reference_id === r.reference_id && n.type === 'expiring_batch'
            );
            if (dup) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' }, count: 0 });
            }
          }
          return realInsert(rows);
        };
      }
      return builder;
    };

    await BackgroundWorkerService.runExpirationAlertsJob();
    expect(testDb.__all('notifications')).toHaveLength(1);
    expect(testDb.__all('notifications')[0].severity).toBe('warning');

    // Re-run: idempotent (dup insert returns error → worker skips counting)
    await BackgroundWorkerService.runExpirationAlertsJob();
    expect(testDb.__all('notifications')).toHaveLength(1);
  });
});

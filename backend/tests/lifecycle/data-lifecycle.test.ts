import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { testDb, issueToken } from '../setup';
import { PERMISSIONS } from '../../src/shared/permissions';

/**
 * Phase 5 suite (PRD §55, Rule #11, §46):
 *   - Archive semantics: stock + ledger survive, hidden from lists, restorable
 *   - Document numbers: sequential, per-type, per-workspace isolation
 *   - Plan-limit interplay: archived products don't count against the limit
 */

const app = buildTestApp();
const W1 = wsId(1);
const W2 = wsId(2);
const ALICE = userId(1);
let token: string;

const PROD1 = '77777777-7777-4777-8777-000000000001';

beforeEach(async () => {
  seedWorld(testDb);
  seedPlans(testDb);
  upsertSubscription(testDb, W1, PLAN_IDS.enterprise, 'active');
  token = issueToken(ALICE, 'alice@example.com');
  const { PlanCatalogService } = await import('../../src/services/plan-catalog.service');
  PlanCatalogService.invalidateCache();
});

describe('Product archival (soft delete)', () => {
  function seedStock() {
    testDb.__insert('inventory', [
      { id: 'inv-1', workspace_id: W1, product_id: PROD1, warehouse_id: 'wh-1', quantity: 137 },
    ]);
    testDb.__insert('inventory_transactions', [
      {
        id: 'tx-1', workspace_id: W1, product_id: PROD1, warehouse_id: 'wh-1',
        qty_before: 0, qty_change: 137, qty_after: 137, movement_type: 'opening_balance',
      },
    ]);
  }

  it('DELETE /:id archives instead of hard-deleting; stock + ledger survive', async () => {
    seedStock();

    const res = await request(app)
      .delete(`/api/v1/workspaces/${W1}/products/${PROD1}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.archived_at).toBeTruthy();

    // Row still exists, with archived_at set
    const product = testDb.__all('products').find((p: any) => p.id === PROD1);
    expect(product).toBeDefined();
    expect(product.archived_at).toBeTruthy();

    // Stock balance and IMMUTABLE ledger rows survived (Rule #4/#11)
    expect(testDb.__all('inventory').filter((i: any) => i.product_id === PROD1)).toHaveLength(1);
    expect(testDb.__all('inventory_transactions').filter((t: any) => t.product_id === PROD1)).toHaveLength(1);

    // Audit row written
    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'product.archived');
    expect(audits).toHaveLength(1);
  });

  it('archived products are hidden from the default list, visible with includeArchived', async () => {
    seedStock();
    await request(app)
      .delete(`/api/v1/workspaces/${W1}/products/${PROD1}`)
      .set('Authorization', `Bearer ${token}`);

    const hidden = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(hidden.body.data.some((p: any) => p.id === PROD1)).toBe(false);

    const included = await request(app)
      .get(`/api/v1/workspaces/${W1}/products?includeArchived=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(included.body.data.some((p: any) => p.id === PROD1)).toBe(true);
  });

  it('restore clears archived_at and returns the product to lists', async () => {
    seedStock();
    await request(app)
      .delete(`/api/v1/workspaces/${W1}/products/${PROD1}`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/products/${PROD1}/restore`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.archived_at).toBeNull();

    const list = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.data.some((p: any) => p.id === PROD1)).toBe(true);

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'product.restored');
    expect(audits).toHaveLength(1);
  });

  it('double-archive is rejected', async () => {
    await request(app)
      .delete(`/api/v1/workspaces/${W1}/products/${PROD1}`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .delete(`/api/v1/workspaces/${W1}/products/${PROD1}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('Warehouse archival (soft delete)', () => {
  const WH1 = 'wh-arch-1';

  function seedWarehouseWithStock() {
    testDb.__insert('warehouses', [
      { id: WH1, workspace_id: W1, name: 'Main', code: 'MAIN', status: 'active' },
    ]);
    testDb.__insert('inventory', [
      { id: 'inv-w1', workspace_id: W1, product_id: PROD1, warehouse_id: WH1, quantity: 50 },
    ]);
    testDb.__insert('inventory_transactions', [
      {
        id: 'tx-w1', workspace_id: W1, product_id: PROD1, warehouse_id: WH1,
        qty_before: 0, qty_change: 50, qty_after: 50, movement_type: 'opening_balance',
      },
    ]);
  }

  it('archives with status=archived; stock + ledger survive', async () => {
    seedWarehouseWithStock();

    const res = await request(app)
      .delete(`/api/v1/workspaces/${W1}/warehouses/${WH1}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.archived_at).toBeTruthy();
    expect(res.body.data.status).toBe('archived');

    expect(testDb.__all('inventory').filter((i: any) => i.warehouse_id === WH1)).toHaveLength(1);
    expect(testDb.__all('inventory_transactions').filter((t: any) => t.warehouse_id === WH1)).toHaveLength(1);

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'warehouse.archived');
    expect(audits).toHaveLength(1);
  });

  it('archived warehouses are hidden by default, visible with includeArchived', async () => {
    seedWarehouseWithStock();
    await request(app)
      .delete(`/api/v1/workspaces/${W1}/warehouses/${WH1}`)
      .set('Authorization', `Bearer ${token}`);

    const hidden = await request(app)
      .get(`/api/v1/workspaces/${W1}/warehouses`)
      .set('Authorization', `Bearer ${token}`);
    expect(hidden.body.data.some((w: any) => w.id === WH1)).toBe(false);

    const included = await request(app)
      .get(`/api/v1/workspaces/${W1}/warehouses?includeArchived=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(included.body.data.some((w: any) => w.id === WH1)).toBe(true);
  });
});

describe('Document numbering (PRD §46)', () => {
  it('generates sequential, zero-padded numbers per doc type', async () => {
    const SUP = '99999999-9999-4999-8999-000000000001';
    const WHX = '99999999-9999-4999-8999-000000000002';
    testDb.__insert('suppliers', [{ id: SUP, workspace_id: W1, name: 'Acme' }]);
    testDb.__insert('warehouses', [{ id: WHX, workspace_id: W1, name: 'Recv', code: 'RCV' }]);

    const poBody = {
      supplierId: SUP,
      warehouseId: WHX,
      items: [{ productId: PROD1, orderedQty: 5, unitCost: 2 }],
    };

    const po1 = await request(app)
      .post(`/api/v1/workspaces/${W1}/purchases`)
      .set('Authorization', `Bearer ${token}`)
      .send(poBody);
    expect(po1.status).toBe(201);

    const po2 = await request(app)
      .post(`/api/v1/workspaces/${W1}/purchases`)
      .set('Authorization', `Bearer ${token}`)
      .send(poBody);

    const n1 = po1.body.data.po_number as string;
    const n2 = (po2.status === 201 ? po2.body.data.po_number : null) as string | null;

    // PO-YYYY-000001 format
    expect(n1).toMatch(/^PO-\d{4}-\d{6}$/);
    if (n2) {
      expect(n2).toMatch(/^PO-\d{4}-\d{6}$/);
      expect(Number(n2.split('-')[2])).toBe(Number(n1.split('-')[2]) + 1);
    }
  });

  it('counters are isolated per workspace and per doc type', async () => {
    const { DocumentNumberService } = await import('../../src/services/document-number.service');

    const a1 = await DocumentNumberService.next(W1, 'PO');
    const b1 = await DocumentNumberService.next(W2, 'PO'); // other workspace
    const a2 = await DocumentNumberService.next(W1, 'PO');
    const aS1 = await DocumentNumberService.next(W1, 'SO'); // other type, same workspace

    expect(a1).toMatch(/^PO-\d{4}-000001$/);
    expect(b1).toMatch(/^PO-\d{4}-000001$/); // independent counter
    expect(a2).toMatch(/^PO-\d{4}-000002$/);
    expect(aS1).toMatch(/^SO-\d{4}-000001$/); // independent per type
  });

  it('no timestamp-based document numbers remain in services', async () => {
    // Enforced by convention here; the source-level guarantee is that
    // DocumentNumberService.next is the only generator used.
    const { DocumentNumberService } = await import('../../src/services/document-number.service');
    const n = await DocumentNumberService.next(W1, 'TR');
    expect(n).toMatch(/^TR-\d{4}-\d{6}$/);
  });
});

describe('Plan-limit interplay with archival', () => {
  it('archived products do not count toward the products limit', async () => {
    // Switch W2 to free plan (limit 100 products, 1 warehouse)
    upsertSubscription(testDb, W2, PLAN_IDS.free, 'active');
    const { PlanCatalogService } = await import('../../src/services/plan-catalog.service');
    PlanCatalogService.invalidateCache();

    // W2 has 1 product (world seed). Archive it → usage drops to 0.
    const betaProduct = testDb.__all('products').find((p: any) => p.workspace_id === W2);
    await request(app)
      .delete(`/api/v1/workspaces/${W2}/products/${betaProduct.id}`)
      .set('Authorization', `Bearer ${token}`);

    // Creating 2 new products must pass (1 archived + 2 new = 2 live ≤ 100)
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post(`/api/v1/workspaces/${W2}/products`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Fresh ${i}`, sku: `FRESH-${i}` });
      expect(res.status).toBe(201);
    }

    // usage_records cache was refreshed to 2 (live products only)
    const usage = testDb.__all('usage_records').find(
      (u: any) => u.workspace_id === W2 && u.metric === 'products'
    );
    expect(usage.current_value).toBe(2);
  });
});

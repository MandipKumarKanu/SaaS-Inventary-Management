import { describe, it, expect } from 'vitest';

/**
 * Pagination contract tests (follow-up workstream B).
 *
 * Every workspace list endpoint follows the opt-in rule:
 * - page absent  -> all rows + meta { page: 1, pageSize: total, total, totalPages: 1 }
 * - page present -> .range() slice + meta { page, pageSize, total, totalPages }
 * Existing filters/scopes must keep working; `data` key is always an array.
 */
import { supabaseAdmin } from '../../src/config/supabase.js';
import { ReorderService } from '../../src/modules/reorder/reorder.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { SalesService } from '../../src/modules/sales/sales.service.js';
import { PurchaseService } from '../../src/modules/purchases/purchase.service.js';
import { TransferService } from '../../src/modules/transfers/transfer.service.js';
import { ReturnService } from '../../src/modules/returns/return.service.js';
import { CountService } from '../../src/modules/inventory_counts/count.service.js';
import { SupplierService } from '../../src/modules/suppliers/supplier.service.js';
import { CustomerService } from '../../src/modules/customers/customer.service.js';
import { WarehouseService } from '../../src/modules/warehouses/warehouse.service.js';
import { CategoryService } from '../../src/modules/categories/category.service.js';
import { BatchService } from '../../src/modules/batches/batch.service.js';
import { WebhookService } from '../../src/modules/webhooks/webhook.service.js';
import { APIKeyService } from '../../src/modules/api_keys/api_key.service.js';
import { BackupService } from '../../src/modules/backup/backup.service.js';
import { CurrencyService } from '../../src/modules/currencies/currency.service.js';
import { RoutingService } from '../../src/modules/routing/routing.service.js';
import { ShippingService } from '../../src/modules/shipping/shipping.service.js';
import { SecurityService } from '../../src/modules/security/security.service.js';

const WS = 'ws-paginate-test';

async function seed(table: string, rows: Record<string, any>[]) {
  const { error } = await supabaseAdmin
    .from(table)
    .insert(rows.map((r) => ({ workspace_id: WS, ...r })));
  expect(error).toBeNull();
}

describe('opt-in pagination contract', () => {
  it('reorder: urgency filter + summary + slice', async () => {
    await seed('products', [
      { id: 'p-zero', name: 'Zero', sku: 'Z1', reorder_point: 10 },
      { id: 'p-low', name: 'Low', sku: 'L1', reorder_point: 10 },
      { id: 'p-mid', name: 'Mid', sku: 'M1', reorder_point: 10 },
    ]);
    await seed('inventory', [
      { product_id: 'p-zero', quantity: 0 },
      { product_id: 'p-low', quantity: 3 },
      { product_id: 'p-mid', quantity: 8 },
    ]);

    const all = await ReorderService.getRecommendations(WS, {});
    expect(all.data).toHaveLength(3);
    expect(all.meta).toMatchObject({ page: 1, total: 3, totalPages: 1 });
    expect(all.meta.summary).toMatchObject({ total: 3, criticalCount: 1 });
    expect(all.meta.summary.suggestedTotal).toBeGreaterThan(0);

    const crit = await ReorderService.getRecommendations(WS, { page: 1, pageSize: 5, urgency: 'CRITICAL' });
    expect(crit.data).toHaveLength(1);
    expect(crit.data[0].urgency).toBe('CRITICAL');
    expect(crit.meta).toMatchObject({ total: 1, totalPages: 1 });

    const std = await ReorderService.getRecommendations(WS, { urgency: 'standard' });
    expect(std.data).toHaveLength(1);
    expect(std.data[0].urgency).toBe('MEDIUM');

    const bogus = await ReorderService.getRecommendations(WS, { urgency: 'NOPE' });
    expect(bogus.data).toHaveLength(3);

    const sliced = await ReorderService.getRecommendations(WS, { page: 2, pageSize: 2 });
    expect(sliced.data).toHaveLength(1);
    expect(sliced.meta).toMatchObject({ page: 2, total: 3, totalPages: 2 });
  });

  it('notifications: severity filter + counts + slice', async () => {
    await seed('products', [
      { id: 'np-err', name: 'Gone', sku: 'G1', reorder_point: 5 },
      { id: 'np-warn', name: 'Lowish', sku: 'L2', reorder_point: 5 },
    ]);
    await seed('inventory', [
      { product_id: 'np-err', quantity: 0 },
      { product_id: 'np-warn', quantity: 2 },
    ]);
    await seed('stock_transfers', [
      { id: 'nt-1', transfer_number: 'T-1', status: 'requested' },
    ]);

    const all = await NotificationService.getWorkspaceNotifications(WS, {});
    expect(all.meta.counts).toMatchObject({ all: 3, error: 1, warning: 1, info: 1 });

    const errs = await NotificationService.getWorkspaceNotifications(WS, {
      page: 1,
      pageSize: 5,
      severity: 'error',
    });
    expect(errs.data).toHaveLength(1);
    expect(errs.data[0].severity).toBe('error');
    expect(errs.meta).toMatchObject({ total: 1 });
    expect(errs.meta.counts.all).toBe(3);
  });

  it('order-style lists: status filter preserved, page slices', async () => {
    await seed('sales_orders', [
      { id: 'so-1', status: 'draft' },
      { id: 'so-2', status: 'fulfilled' },
      { id: 'so-3', status: 'draft' },
    ]);
    const page1 = await SalesService.list(WS, undefined, { page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.meta).toMatchObject({ page: 1, total: 3, totalPages: 2 });

    const drafts = await SalesService.list(WS, 'draft', {});
    expect(drafts.data).toHaveLength(2);
    expect(drafts.meta.total).toBe(2);

    const all = await SalesService.list(WS);
    expect(all.data).toHaveLength(3);
    expect(all.meta).toMatchObject({ page: 1, totalPages: 1 });
  });

  it('purchases / transfers / returns / counts: shape + paging', async () => {
    await seed('purchase_orders', [{ id: 'po-1', status: 'draft' }, { id: 'po-2', status: 'draft' }]);
    await seed('stock_transfers', [{ id: 'tr-1', status: 'requested' }]);
    await seed('customer_returns', [{ id: 'r-1', status: 'pending' }]);
    await seed('inventory_counts', [{ id: 'c-1', status: 'open' }]);

    const po = await PurchaseService.list(WS, undefined, { page: 2, pageSize: 1 });
    expect(po.data).toHaveLength(1);
    expect(po.meta).toMatchObject({ page: 2, total: 2, totalPages: 2 });

    // Positional-filter call style still works (backward compat with old callers).
    const tr = await TransferService.list(WS, 'requested');
    expect(tr.data).toHaveLength(1);

    expect((await ReturnService.list(WS, undefined, {})).meta.total).toBe(1);
    expect((await CountService.list(WS, undefined, {})).data).toHaveLength(1);
  });

  it('catalog lists: paging + preserved ordering/filters', async () => {
    await seed('suppliers', [{ id: 's-1', name: 'Acme' }, { id: 's-2', name: 'Beta' }]);
    await seed('customers', [{ id: 'cu-1', name: 'Zed' }]);
    await seed('warehouses', [{ id: 'w-1', name: 'Main', code: 'M' }]);
    await seed('categories', [{ id: 'cat-1', name: 'Tools' }]);

    const sup = await SupplierService.list(WS, { page: 1, pageSize: 1 });
    expect(sup.data).toHaveLength(1);
    expect(sup.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect((await CustomerService.list(WS, {})).data).toHaveLength(1);
    expect((await WarehouseService.list(WS)).data).toHaveLength(1);
    expect((await CategoryService.list(WS)).meta.total).toBe(1);
  });

  it('batches: warehouse filter + expirationStatus survive paging', async () => {
    await seed('batches', [
      { id: 'b-past', warehouse_id: 'w-9', expiry_date: '2020-01-01' },
      { id: 'b-future', warehouse_id: 'w-9', expiry_date: '2099-01-01' },
    ]);
    const res = await BatchService.list(WS, 'w-9', { page: 1, pageSize: 10 });
    expect(res.data).toHaveLength(2);
    expect(res.data.map((b: any) => b.expirationStatus).sort()).toEqual(['Expired', 'Valid']);
    expect(res.meta.total).toBe(2);

    const other = await BatchService.list(WS, 'w-other', {});
    expect(other.data).toHaveLength(0);
  });

  it('ops lists: webhooks / api-keys (allowlist) / backups / currencies / routing / shipping', async () => {
    await seed('webhook_subscriptions', [{ id: 'wh-1' }]);
    await seed('api_keys', [{ id: 'k-1', name: 'ci', key_prefix: 'abc', key_hash: 'SECRET' }]);
    await seed('workspace_backups', [{ id: 'bk-1' }]);
    await seed('currencies', [{ id: 'cur-1', code: 'EUR', rate: 0.9 }]);
    await seed('warehouse_routing_rules', [{ id: 'rr-1', priority: 1 }]);
    await seed('shipping_labels', [{ id: 'sl-1' }, { id: 'sl-2' }, { id: 'sl-3' }]);

    expect((await WebhookService.listSubscriptions(WS, {})).meta.total).toBe(1);

    const keys = await APIKeyService.list(WS, { page: 1, pageSize: 5 });
    expect(keys.data).toHaveLength(1);
    expect(keys.data[0]).not.toHaveProperty('key_hash');
    expect(keys.data[0]).toHaveProperty('key_prefix');

    expect((await BackupService.listBackups(WS, {})).meta.total).toBe(1);
    expect((await CurrencyService.list(WS, {})).data.length).toBeGreaterThanOrEqual(1);
    expect((await RoutingService.listRules(WS, {})).meta.total).toBe(1);

    const labels = await ShippingService.listLabels(WS, { page: 2, pageSize: 2 });
    expect(labels.data).toHaveLength(1);
    expect(labels.meta).toMatchObject({ page: 2, total: 3, totalPages: 2 });
  });

  it('security: default-50 preserved, page slices with meta', async () => {
    await seed('security_events', [
      { id: 'se-1', action: 'login' },
      { id: 'se-2', action: 'login' },
    ]);
    const def = await SecurityService.listEvents(WS, {});
    expect(def.data).toHaveLength(2);
    expect(def.meta.pageSize).toBe(50);

    const paged = await SecurityService.listEvents(WS, { page: 1, pageSize: 1 });
    expect(paged.data).toHaveLength(1);
    expect(paged.meta).toMatchObject({ page: 1, total: 2, totalPages: 2 });
  });
});

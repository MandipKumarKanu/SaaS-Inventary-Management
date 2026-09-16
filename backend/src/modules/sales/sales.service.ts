import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';
import { FefoService } from '../../services/fefo.service.js';

export interface SOItemInput {
  productId: string;
  variantId?: string;
  orderedQty: number;
  unitPrice: number;
}

export interface CreateSODTO {
  workspaceId: string;
  customerId?: string;
  warehouseId: string;
  shippingAddress?: string;
  notes?: string;
  items: SOItemInput[];
  userId: string;
}

export class SalesService {
  static async list(workspaceId: string, status?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('sales_orders')
      .select('*, customer:customers(id, name), warehouse:warehouses(id, name, code), items:sales_order_items(*, product:products(id, name, sku))', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (page) query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const total = count || 0;
    return { data: data || [], meta: { page: page || 1, pageSize: page ? pageSize : total, total, totalPages: page ? Math.ceil(total / pageSize) : 1 } };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('sales_orders')
      .select('*, customer:customers(id, name, email, phone, address), warehouse:warehouses(id, name, code), items:sales_order_items(*, product:products(id, name, sku, track_expiry))')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Sales Order not found');
    return data;
  }

  static async createSO(dto: CreateSODTO) {
    if (!dto.items || dto.items.length === 0) {
      throw AppError.badRequest('Sales order must contain at least one line item');
    }

    const soNumber = await DocumentNumberService.next(dto.workspaceId, 'SO');
    const subtotal = dto.items.reduce((acc, it) => acc + (it.orderedQty * it.unitPrice), 0);
    const totalAmount = subtotal;

    const { data: so, error: sErr } = await supabaseAdmin
      .from('sales_orders')
      .insert({
        workspace_id: dto.workspaceId,
        so_number: soNumber,
        customer_id: dto.customerId || null,
        warehouse_id: dto.warehouseId,
        status: 'confirmed',
        subtotal,
        total_amount: totalAmount,
        shipping_address: dto.shippingAddress || null,
        notes: dto.notes || null,
        created_by: dto.userId,
      })
      .select()
      .single();

    if (sErr) throw sErr;

    const itemInserts = dto.items.map((it) => ({
      so_id: so.id,
      product_id: it.productId,
      variant_id: it.variantId || null,
      unit_price: it.unitPrice,
      ordered_qty: it.orderedQty,
    }));

    const { error: iErr } = await supabaseAdmin
      .from('sales_order_items')
      .insert(itemInserts);

    if (iErr) throw iErr;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'so.created',
      entity: 'sales_order',
      entityId: so.id,
      newValue: { so_number: soNumber, total_amount: totalAmount },
    });

    return this.getById(so.id, dto.workspaceId);
  }

  static async updateStatus(id: string, workspaceId: string, newStatus: string, userId: string, userPermissions: string[] = []) {
    const so = await this.getById(id, workspaceId);

    // Phase 4: state machine gate — no arbitrary status jumps (PRD §76)
    StateMachine.assertCanTransition('sales_order', so.status, newStatus, userPermissions);

    const { data: updated, error } = await supabaseAdmin
      .from('sales_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: `so.${newStatus}`,
      entity: 'sales_order',
      entityId: id,
      previousValue: { status: so.status },
      newValue: { status: newStatus },
    });

    return this.getById(id, workspaceId);
  }  static async fulfillOrder(id: string, workspaceId: string, userId: string, userPermissions: string[] = []) {
    const so = await this.getById(id, workspaceId);

    // Phase 4: composite-forward edge — fulfillment walks the forward path to
    // 'shipped' in one stock-moving operation (pre-flight decision #2).
    StateMachine.assertCanStockTransition('sales_order', so.status, 'shipped', userPermissions);

    // Phase 6 (PRD §33): resolve FEFO consumption BEFORE opening the
    // transaction — fail-fast if batch-tracked stock can't cover the order.
    const fefoPlans = new Map<string, Awaited<ReturnType<typeof FefoService.plan>>>();
    for (const item of so.items) {
      const qtyToShip = item.ordered_qty - (item.fulfilled_qty || 0);
      if (qtyToShip <= 0) continue;

      if (item.product?.track_expiry) {
        fefoPlans.set(
          item.id,
          await FefoService.plan(workspaceId, item.product_id, so.warehouse_id, qtyToShip, {
            variantId: item.variant_id || undefined,
          })
        );
      }
    }

    // Deduct stock for all items via Central Inventory Engine.
    // Phase 2: ALL shipments commit atomically (PRD §22); the audit row is
    // written in the same transaction (PRD §41).
    await withTransaction(async (client) => {
      for (const item of so.items) {
        const qtyToShip = item.ordered_qty - (item.fulfilled_qty || 0);
        if (qtyToShip <= 0) continue;

        const plan = fefoPlans.get(item.id);
        const movements: Array<{ qty: number; batchId?: string; batchNumber?: string | null }> = plan
          ? plan.slices.map((s) => ({ qty: s.qty, batchId: s.batchId, batchNumber: s.batchNumber }))
          : [{ qty: qtyToShip }];

        for (const mv of movements) {
          const result = await InventoryService.adjustStockTx(client, {
            workspaceId,
            productId: item.product_id,
            variantId: item.variant_id || undefined,
            warehouseId: so.warehouse_id,
            qtyChange: -mv.qty,
            movementType: 'sales_shipped',
            referenceType: 'sales_order',
            referenceId: so.id,
            batchId: mv.batchId,
            notes: plan
              ? `Sales Order ${so.so_number} shipped (${mv.qty} units, FEFO batch ${mv.batchNumber})`
              : `Sales Order ${so.so_number} shipped (${mv.qty} units)`,
            userId,
            idempotencyKey: `so:${id}:ship:${item.id}:${item.fulfilled_qty || 0}:${mv.batchId || 'nobatch'}`,
          });

          if (!result.duplicate && mv.batchId) {
            // Keep the consumed batch's ledger-derived balance in step
            await client.query(
              `UPDATE batches SET synced_quantity = synced_quantity - $1 WHERE id = $2`,
              [mv.qty, mv.batchId]
            );
          }
        }

        if (!fefoPlans.has(item.id) || plan) {
          await client.query(
            `UPDATE sales_order_items SET fulfilled_qty = fulfilled_qty + $1 WHERE id = $2`,
            [qtyToShip, item.id]
          );
        }
      }

      await AuditService.logTx(client, {
        workspaceId,
        userId,
        action: 'so.shipped',
        entity: 'sales_order',
        entityId: id,
        newValue: { status: 'shipped' },
      });
    });

    const { data: updated, error } = await supabaseAdmin
      .from('sales_orders')
      .update({ status: 'shipped', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    return this.getById(id, workspaceId);
  }
}

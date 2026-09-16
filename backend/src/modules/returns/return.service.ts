import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';

export interface ReturnItemInput {
  productId: string;
  variantId?: string;
  returnedQty: number;
  reason?: string;
  condition?: 'resellable' | 'damaged' | 'defective';
}

export interface CreateReturnDTO {
  workspaceId: string;
  salesOrderId?: string;
  customerId?: string;
  warehouseId: string;
  notes?: string;
  items: ReturnItemInput[];
  userId: string;
}

export interface RestockItemInput {
  itemId: string;
  restockQty: number;
}

export class ReturnService {
  static async list(workspaceId: string, status?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('customer_returns')
      .select('*, customer:customers(id, name), warehouse:warehouses(id, name, code), items:customer_return_items(*, product:products(id, name, sku))', { count: 'exact' })
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
      .from('customer_returns')
      .select('*, customer:customers(id, name), warehouse:warehouses(id, name, code), sales_order:sales_orders(id, so_number), items:customer_return_items(*, product:products(id, name, sku))')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Customer Return record not found');
    return data;
  }

  static async createReturn(dto: CreateReturnDTO) {
    if (!dto.items || dto.items.length === 0) {
      throw AppError.badRequest('Customer return must contain at least one line item');
    }

    const returnNumber = await DocumentNumberService.next(dto.workspaceId, 'RMA');

    const { data: ret, error: rErr } = await supabaseAdmin
      .from('customer_returns')
      .insert({
        workspace_id: dto.workspaceId,
        return_number: returnNumber,
        sales_order_id: dto.salesOrderId || null,
        customer_id: dto.customerId || null,
        warehouse_id: dto.warehouseId,
        status: 'requested',
        notes: dto.notes || null,
        created_by: dto.userId,
      })
      .select()
      .single();

    if (rErr) throw rErr;

    const itemInserts = dto.items.map((it) => ({
      return_id: ret.id,
      product_id: it.productId,
      variant_id: it.variantId || null,
      returned_qty: it.returnedQty,
      reason: it.reason || null,
      condition: it.condition || 'resellable',
    }));

    const { error: iErr } = await supabaseAdmin
      .from('customer_return_items')
      .insert(itemInserts);

    if (iErr) throw iErr;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'return.created',
      entity: 'customer_return',
      entityId: ret.id,
      newValue: { return_number: returnNumber },
    });

    return this.getById(ret.id, dto.workspaceId);
  }

  static async inspectAndRestock(id: string, workspaceId: string, items: RestockItemInput[], userId: string, userPermissions: string[] = []) {
    const ret = await this.getById(id, workspaceId);

    // Phase 4: composite-forward edge to completed — restocking moves stock
    // (pre-flight decision #2). Route already gates on returns.restock.
    StateMachine.assertStockTransition('customer_return', ret.status, 'completed');

    // Fail-fast validation, then atomic restock (PRD §22)
    const targets: Array<{ item: any; restockQty: number }> = [];
    for (const entry of items) {
      if (!entry.restockQty || entry.restockQty <= 0) continue;
      const item = ret.items.find((it: any) => it.id === entry.itemId);
      if (!item) {
        throw AppError.badRequest(`Unknown return item: ${entry.itemId}`, 'UNKNOWN_RETURN_ITEM');
      }
      const totalAfter = (item.restocked_qty || 0) + entry.restockQty;
      if (totalAfter > item.returned_qty) {
        throw AppError.badRequest(
          `Cannot restock ${entry.restockQty} units: would exceed returned quantity (${item.returned_qty})`,
          'OVER_RESTOCK'
        );
      }
      targets.push({ item, restockQty: entry.restockQty });
    }

    // Restock movements AND the completion audit row commit together (PRD §22, §41)
    await withTransaction(async (client) => {
      for (const { item, restockQty } of targets) {
        const result = await InventoryService.adjustStockTx(client, {
          workspaceId,
          productId: item.product_id,
          variantId: item.variant_id || undefined,
          warehouseId: ret.warehouse_id,
          qtyChange: restockQty,
          movementType: 'customer_return',
          referenceType: 'customer_return',
          referenceId: ret.id,
          notes: `RMA ${ret.return_number} restocked (${restockQty} units, condition: ${item.condition})`,
          userId,
          idempotencyKey: `rma:${ret.id}:restock:${item.id}:${item.restocked_qty || 0}+${restockQty}`,
        });
        if (!result.duplicate) {
          await client.query(
            `UPDATE customer_return_items SET restocked_qty = restocked_qty + $1 WHERE id = $2`,
            [restockQty, item.id]
          );
        }
      }

      await AuditService.logTx(client, {
        workspaceId,
        userId,
        action: 'return.completed',
        entity: 'customer_return',
        entityId: id,
        newValue: { status: 'completed' },
      });
    });

    const { data: updated, error } = await supabaseAdmin
      .from('customer_returns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    return this.getById(id, workspaceId);
  }
}

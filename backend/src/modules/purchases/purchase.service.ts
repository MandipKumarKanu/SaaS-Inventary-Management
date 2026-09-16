import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService, AdjustStockInput } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';
import { SerialService } from '../serials/serial.service.js';

export interface POItemInput {
  productId: string;
  variantId?: string;
  orderedQty: number;
  unitCost: number;
}

export interface CreatePODTO {
  workspaceId: string;
  supplierId: string;
  warehouseId: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: POItemInput[];
  userId: string;
}

export interface ReceiveItemInput {
  itemId: string;
  qtyToReceive: number;
  /** Phase 6 (PRD §34): required when the product tracks serials — must match qtyToReceive */
  serials?: string[];
}

export class PurchaseService {
  static async list(workspaceId: string, status?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name), warehouse:warehouses(id, name, code), items:purchase_order_items(*, product:products(id, name, sku))', { count: 'exact' })
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
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name, contact_name, email), warehouse:warehouses(id, name, code), items:purchase_order_items(*, product:products(id, name, sku, track_serials))')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Purchase Order not found');
    return data;
  }

  static async createPO(dto: CreatePODTO) {
    if (!dto.items || dto.items.length === 0) {
      throw AppError.badRequest('Purchase order must contain at least one line item');
    }

    const poNumber = await DocumentNumberService.next(dto.workspaceId, 'PO');
    const subtotal = dto.items.reduce((acc, it) => acc + (it.orderedQty * it.unitCost), 0);
    const totalAmount = subtotal; // can expand for tax/discount if needed

    const { data: po, error: pErr } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        workspace_id: dto.workspaceId,
        po_number: poNumber,
        supplier_id: dto.supplierId,
        warehouse_id: dto.warehouseId,
        status: 'ordered',
        subtotal,
        total_amount: totalAmount,
        expected_delivery_date: dto.expectedDeliveryDate || null,
        notes: dto.notes || null,
        created_by: dto.userId,
      })
      .select()
      .single();

    if (pErr) throw pErr;

    const itemInserts = dto.items.map((it) => ({
      po_id: po.id,
      product_id: it.productId,
      variant_id: it.variantId || null,
      unit_cost: it.unitCost,
      ordered_qty: it.orderedQty,
    }));

    const { error: iErr } = await supabaseAdmin
      .from('purchase_order_items')
      .insert(itemInserts);

    if (iErr) throw iErr;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'po.created',
      entity: 'purchase_order',
      entityId: po.id,
      newValue: { po_number: poNumber, total_amount: totalAmount },
    });

    return this.getById(po.id, dto.workspaceId);
  }

  static async updateStatus(id: string, workspaceId: string, newStatus: string, userId: string, userPermissions: string[] = []) {
    const po = await this.getById(id, workspaceId);

    // Phase 4: state machine gate — no arbitrary status jumps (PRD §76)
    StateMachine.assertCanTransition('purchase_order', po.status, newStatus, userPermissions);

    const { data: updated, error } = await supabaseAdmin
      .from('purchase_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    await AuditService.log({
      workspaceId,
      userId,
      action: `po.${newStatus}`,
      entity: 'purchase_order',
      entityId: id,
      previousValue: { status: po.status },
      newValue: { status: newStatus },
    });

    return this.getById(id, workspaceId);
  }

  static async receiveItems(id: string, workspaceId: string, items: ReceiveItemInput[], userId: string, userPermissions: string[] = []) {
    const po = await this.getById(id, workspaceId);

    // Phase 4: composite-forward edge to received/partially_received —
    // receiving moves stock (pre-flight decision #2)
    StateMachine.assertCanStockTransition('purchase_order', po.status, 'partially_received', userPermissions);

    // Fail-fast validation BEFORE any stock change: unknown items,
    // over-receipt, and serial mismatches reject the whole batch (PRD §46, §76).
    const targets: Array<{ item: any; qtyToReceive: number; serials: string[] }> = [];
    for (const entry of items) {
      if (!entry.qtyToReceive || entry.qtyToReceive <= 0) continue;
      const item = po.items.find((it: any) => it.id === entry.itemId);
      if (!item) {
        throw AppError.badRequest(`Unknown purchase order item: ${entry.itemId}`, 'UNKNOWN_PO_ITEM');
      }
      const totalAfter = (item.received_qty || 0) + entry.qtyToReceive;
      if (totalAfter > item.ordered_qty) {
        throw AppError.badRequest(
          `Cannot receive ${entry.qtyToReceive} units: would exceed ordered quantity (${item.ordered_qty})`,
          'OVER_RECEIPT'
        );
      }
      // Serial validation (PRD §34): track_serials products NEED one serial per unit
      const tracksSerials = item.product?.track_serials ?? false;
      const serials = entry.serials || [];
      if (tracksSerials && serials.length !== entry.qtyToReceive) {
        throw AppError.badRequest(
          `Product ${item.product?.sku || item.product_id} tracks serials: exactly ${entry.qtyToReceive} serial number(s) required, got ${serials.length}`,
          'SERIALS_REQUIRED'
        );
      }
      if (!tracksSerials && serials.length > 0) {
        throw AppError.badRequest(
          `Product ${item.product?.sku || item.product_id} does not track serials — remove the serial list`,
          'SERIALS_NOT_TRACKED'
        );
      }
      targets.push({ item, qtyToReceive: entry.qtyToReceive, serials });
    }

    // Phase 2: ALL receipts commit atomically — a failure mid-batch rolls back
    // every stock movement AND received_qty update (PRD §22). The audit row is
    // written in the same transaction (PRD §41) so it can never be lost.
    await withTransaction(async (client) => {
      for (const t of targets) {
        const { item, qtyToReceive, serials: itemSerials } = t;
        const result = await InventoryService.adjustStockTx(client, {
          workspaceId,
          productId: item.product_id,
          variantId: item.variant_id || undefined,
          warehouseId: po.warehouse_id,
          qtyChange: qtyToReceive,
          movementType: 'purchase_received',
          referenceType: 'purchase_order',
          referenceId: po.id,
          notes: `PO ${po.po_number} goods received (${qtyToReceive} units)`,
          userId,
          idempotencyKey: `po:${id}:receive:${item.id}:${item.received_qty || 0}+${qtyToReceive}`,
        });
        if (!result.duplicate) {
          await client.query(
            `UPDATE purchase_order_items SET received_qty = received_qty + $1 WHERE id = $2`,
            [qtyToReceive, item.id]
          );
        }

        // Phase 6 (PRD §34): register serials INSIDE the same transaction —
        // duplicates abort the whole receipt.
        if (itemSerials.length > 0) {
          await SerialService.registerOnReceipt(client, {
            workspaceId,
            productId: item.product_id,
            warehouseId: po.warehouse_id,
            serials: itemSerials,
            poId: id,
            userId,
          });
        }
      }

      await AuditService.logTx(client, {
        workspaceId,
        userId,
        action: 'po.goods_received',
        entity: 'purchase_order',
        entityId: id,
        newValue: { received: targets.map((t) => ({ itemId: t.item.id, qty: t.qtyToReceive, serials: t.serials.length > 0 ? t.serials.length : undefined })) },
      });
    });

    // Refresh PO and check overall fulfillment
    const updatedPO = await this.getById(id, workspaceId);
    let allReceived = true;
    let anyReceived = false;

    for (const item of updatedPO.items) {
      if (item.received_qty < item.ordered_qty) {
        allReceived = false;
      }
      if (item.received_qty > 0) {
        anyReceived = true;
      }
    }

    const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status;

    if (newStatus !== po.status) {
      await supabaseAdmin
        .from('purchase_orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id);
    }

    return this.getById(id, workspaceId);
  }
}

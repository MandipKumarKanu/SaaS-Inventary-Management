import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService, AdjustStockInput } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';

export interface TransferItemInput {
  productId: string;
  variantId?: string;
  requestedQty: number;
}

export interface TransferQtyInput {
  itemId: string;
  /** INCREMENTAL amount to ship/receive in THIS call (PRD §24 partials). */
  qty: number;
}

export interface CreateTransferDTO {
  workspaceId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes?: string;
  items: TransferItemInput[];
  userId: string;
}

export class TransferService {
  static async list(workspaceId: string, status?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('stock_transfers')
      .select('*, source_warehouse:warehouses!source_warehouse_id(id, name, code), destination_warehouse:warehouses!destination_warehouse_id(id, name, code), items:stock_transfer_items(*, product:products(id, name, sku))', { count: 'exact' })
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
      .from('stock_transfers')
      .select('*, source_warehouse:warehouses!source_warehouse_id(id, name, code), destination_warehouse:warehouses!destination_warehouse_id(id, name, code), items:stock_transfer_items(*, product:products(id, name, sku))')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Transfer record not found');
    return data;
  }

  static async create(dto: CreateTransferDTO) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw AppError.badRequest('Source and destination warehouses must be different');
    }
    if (!dto.items || dto.items.length === 0) {
      throw AppError.badRequest('Transfer must contain at least one item');
    }

    const transferNumber = await DocumentNumberService.next(dto.workspaceId, 'TR');

    // Insert Transfer Header
    const { data: transfer, error: tErr } = await supabaseAdmin
      .from('stock_transfers')
      .insert({
        workspace_id: dto.workspaceId,
        transfer_number: transferNumber,
        source_warehouse_id: dto.sourceWarehouseId,
        destination_warehouse_id: dto.destinationWarehouseId,
        status: 'requested',
        notes: dto.notes || null,
        created_by: dto.userId,
      })
      .select()
      .single();

    if (tErr) throw tErr;

    // Insert Items
    const itemInserts = dto.items.map((it) => ({
      transfer_id: transfer.id,
      product_id: it.productId,
      variant_id: it.variantId || null,
      requested_qty: it.requestedQty,
    }));

    const { error: iErr } = await supabaseAdmin
      .from('stock_transfer_items')
      .insert(itemInserts);

    if (iErr) throw iErr;

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'transfer.created',
      entity: 'stock_transfer',
      entityId: transfer.id,
      newValue: { transfer_number: transferNumber },
    });

    return this.getById(transfer.id, dto.workspaceId);
  }

  /**
   * Status Pipeline: requested -> approved -> shipped -> in_transit -> received -> completed
   *
   * Phase 6 (PRD §24): ship/receive are now INCREMENTAL and quantity-driven.
   * Pass `items` to move partial quantities per item; omit it for the legacy
   * full-quantity behavior (used by older clients and Phase 2/4 tests).
   *
   * Phase 2: ALL stock movements for a status transition run inside ONE
   * database transaction (PRD §22 — no "source -10, destination unchanged").
   * Per-item idempotency keys make ship/receive retry-safe (PRD §24): a
   * retried call after a partial failure applies only the missing movements.
   */
  static async updateStatus(
    id: string,
    workspaceId: string,
    newStatus: string,
    userId: string,
    userPermissions: string[] = [],
    items?: TransferQtyInput[]
  ) {
    const transfer = await this.getById(id, workspaceId);

    // Phase 4: state machine gate — no arbitrary status jumps (PRD §76).
    // Transfer status updates ARE stock-moving (ship deducts, receive adds),
    // so the stock gate applies: stock-derived edges + composite-forward.
    // EXCEPTION (Phase 6): a partial follow-up call while the header already
    // shows that status is legal (ship 30, then ship 20 more) — the header
    // status does not change, only per-item quantities move.
    const isPartialFollowUp =
      !!items && (transfer.status === newStatus || (newStatus === 'completed' && transfer.status === 'received'));
    if (!isPartialFollowUp) {
      StateMachine.assertCanStockTransition('stock_transfer', transfer.status, newStatus, userPermissions);
    }

    const movements: AdjustStockInput[] = [];
    const itemQtyUpdates: Array<{ itemId: string; col: 'shipped_qty' | 'received_qty'; qty: number }> = [];

    const itemById = new Map<string, any>(transfer.items.map((it: any) => [it.id, it]));

    /**
     * Resolve per-item quantities for this call (partial or full-legacy).
     * Exceeding the outstanding cap is a hard 422 — never silently capped.
     */
    function qtyFor(item: any, col: 'shipped_qty' | 'received_qty', cap: number, errorCode: 'OVER_SHIPMENT' | 'OVER_RECEIPT'): number | null {
      if (items) {
        const entry = items.find((i) => i.itemId === item.id);
        if (!entry) return null; // item not touched in this call
        if (!Number.isInteger(entry.qty) || entry.qty <= 0) {
          throw AppError.badRequest(`Quantity for item ${item.id} must be a positive integer`, 'INVALID_QUANTITY');
        }
        if (entry.qty > cap) {
          throw AppError.badRequest(
            col === 'shipped_qty'
              ? `Cannot ship ${entry.qty} units: would exceed requested quantity (${item.requested_qty}, already shipped ${item.shipped_qty || 0})`
              : `Cannot receive ${entry.qty} units: only ${item.shipped_qty || 0} were shipped (${item.received_qty || 0} already received)`,
            errorCode
          );
        }
        return entry.qty;
      }
      // Legacy full-quantity path: move everything still outstanding
      return cap;
    }

    if (newStatus === 'shipped' || newStatus === 'in_transit') {
      // Deduct stock from source warehouse via Central Inventory Engine
      for (const item of transfer.items) {
        const outstanding = item.requested_qty - (item.shipped_qty || 0);
        const qty = qtyFor(item, 'shipped_qty', outstanding, 'OVER_SHIPMENT');
        if (qty == null || qty <= 0) continue;

        movements.push({
          workspaceId,
          productId: item.product_id,
          variantId: item.variant_id || undefined,
          warehouseId: transfer.source_warehouse_id,
          qtyChange: -qty,
          movementType: 'transfer_out',
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          notes: `Transfer ${transfer.transfer_number} shipped (${qty} units)`,
          userId,
          idempotencyKey: `transfer:${id}:ship:${item.id}:${item.shipped_qty || 0}+${qty}`,
        });
        itemQtyUpdates.push({ itemId: item.id, col: 'shipped_qty', qty });
      }
      if (items && movements.length === 0) {
        throw AppError.badRequest('No valid items supplied for shipment', 'NO_ITEMS');
      }
    } else if ((newStatus === 'completed' || newStatus === 'received') && transfer.status !== 'completed') {
      if (!transfer.shipped_at) {
        throw AppError.badRequest('Transfer must be shipped before it can be received', 'NOT_SHIPPED');
      }
      // Add stock to destination warehouse — NEVER more than was shipped
      for (const item of transfer.items) {
        const outstanding = (item.shipped_qty || 0) - (item.received_qty || 0);
        const qty = qtyFor(item, 'received_qty', outstanding, 'OVER_RECEIPT');
        if (qty == null || qty <= 0) continue;

        movements.push({
          workspaceId,
          productId: item.product_id,
          variantId: item.variant_id || undefined,
          warehouseId: transfer.destination_warehouse_id,
          qtyChange: qty,
          movementType: 'transfer_in',
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          notes: `Transfer ${transfer.transfer_number} received (${qty} units)`,
          userId,
          idempotencyKey: `transfer:${id}:receive:${item.id}:${item.received_qty || 0}+${qty}`,
        });
        itemQtyUpdates.push({ itemId: item.id, col: 'received_qty', qty });
      }
      if (items && movements.length === 0) {
        throw AppError.badRequest('No valid items supplied for receipt', 'NO_ITEMS');
      }
    }

    // Stock movements AND the audit row commit together (PRD §22, §41):
    // the "who/why" of the transfer can never be lost to a post-commit crash.
    await withTransaction(async (client) => {
      for (let i = 0; i < movements.length; i++) {
        const result = await InventoryService.adjustStockTx(client, movements[i]);
        if (!result.duplicate) {
          const u = itemQtyUpdates[i];
          await client.query(`UPDATE stock_transfer_items SET ${u.col} = ${u.col} + $1 WHERE id = $2`, [u.qty, u.itemId]);
        }
      }

      await AuditService.logTx(client, {
        workspaceId,
        userId,
        action: `transfer.${newStatus}`,
        entity: 'stock_transfer',
        entityId: id,
        previousValue: { status: transfer.status },
        newValue: { status: newStatus, items: itemQtyUpdates.map((u) => ({ itemId: u.itemId, qty: u.qty })) },
      });
    });

    // Update Header Status (non-stock metadata; outside the stock transaction).
    // Status derives from item totals when receiving partially (PRD §24):
    // any received → 'received'; everything shipped has been received → 'completed'.
    let derivedStatus = newStatus;
    if (newStatus === 'received' || newStatus === 'completed') {
      const refreshed = await this.getById(id, workspaceId);
      const allReceived = refreshed.items.every((it: any) => (it.received_qty || 0) >= (it.shipped_qty || it.requested_qty));
      const anyReceived = refreshed.items.some((it: any) => (it.received_qty || 0) > 0);
      derivedStatus = allReceived ? 'completed' : anyReceived ? 'received' : newStatus;
    }

    const updateData: any = {
      status: derivedStatus,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === 'shipped' || newStatus === 'in_transit') updateData.shipped_at = transfer.shipped_at || new Date().toISOString();
    if (newStatus === 'completed' || newStatus === 'received') updateData.received_at = new Date().toISOString();

    // fully_shipped_at: shipping leg is complete when every item reached requested_qty
    if (newStatus === 'shipped' || newStatus === 'in_transit') {
      const refreshed = await this.getById(id, workspaceId);
      const allShipped = refreshed.items.every((it: any) => (it.shipped_qty || 0) >= it.requested_qty);
      if (allShipped) updateData.fully_shipped_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabaseAdmin
      .from('stock_transfers')
      .update(updateData)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    // Expose the four-eyes-style bookkeeping for API consumers
    return this.getById(id, workspaceId);
  }
}

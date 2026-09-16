import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';
import { FefoService } from '../../services/fefo.service.js';
import { ReservationService } from '../../services/reservation.service.js';
import { logger } from '../../config/logger.js';

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

  /**
   * Server-generated picking list (PRD §31). Status-gated to picking/packed:
   * picking before reservation makes no sense — the hold must exist first.
   */
  static async getPickingList(id: string, workspaceId: string) {
    const so = await this.getById(id, workspaceId);
    if (!['picking', 'packed'].includes(so.status)) {
      throw AppError.badRequest(
        `Picking list requires status 'picking' or 'packed' (currently '${so.status}') — reserve the order first`,
        'PICKING_NOT_ALLOWED'
      );
    }

    // Bin locations from the inventory rows at the fulfillment warehouse
    const { data: invRows } = await supabaseAdmin
      .from('inventory')
      .select('product_id, location_id')
      .eq('workspace_id', workspaceId)
      .eq('warehouse_id', so.warehouse_id);
    const locationByProduct = new Map<string, any>();
    for (const r of invRows || []) {
      if (!r.location_id || locationByProduct.has(r.product_id)) continue;
      const { data: loc } = await supabaseAdmin
        .from('warehouse_locations')
        .select('code, zone, rack, shelf, bin')
        .eq('id', r.location_id)
        .maybeSingle();
      locationByProduct.set(r.product_id, loc || null);
    }

    return {
      so_number: so.so_number,
      warehouse: so.warehouse,
      status: so.status,
      lines: so.items.map((it: any) => ({
        item_id: it.id,
        sku: it.product?.sku,
        name: it.product?.name,
        ordered_qty: it.ordered_qty,
        fulfilled_qty: it.fulfilled_qty || 0,
        qty_to_pick: it.ordered_qty - (it.fulfilled_qty || 0),
        location: locationByProduct.get(it.product_id) || null,
      })),
    };
  }

  /**
   * Server-generated packing slip (PRD §31). Available from 'picking'
   * onward (picking, packed, shipped) — quantities reflect fulfillment state.
   */
  static async getPackingSlip(id: string, workspaceId: string) {
    const so = await this.getById(id, workspaceId);
    if (!['picking', 'packed', 'shipped'].includes(so.status)) {
      throw AppError.badRequest(
        `Packing slip requires status 'picking', 'packed' or 'shipped' (currently '${so.status}')`,
        'PACKING_NOT_ALLOWED'
      );
    }

    return {
      so_number: so.so_number,
      customer: so.customer,
      shipping_address: so.shipping_address,
      warehouse: so.warehouse,
      status: so.status,
      lines: so.items.map((it: any) => ({
        sku: it.product?.sku,
        name: it.product?.name,
        ordered_qty: it.ordered_qty,
        shipped_qty: it.fulfilled_qty || 0,
      })),
      notes: so.notes || null,
    };
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

  /**
   * Status pipeline WITH stock side effects (Phase 7, PRD §30):
   *   - confirmed → reserved: RESERVES stock for every item (all-or-nothing)
   *   - → cancelled: RELEASES any active reservations first
   *   - picking/packed: metadata only (warehouse floor states)
   */
  static async updateStatus(id: string, workspaceId: string, newStatus: string, userId: string, userPermissions: string[] = []) {
    const so = await this.getById(id, workspaceId);

    // Phase 4: state machine gate — no arbitrary status jumps (PRD §76)
    StateMachine.assertCanTransition('sales_order', so.status, newStatus, userPermissions);

    // Stock side effects run in ONE transaction; the status flip follows it.
    if (newStatus === 'reserved') {
      // Reserve remaining qty for EVERY item — all-or-nothing (decision #1).
      await withTransaction(async (client) => {
        for (const item of so.items) {
          const outstanding = item.ordered_qty - (item.fulfilled_qty || 0);
          if (outstanding <= 0) continue;
          await ReservationService.reserveForOrderItem(client, {
            workspaceId,
            soId: id,
            soItemId: item.id,
            productId: item.product_id,
            variantId: item.variant_id || undefined,
            warehouseId: so.warehouse_id,
            qty: outstanding,
            userId,
          });
        }

        await AuditService.logTx(client, {
          workspaceId,
          userId,
          action: 'so.reserved',
          entity: 'sales_order',
          entityId: id,
          previousValue: { status: so.status },
          newValue: { status: newStatus, items: so.items.length },
        });
      });
    } else if (newStatus === 'cancelled') {
      // Release holds BEFORE the status flip — releasing is the point of cancelling
      await withTransaction(async (client) => {
        await ReservationService.releaseForOrder(client, { workspaceId, soId: id, userId });
        await AuditService.logTx(client, {
          workspaceId,
          userId,
          action: 'so.cancelled',
          entity: 'sales_order',
          entityId: id,
          previousValue: { status: so.status },
          newValue: { status: newStatus },
        });
      });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('sales_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;

    // Non-stock transitions still get a plain audit row
    if (newStatus !== 'reserved' && newStatus !== 'cancelled') {
      await AuditService.log({
        workspaceId,
        userId,
        action: `so.${newStatus}`,
        entity: 'sales_order',
        entityId: id,
        previousValue: { status: so.status },
        newValue: { status: newStatus },
      });
    }

    return this.getById(id, workspaceId);
  }

  /**
   * Fulfillment CONVERTS reservations into deductions (Phase 7, PRD §30).
   * The reservation step is non-skippable — status must be past 'reserved'.
   * Legacy SOs without reservation rows fall back to direct deduction with a
   * logged warning (no dead end for pre-Phase-7 data).
   */
  static async fulfillOrder(id: string, workspaceId: string, userId: string, userPermissions: string[] = []) {
    const so = await this.getById(id, workspaceId);

    // Phase 4/7: stock gate — only reserved/picking/packed may ship.
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

    // Lock active reservations first (convert path reads them in-tx)
    let reservationsByItem = new Map<string, any>();
    await withTransaction(async (client) => {
      reservationsByItem = await ReservationService.convertForOrder(client, {
        workspaceId,
        soId: id,
      });

      for (const item of so.items) {
        const qtyToShip = item.ordered_qty - (item.fulfilled_qty || 0);
        if (qtyToShip <= 0) continue;

        const reservation = reservationsByItem.get(item.id);
        if (!reservation) {
          // Legacy fallback: pre-Phase-7 SO with no reservation row. Deduct
          // directly — but say so in the logs; this path is deprecated.
          logger.warn('SO item shipped without an active reservation (legacy fallback)', {
            soId: id, itemId: item.id, qty: qtyToShip,
          });
        } else if (reservation.quantity < qtyToShip) {
          // Reservation exists but can't cover the full ship qty — refuse.
          // The user should re-reserve (cancel + new SO) rather than silently oversell.
          throw new AppError(
            `Reservation for item covers ${reservation.quantity} units but ${qtyToShip} are pending shipment`,
            422,
            'RESERVATION_MISMATCH',
            true,
            { soItemId: item.id, reserved: reservation.quantity, requested: qtyToShip }
          );
        }

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

          if (!result.duplicate) {
            if (mv.batchId) {
              // Keep the consumed batch's ledger-derived balance in step
              await client.query(
                `UPDATE batches SET synced_quantity = synced_quantity - $1 WHERE id = $2`,
                [mv.qty, mv.batchId]
              );
            }
            if (reservation) {
              // Convert the hold: reservation row + reserved_quantity decrement
              await ReservationService.markConverted(client, reservation);
            }
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
        newValue: { status: 'shipped', reservations_converted: reservationsByItem.size },
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

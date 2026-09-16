import { AppError } from '../shared/errors.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { TxClient } from '../db/pool.js';

export interface ReserveItemInput {
  workspaceId: string;
  soId: string;
  soItemId: string;
  productId: string;
  variantId?: string;
  warehouseId: string;
  qty: number;
  userId: string;
}

export interface ReservationRow {
  id: string;
  workspace_id: string;
  product_id: string;
  variant_id: string | null;
  warehouse_id: string;
  sales_order_id: string;
  sales_order_item_id: string;
  quantity: number;
  status: 'active' | 'released' | 'converted';
  released_at: string | null;
  converted_at: string | null;
}

/**
 * Phase 7 (PRD §30): the reservation model.
 *
 * Creating a sales order NEVER changes stock (PRD rule). Reserving HOLDS it;
 * shipping CONVERTS the hold into a deduction — exactly once.
 *
 * Core invariant, maintained by every method here (and asserted in tests):
 *   SUM(active reservation rows) per (product, warehouse)
 *     == inventory.reserved_quantity
 *
 * Over-reservation is impossible: the guarded conditional UPDATE under row
 * lock (`WHERE quantity - reserved_quantity >= $qty`) mirrors the
 * adjustStockTx pattern — the database, not application logic, is the gate.
 */
export class ReservationService {
  /**
   * Hold stock for one SO item. Must run INSIDE the caller's transaction.
   * Throws 422 INSUFFICIENT_AVAILABLE_STOCK with a per-item breakdown when
   * available (quantity - reserved_quantity) can't cover the request.
   */
  static async reserveForOrderItem(client: TxClient, input: ReserveItemInput): Promise<ReservationRow> {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw AppError.badRequest(`Reservation quantity must be a positive integer`, 'INVALID_QUANTITY');
    }

    // Guarded increment: zero rows updated = not enough available stock.
    // The row lock from this UPDATE serializes competing reservations.
    const guard = await client.query(
      `UPDATE inventory
         SET reserved_quantity = reserved_quantity + $5, updated_at = NOW()
       WHERE workspace_id = $1 AND product_id = $2 AND warehouse_id = $3
         AND quantity - reserved_quantity >= $5
       RETURNING id, quantity, reserved_quantity`,
      [input.workspaceId, input.productId, input.warehouseId, input.variantId || null, input.qty]
    );

    if (guard.rows.length === 0) {
      // Distinguish "no stock row at all" from "not enough available"
      const cur = await client.query(
        `SELECT quantity, reserved_quantity FROM inventory
         WHERE workspace_id = $1 AND product_id = $2 AND warehouse_id = $3`,
        [input.workspaceId, input.productId, input.warehouseId]
      );
      const row = cur.rows[0];
      const available = row ? row.quantity - row.reserved_quantity : 0;
      throw new AppError(
        `Cannot reserve ${input.qty} units: only ${available} available (on hand ${row?.quantity ?? 0}, reserved ${row?.reserved_quantity ?? 0})`,
        422,
        'INSUFFICIENT_AVAILABLE_STOCK',
        true,
        {
          soItemId: input.soItemId,
          productId: input.productId,
          warehouseId: input.warehouseId,
          available,
          requested: input.qty,
        }
      );
    }

    // One reservation per item lifetime (UNIQUE constraint)
    const insert = await client.query(
      `INSERT INTO inventory_reservations
         (workspace_id, product_id, variant_id, warehouse_id, sales_order_id, sales_order_item_id, quantity, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
       RETURNING *`,
      [
        input.workspaceId,
        input.productId,
        input.variantId || null,
        input.warehouseId,
        input.soId,
        input.soItemId,
        input.qty,
        input.userId,
      ]
    );

    await AuditService.logTx(client, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: 'reservation.created',
      entity: 'inventory_reservation',
      entityId: insert.rows[0].id,
      newValue: {
        so_id: input.soId,
        product_id: input.productId,
        warehouse_id: input.warehouseId,
        quantity: input.qty,
      },
    });

    return insert.rows[0];
  }

  /**
   * Release ALL active reservations for an SO (cancel path).
   * Returns the number of rows released. Inside the caller's transaction.
   */
  static async releaseForOrder(
    client: TxClient,
    input: { workspaceId: string; soId: string; userId: string }
  ): Promise<number> {
    // Lock the rows first (SELECT FOR UPDATE) so concurrent converts can't interleave
    const active = await client.query(
      `SELECT id, product_id, warehouse_id, quantity FROM inventory_reservations
       WHERE workspace_id = $1 AND sales_order_id = $2 AND status = 'active'
       FOR UPDATE`,
      [input.workspaceId, input.soId]
    );

    if (active.rows.length === 0) return 0;

    const released = await client.query(
      `UPDATE inventory_reservations
         SET status = 'released', released_at = NOW()
       WHERE workspace_id = $1 AND sales_order_id = $2 AND status = 'active'
       RETURNING id, quantity, product_id, warehouse_id`,
      [input.workspaceId, input.soId]
    );

    let totalReleased = 0;
    for (const r of released.rows) {
      await client.query(
        `UPDATE inventory
           SET reserved_quantity = reserved_quantity - $3, updated_at = NOW()
         WHERE workspace_id = $1 AND product_id = $2`,
        [input.workspaceId, r.product_id, r.quantity]
      );
      totalReleased += r.quantity;
    }

    await AuditService.logTx(client, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: 'reservation.released',
      entity: 'sales_order',
      entityId: input.soId,
      newValue: { reservations_released: released.rows.length, total_qty: totalReleased },
    });

    return totalReleased;
  }

  /**
   * Convert active reservations at ship time. Locks and returns the active
   * rows; the CALLER deducts stock and then marks rows converted via
   * markConverted() in the same transaction. Returns a map of
   * sales_order_item_id → reserved quantity.
   */
  static async convertForOrder(
    client: TxClient,
    input: { workspaceId: string; soId: string }
  ): Promise<Map<string, ReservationRow>> {
    const active = await client.query(
      `SELECT * FROM inventory_reservations
       WHERE workspace_id = $1 AND sales_order_id = $2 AND status = 'active'
       FOR UPDATE`,
      [input.workspaceId, input.soId]
    );

    const byItem = new Map<string, ReservationRow>();
    for (const row of active.rows) {
      byItem.set(row.sales_order_item_id, row);
    }
    return byItem;
  }

  /**
   * Mark one reservation converted (after its stock deduction committed in
   * the same tx) and release the hold from inventory.reserved_quantity.
   */
  static async markConverted(client: TxClient, reservation: ReservationRow): Promise<void> {
    await client.query(
      `UPDATE inventory_reservations
         SET status = 'converted', converted_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [reservation.id]
    );
    await client.query(
      `UPDATE inventory
         SET reserved_quantity = reserved_quantity - $3, updated_at = NOW()
       WHERE workspace_id = $1 AND product_id = $2`,
      [reservation.workspace_id, reservation.product_id, reservation.quantity]
    );
  }

  /**
   * Read path: active reserved quantity for (product, warehouse).
   * Used by the reconciliation check in tests and by admin tooling.
   */
  static async getActiveQty(workspaceId: string, productId: string, warehouseId: string): Promise<number> {
    const { data, error } = await (await import('../config/supabase.js')).supabaseAdmin
      .from('inventory_reservations')
      .select('quantity')
      .eq('workspace_id', workspaceId)
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .eq('status', 'active');
    if (error) throw error;
    return (data || []).reduce((acc: number, r: any) => acc + (r.quantity || 0), 0);
  }
}

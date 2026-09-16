import { AppError } from '../../shared/errors.js';
import { withTransaction, TxClient } from '../../db/pool.js';

export type MovementType =
  | 'opening_balance'
  | 'adjustment'
  | 'purchase_received'
  | 'sales_shipped'
  | 'transfer_in'
  | 'transfer_out'
  | 'return'
  | 'customer_return'
  | 'damaged'
  | 'expired'
  | 'stock_count_correction';

export interface AdjustStockInput {
  workspaceId: string;
  productId: string;
  variantId?: string;
  warehouseId: string;
  locationId?: string;
  /** Positive adds stock, negative removes stock. Never an absolute balance. */
  qtyChange: number;
  movementType: MovementType;
  referenceType?: string;
  referenceId?: string;
  /** Batch/lot consumed or added by this movement (Phase 6, PRD §33) */
  batchId?: string;
  notes?: string;
  userId: string;
  /** Retry-safety: same key = same movement, never double-applied (PRD §24) */
  idempotencyKey?: string;
}

export interface StockMovementResult {
  inventoryId: string;
  transactionId: string;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  duplicate: boolean;
}

/**
 * The SINGLE ATOMIC ENTRY POINT for all stock movements (PRD §20, §72).
 *
 * Guarantees:
 *  1. Row-level LOCK on the inventory balance (INSERT ... ON CONFLICT DO UPDATE
 *     serializes concurrent writers — PRD §22)
 *  2. qty_before/qty_after computed from the LOCKED database state
 *  3. Balance update + immutable ledger row commit together, or not at all
 *  4. Client-supplied quantities are treated as DELTAS, never absolute balances
 *  5. Ledger rows are immutable at the DB level (migration 012 triggers)
 */
export class InventoryService {
  /**
   * Atomic single-stock-movement within a caller-provided transaction.
   * Composable: services performing multi-item operations call this repeatedly
   * inside ONE withTransaction() so everything commits or rolls back together.
   */
  static async adjustStockTx(client: TxClient, input: AdjustStockInput): Promise<StockMovementResult> {
    if (!input.qtyChange || input.qtyChange === 0) {
      throw AppError.badRequest('Quantity change must be non-zero');
    }

    // 0. Idempotency: a completed movement with the same key short-circuits.
    //    Under concurrent duplicate submission the unique index also rejects
    //    the second insert after the first commits.
    if (input.idempotencyKey) {
      const dup = await client.query(
        `SELECT id FROM inventory_transactions
         WHERE workspace_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [input.workspaceId, input.idempotencyKey]
      );
      if (dup.rows.length > 0) {
        const existing = dup.rows[0];
        return {
          inventoryId: existing.id,
          transactionId: existing.id,
          qtyBefore: 0,
          qtyChange: 0,
          qtyAfter: 0,
          duplicate: true,
        };
      }
    }

    // 1. Upsert + lock the balance row in ONE atomic statement.
    //    The WHERE clause rejects mutations that would drive stock negative
    //    (matching the DB CHECK constraint as a second line of defense).
    const upsert = await client.query(
      `INSERT INTO inventory AS inv
         (workspace_id, product_id, variant_id, warehouse_id, location_id, quantity, reserved_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       ON CONFLICT (workspace_id, product_id, warehouse_id)
       DO UPDATE SET
         quantity = inv.quantity + $6,
         location_id = COALESCE($5, inv.location_id),
         updated_at = NOW()
       WHERE inv.quantity + $6 >= 0
       RETURNING id, quantity`,
      [
        input.workspaceId,
        input.productId,
        input.variantId || null,
        input.warehouseId,
        input.locationId || null,
        input.qtyChange,
      ]
    );

    // No row returned => the WHERE clause rejected the mutation
    if (upsert.rows.length === 0) {
      const cur = await client.query(
        `SELECT quantity FROM inventory
         WHERE workspace_id = $1 AND product_id = $2 AND warehouse_id = $3`,
        [input.workspaceId, input.productId, input.warehouseId]
      );
      const current = cur.rows[0]?.quantity ?? 0;
      throw AppError.badRequest(
        `Insufficient inventory balance. Current: ${current}, Change: ${input.qtyChange}`,
        'INSUFFICIENT_STOCK'
      );
    }

    const invId: string = upsert.rows[0].id;
    const qtyAfter: number = upsert.rows[0].quantity;
    const qtyBefore: number = qtyAfter - input.qtyChange;

    // 2. Append to the IMMUTABLE LEDGER (same transaction as the balance update)
    const ledger = await client.query(
      `INSERT INTO inventory_transactions
         (workspace_id, product_id, variant_id, warehouse_id, qty_before, qty_change, qty_after,
          movement_type, reference_type, reference_id, batch_id, user_id, notes, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, created_at`,
      [
        input.workspaceId,
        input.productId,
        input.variantId || null,
        input.warehouseId,
        qtyBefore,
        input.qtyChange,
        qtyAfter,
        input.movementType,
        input.referenceType || null,
        input.referenceId || null,
        input.batchId || null,
        input.userId,
        input.notes || null,
        input.idempotencyKey || null,
      ]
    );

    return {
      inventoryId: invId,
      transactionId: ledger.rows[0].id,
      qtyBefore,
      qtyChange: input.qtyChange,
      qtyAfter,
      duplicate: false,
    };
  }

  /**
   * Atomic multi-item stock operation: ALL movements commit together or none do.
   * Fixes the PRD §22 forbidden case (transfer: source -10, destination unchanged).
   */
  static async adjustStockMany(movements: AdjustStockInput[]): Promise<StockMovementResult[]> {
    if (!movements || movements.length === 0) {
      throw AppError.badRequest('No stock movements supplied');
    }
    return withTransaction(async (client) => {
      const results: StockMovementResult[] = [];
      for (const m of movements) {
        results.push(await this.adjustStockTx(client, m));
      }
      return results;
    });
  }

  /**
   * Single movement convenience wrapper (opens its own transaction).
   */
  static async adjustStock(input: AdjustStockInput): Promise<StockMovementResult> {
    const [result] = await this.adjustStockMany([input]);
    return result;
  }

  /**
   * THE available-stock formula (Phase 7, Rule #15 — defined exactly once).
   * Every consumer (reorder recs, routing, external API, dashboards) calls
   * this instead of re-deriving the math. Reserved stock is held for
   * confirmed orders and is NOT available to sell.
   */
  static availableQuantity(row: { quantity: number; reserved_quantity?: number | null }): number {
    return (row.quantity || 0) - (row.reserved_quantity || 0);
  }

  /**
   * Bulk available-stock map: productId → total available across warehouses.
   * Reuses the single formula over every inventory row in the workspace.
   */
  static async getAvailableByProduct(
    workspaceId: string,
    filters: { productIds?: string[] } = {}
  ): Promise<Record<string, number>> {
    const { supabaseAdmin } = await import('../../config/supabase.js');
    let query = supabaseAdmin
      .from('inventory')
      .select('product_id, quantity, reserved_quantity')
      .eq('workspace_id', workspaceId);
    if (filters.productIds && filters.productIds.length > 0) {
      query = query.in('product_id', filters.productIds);
    }
    const { data, error } = await query;
    if (error) throw error;

    const map: Record<string, number> = {};
    for (const row of data || []) {
      map[row.product_id] = (map[row.product_id] || 0) + this.availableQuantity(row);
    }
    return map;
  }

  /**
   * List inventory balances across warehouses (read path — no transaction needed)
   */
  static async getStockLevels(workspaceId: string, filters: { productId?: string; warehouseId?: string }) {
    const { supabaseAdmin } = await import('../../config/supabase.js');
    let query = supabaseAdmin
      .from('inventory')
      .select('*, product:products(id, name, sku, unit, min_stock, reorder_point), warehouse:warehouses(id, name, code)')
      .eq('workspace_id', workspaceId);

    if (filters.productId) query = query.eq('product_id', filters.productId);
    if (filters.warehouseId) query = query.eq('warehouse_id', filters.warehouseId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Query immutable ledger transactions (read path)
   */
  static async getLedgerHistory(workspaceId: string, queryParams: { page?: number; pageSize?: number; productId?: string; warehouseId?: string; movementType?: string }) {
    const { supabaseAdmin } = await import('../../config/supabase.js');
    const page = queryParams.page || 1;
    const pageSize = Math.min(queryParams.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('inventory_transactions')
      .select('*, product:products(id, name, sku), warehouse:warehouses(id, name, code), user:users(id, name, email)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (queryParams.productId) query = query.eq('product_id', queryParams.productId);
    if (queryParams.warehouseId) query = query.eq('warehouse_id', queryParams.warehouseId);
    if (queryParams.movementType) query = query.eq('movement_type', queryParams.movementType);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      data: data || [],
      meta: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  }
}

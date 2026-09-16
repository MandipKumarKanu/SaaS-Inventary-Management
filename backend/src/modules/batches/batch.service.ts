import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { withTransaction } from '../../db/pool.js';

export interface CreateBatchDTO {
  workspaceId: string;
  productId: string;
  warehouseId: string;
  batchNumber: string;
  mfgDate?: string;
  expiryDate?: string;
  /** Positive = stock INTO this batch (purchase_received). Must be > 0 (PRD §33). */
  quantity: number;
  variantId?: string;
  userId: string;
}

export interface AdjustBatchDTO {
  workspaceId: string;
  /** Positive adds to the batch, negative writes off. Never 0. */
  qtyChange: number;
  reason: 'damaged' | 'expired' | 'adjustment';
  notes?: string;
  userId: string;
}

/**
 * Phase 6 (PRD §33): batches are real stock containers, not decorative rows.
 *
 * Every create/adjust routes through the Central Inventory Engine inside ONE
 * transaction, and the ledger row carries `batch_id` — so batch balances are
 * reconstructable from the immutable ledger and inventory + batch quantities
 * can never drift apart.
 */
export class BatchService {
  static async list(workspaceId: string, warehouseId?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('batches')
      .select('*, product:products(id, name, sku), warehouse:warehouses(id, name, code)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId);
    }

    if (page) query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const total = count || 0;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Annotate expiration status
    const annotated = (data || []).map((batch) => {
      let status: 'Valid' | 'Expiring Soon' | 'Expired' = 'Valid';
      if (batch.expiry_date) {
        const exp = new Date(batch.expiry_date);
        if (exp < now) {
          status = 'Expired';
        } else if (exp <= thirtyDaysFromNow) {
          status = 'Expiring Soon';
        }
      }
      return {
        ...batch,
        expirationStatus: status,
      };
    });
    return { data: annotated, meta: { page: page || 1, pageSize: page ? pageSize : total, total, totalPages: page ? Math.ceil(total / pageSize) : 1 } };
  }

  static async getExpiryOverview(workspaceId: string) {
    const { data: batches, error } = await supabaseAdmin
      .from('batches')
      .select('*, product:products(id, name, sku, cost_price), warehouse:warehouses(id, name, code)')
      .eq('workspace_id', workspaceId)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (error) throw error;

    const now = new Date();
    const d30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const d60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    let expiredCount = 0;
    let expiring30Count = 0;
    let expiring60Count = 0;
    let totalQtyAtRisk = 0;
    let totalValueAtRisk = 0;

    const annotated = (batches || []).map((batch) => {
      let status: 'Valid' | 'Expiring Soon' | 'Expired' = 'Valid';
      const qty = batch.synced_quantity ?? batch.quantity ?? 0;
      const unitCost = Number(batch.product?.cost_price || 0);

      if (batch.expiry_date) {
        const exp = new Date(batch.expiry_date);
        if (exp < now) {
          status = 'Expired';
          expiredCount++;
          totalQtyAtRisk += qty;
          totalValueAtRisk += qty * unitCost;
        } else if (exp <= d30) {
          status = 'Expiring Soon';
          expiring30Count++;
          totalQtyAtRisk += qty;
          totalValueAtRisk += qty * unitCost;
        } else if (exp <= d60) {
          expiring60Count++;
        }
      }

      return {
        ...batch,
        expirationStatus: status,
        unitCost,
        totalValue: Math.round(qty * unitCost * 100) / 100,
      };
    });

    const urgentBatches = annotated.filter((b) => b.expirationStatus !== 'Valid').slice(0, 15);

    return {
      summary: {
        totalBatches: (batches || []).length,
        expiredCount,
        expiring30Count,
        expiring60Count,
        totalQtyAtRisk,
        totalValueAtRisk: Math.round(totalValueAtRisk * 100) / 100,
      },
      urgentBatches,
    };
  }

  static async getById(id: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('batches')
      .select('*, product:products(id, name, sku, track_expiry), warehouse:warehouses(id, name, code)')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw AppError.notFound('Batch not found');
    return data;
  }

  /**
   * Create a batch AND move stock in ONE transaction (PRD §33, §22):
   * the batch row, the inventory balance, and the ledger entry (with
   * batch_id) commit together or not at all.
   */
  static async create(dto: CreateBatchDTO) {
    if (!dto.quantity || dto.quantity <= 0) {
      throw AppError.badRequest('Batch quantity must be a positive integer', 'INVALID_QUANTITY');
    }

    // Product must exist in this workspace (guards against cross-tenant FK games)
    const { data: product, error: pErr } = await supabaseAdmin
      .from('products')
      .select('id, track_batches, track_expiry')
      .eq('id', dto.productId)
      .eq('workspace_id', dto.workspaceId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) throw AppError.notFound('Product not found');

    // Duplicate batch numbers for the same product/warehouse are rejected
    const { data: existing } = await supabaseAdmin
      .from('batches')
      .select('id')
      .eq('workspace_id', dto.workspaceId)
      .eq('product_id', dto.productId)
      .eq('warehouse_id', dto.warehouseId)
      .eq('batch_number', dto.batchNumber)
      .maybeSingle();
    if (existing) {
      throw AppError.conflict(`Batch ${dto.batchNumber} already exists for this product and warehouse`, 'DUPLICATE_BATCH');
    }

    const result = await withTransaction(async (client) => {
      // 1. Create the batch row first (FK target for the ledger)
      const { rows } = await client.query(
        `INSERT INTO batches
           (workspace_id, product_id, warehouse_id, variant_id, batch_number, mfg_date, expiry_date, quantity, synced_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id`,
        [
          dto.workspaceId,
          dto.productId,
          dto.warehouseId,
          dto.variantId || null,
          dto.batchNumber,
          dto.mfgDate || null,
          dto.expiryDate || null,
          dto.quantity,
        ]
      );
      const batchId: string = rows[0].id;

      // 2. Move stock through the central engine (ledger row carries batch_id)
      await InventoryService.adjustStockTx(client, {
        workspaceId: dto.workspaceId,
        productId: dto.productId,
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        qtyChange: dto.quantity,
        movementType: 'purchase_received',
        referenceType: 'batch',
        referenceId: batchId,
        batchId,
        notes: `Batch ${dto.batchNumber} received (${dto.quantity} units)`,
        userId: dto.userId,
        idempotencyKey: `batch:${batchId}:create:${dto.quantity}`,
      });

      return batchId;
    });

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'batch.created',
      entity: 'batch',
      entityId: result,
      newValue: { batch_number: dto.batchNumber, quantity: dto.quantity },
    });

    return this.getById(result, dto.workspaceId);
  }

  /**
   * Write-off / correction against ONE batch (damaged, expired, recount).
   * Rejects driving the batch or inventory balance negative.
   */
  static async adjust(batchId: string, dto: AdjustBatchDTO) {
    const batch = await this.getById(batchId, dto.workspaceId);

    if (!dto.qtyChange || dto.qtyChange === 0) {
      throw AppError.badRequest('Quantity change must be non-zero', 'INVALID_QUANTITY');
    }
    if (dto.qtyChange < 0 && batch.synced_quantity + dto.qtyChange < 0) {
      throw AppError.badRequest(
        `Cannot write off ${Math.abs(dto.qtyChange)} units: batch only has ${batch.synced_quantity}`,
        'INSUFFICIENT_STOCK'
      );
    }

    await withTransaction(async (client) => {
      const result = await InventoryService.adjustStockTx(client, {
        workspaceId: dto.workspaceId,
        productId: batch.product_id,
        variantId: batch.variant_id || undefined,
        warehouseId: batch.warehouse_id,
        qtyChange: dto.qtyChange,
        movementType: dto.reason === 'adjustment' ? 'adjustment' : dto.reason,
        referenceType: 'batch',
        referenceId: batchId,
        batchId,
        notes: dto.notes || `Batch ${batch.batch_number} ${dto.reason} (${dto.qtyChange > 0 ? '+' : ''}${dto.qtyChange})`,
        userId: dto.userId,
        idempotencyKey: `batch:${batchId}:adjust:${dto.reason}:${dto.qtyChange}:${Date.now()}`,
      });

      // Keep the batch row's ledger-derived balance in step
      if (!result.duplicate) {
        await client.query(
          `UPDATE batches SET synced_quantity = synced_quantity + $1 WHERE id = $2`,
          [dto.qtyChange, batchId]
        );
      }
    });

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: `batch.${dto.reason}`,
      entity: 'batch',
      entityId: batchId,
      newValue: { qty_change: dto.qtyChange, reason: dto.reason },
    });

    return this.getById(batchId, dto.workspaceId);
  }
}

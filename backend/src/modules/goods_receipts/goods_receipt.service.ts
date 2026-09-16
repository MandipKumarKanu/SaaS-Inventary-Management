import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../config/logger.js';
import type { TxClient } from '../../db/pool.js';

/**
 * Phase 8 (PRD §45): Goods Receipt Notes as stored DOCUMENTS.
 *
 * A receipt is written INSIDE the PurchaseService.receiveItems transaction —
 * stock movements, serial registrations, and the receipt commit or roll back
 * together. The receipt never mutates stock itself (pre-flight decision #2);
 * `received_qty`, ledger, and serial_numbers remain the operational state.
 *
 * Numbering uses the atomic next_document_number() SQL function (migration
 * 014) with the new 'GRN' doc type — first call yields GRN-<year>-000001.
 */

export interface ReceiptTarget {
  poItemId: string;
  productId: string;
  qtyReceived: number;
  serials: string[];
}

export interface RecordReceiptParams {
  workspaceId: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierId?: string | null;
  warehouseId: string;
  userId: string;
  notes?: string | null;
  targets: ReceiptTarget[];
}

export class GoodsReceiptService {
  /**
   * Insert the receipt header + items inside the caller's transaction.
   * Returns the generated GRN number for audit/response enrichment.
   */
  static async recordForReceiveTx(client: TxClient, params: RecordReceiptParams): Promise<string> {
    const { workspaceId, purchaseOrderId, poNumber, supplierId, warehouseId, userId, notes, targets } = params;

    if (!targets || targets.length === 0) {
      throw AppError.badRequest('Cannot record an empty goods receipt', 'EMPTY_RECEIPT');
    }

    // Atomic GRN number (insert-on-conflict inside the function — safe in tx)
    const numRes = await client.query(
      `SELECT next_document_number($1::uuid, 'GRN', 'GRN') AS number`,
      [workspaceId]
    );
    const grnNumber: string = numRes.rows?.[0]?.number;
    if (!grnNumber) {
      throw AppError.internal('Failed to allocate GRN number', 'GRN_NUMBER_FAILED');
    }

    const headerRes = await client.query(
      `INSERT INTO goods_receipts
         (workspace_id, grn_number, purchase_order_id, po_number,
          supplier_id, warehouse_id, received_by, received_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       RETURNING id`,
      [
        workspaceId,
        grnNumber,
        purchaseOrderId,
        poNumber,
        supplierId || null,
        warehouseId,
        userId,
        notes || null,
      ]
    );
    const receiptId: string = headerRes.rows?.[0]?.id;
    if (!receiptId) {
      throw AppError.internal('Failed to create goods receipt', 'GRN_INSERT_FAILED');
    }

    for (const t of targets) {
      await client.query(
        `INSERT INTO goods_receipt_items
           (receipt_id, po_item_id, product_id, qty_received, serials_registered)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [receiptId, t.poItemId, t.productId, t.qtyReceived, JSON.stringify(t.serials || [])]
      );
    }

    return grnNumber;
  }

  /** Printable-ready receipt document (header + PO + supplier + items). */
  static async getById(id: string, workspaceId: string) {
    const { data: receipt, error } = await supabaseAdmin
      .from('goods_receipts')
      .select(`
        *,
        supplier:suppliers(id, name, contact_name, email),
        warehouse:warehouses(id, name, code),
        received_by_user:users!goods_receipts_received_by_fkey(id, name, email)
      `)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to load goods receipt', { error: error.message, id });
      throw AppError.internal('Failed to load goods receipt', 'GRN_LOAD_FAILED');
    }
    if (!receipt) throw AppError.notFound('Goods receipt not found', 'RECEIPT_NOT_FOUND');

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('goods_receipt_items')
      .select('*, product:products(id, name, sku, unit)')
      .eq('receipt_id', id);

    if (itemsError) {
      logger.error('Failed to load goods receipt items', { error: itemsError.message, id });
      throw AppError.internal('Failed to load goods receipt items', 'GRN_LOAD_FAILED');
    }

    return {
      ...receipt,
      items: (items || []).map((it: any) => ({
        id: it.id,
        product: it.product,
        qtyReceived: it.qty_received,
        serials: it.serials_registered || [],
      })),
      totalUnitsReceived: (items || []).reduce((acc: number, it: any) => acc + (it.qty_received || 0), 0),
    };
  }

  /** All receipts for a purchase order (newest first). */
  static async listByPurchaseOrder(purchaseOrderId: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('goods_receipts')
      .select(`
        id, grn_number, po_number, received_at, notes,
        supplier:suppliers(id, name),
        warehouse:warehouses(id, name, code)
      `)
      .eq('workspace_id', workspaceId)
      .eq('purchase_order_id', purchaseOrderId)
      .order('received_at', { ascending: false });

    if (error) {
      logger.error('Failed to list goods receipts', { error: error.message, purchaseOrderId });
      throw AppError.internal('Failed to list goods receipts', 'GRN_LOAD_FAILED');
    }
    return data || [];
  }
}

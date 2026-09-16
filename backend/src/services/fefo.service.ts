import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';

export interface FefoBatchSlice {
  batchId: string;
  batchNumber: string | null;
  expiryDate: string | null;
  /** Units to consume from THIS batch */
  qty: number;
}

export interface FefoPlan {
  slices: FefoBatchSlice[];
  total: number;
}

/**
 * Phase 6 (PRD §33): FEFO — First-Expired-First-Out.
 *
 * Resolves which batches to consume for a quantity of a product at a
 * warehouse. Order: expiry_date ASC (NULLs last = no-expiry batches are
 * consumed last), then created_at ASC as tiebreaker.
 *
 * STRICT expired policy (locked decision): if the ONLY stock left sits in
 * expired batches, fulfillment fails with EXPIRED_STOCK — a write-off via
 * BatchService.adjust is the explicit, audited path around it.
 */
export class FefoService {
  static async plan(
    workspaceId: string,
    productId: string,
    warehouseId: string,
    qtyNeeded: number,
    opts: { variantId?: string } = {}
  ): Promise<FefoPlan> {
    const nowIso = new Date().toISOString().slice(0, 'YYYY-MM-DD'.length); // DATE comparison

    const { data: batches, error } = await supabaseAdmin
      .from('batches')
      .select('id, batch_number, expiry_date, synced_quantity, quantity')
      .eq('workspace_id', workspaceId)
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .gt('synced_quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) throw error;

    const available = batches || [];
    const totalAvailable = available.reduce((acc, b) => acc + (b.synced_quantity || 0), 0);

    if (totalAvailable < qtyNeeded) {
      throw AppError.badRequest(
        `Insufficient batch-tracked stock: ${qtyNeeded} requested, ${totalAvailable} available in batches`,
        'INSUFFICIENT_STOCK'
      );
    }

    // STRICT policy: everything left is expired → block, list the offenders
    const fresh = available.filter((b) => !b.expiry_date || b.expiry_date >= nowIso);
    const freshTotal = fresh.reduce((acc, b) => acc + (b.synced_quantity || 0), 0);

    if (freshTotal < qtyNeeded) {
      const expiredOnly = available.filter((b) => b.expiry_date && b.expiry_date < nowIso);
      throw new AppError(
        `Only expired batches remain for this product (${freshTotal} fresh / ${qtyNeeded} needed). Write off expired stock first.`,
        422,
        'EXPIRED_STOCK',
        true,
        {
          needed: qtyNeeded,
          freshAvailable: freshTotal,
          expiredBatches: expiredOnly.map((b) => ({
            id: b.id,
            batch_number: b.batch_number,
            expiry_date: b.expiry_date,
            qty: b.synced_quantity,
          })),
        }
      );
    }

    // Walk the FEFO order and carve out slices
    const slices: FefoBatchSlice[] = [];
    let remaining = qtyNeeded;
    for (const b of fresh) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.synced_quantity || 0);
      if (take <= 0) continue;
      slices.push({
        batchId: b.id,
        batchNumber: b.batch_number || null,
        expiryDate: b.expiry_date || null,
        qty: take,
      });
      remaining -= take;
    }

    return { slices, total: qtyNeeded };
  }
}

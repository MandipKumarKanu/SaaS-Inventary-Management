import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { withTransaction } from '../../db/pool.js';
import { StateMachine } from '../../shared/state-machines.js';
import { DocumentNumberService } from '../../services/document-number.service.js';
import { ConfigService } from '../../services/config.service.js';

export interface CreateCountDTO {
  workspaceId: string;
  warehouseId: string;
  notes?: string;
  userId: string;
}

export interface PhysicalCountEntry {
  itemId: string;
  physicalQty: number;
  notes?: string;
}

export class CountService {
  /**
   * Approval threshold from workspace settings (PRD §35), falling back to
   * the deployment default in config_defaults → env (Phase 7b). Workspace
   * override wins; no hardcoded percentage in feature code.
   * Variances (in % of system qty) above this require a SECOND approver
   * (four-eyes: approver !== submitter).
   */
  static async getApprovalThresholdPct(workspaceId: string): Promise<number> {
    const { data } = await supabaseAdmin
      .from('workspaces')
      .select('settings')
      .eq('id', workspaceId)
      .single();
    const pct = (data?.settings as any)?.count_approval_threshold_pct;
    if (typeof pct === 'number' && pct >= 0 && pct <= 100) return pct;
    return ConfigService.getOr<number>('count_approval_threshold_pct', 100);
  }

  static async list(workspaceId: string, status?: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    let query = supabaseAdmin
      .from('inventory_counts')
      .select('*, warehouse:warehouses(id, name, code), items:inventory_count_items(*, product:products(id, name, sku))', { count: 'exact' })
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
      .from('inventory_counts')
      .select('*, warehouse:warehouses(id, name, code), items:inventory_count_items(*, product:products(id, name, sku, barcode))')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) throw AppError.notFound('Cycle count sheet not found');
    return data;
  }

  static async createCountSheet(dto: CreateCountDTO) {
    // 1. Fetch current stock levels for the warehouse in this workspace
    const { data: stockLevels, error: sErr } = await supabaseAdmin
      .from('inventory')
      .select('product_id, variant_id, quantity')
      .eq('workspace_id', dto.workspaceId)
      .eq('warehouse_id', dto.warehouseId);

    if (sErr) throw sErr;

    const countNumber = await DocumentNumberService.next(dto.workspaceId, 'CNT');

    // 2. Create Header
    const { data: count, error: cErr } = await supabaseAdmin
      .from('inventory_counts')
      .insert({
        workspace_id: dto.workspaceId,
        warehouse_id: dto.warehouseId,
        count_number: countNumber,
        status: 'in_progress',
        notes: dto.notes || null,
        created_by: dto.userId,
      })
      .select()
      .single();

    if (cErr) throw cErr;

    // 3. Create items snapshot — BLIND (PRD §35): physical_qty stays NULL
    //    until counters submit their observations. Seeding it with system_qty
    //    would leak the expected value into the count sheet.
    if (stockLevels && stockLevels.length > 0) {
      const itemsToInsert = stockLevels.map((lvl) => ({
        count_id: count.id,
        product_id: lvl.product_id,
        variant_id: lvl.variant_id || null,
        system_qty: lvl.quantity,
        physical_qty: null, // blind: entered only at submit time
      }));

      const { error: iErr } = await supabaseAdmin
        .from('inventory_count_items')
        .insert(itemsToInsert);

      if (iErr) throw iErr;
    }

    await AuditService.log({
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      action: 'count.created',
      entity: 'inventory_count',
      entityId: count.id,
      newValue: { count_number: countNumber },
    });

    return this.getById(count.id, dto.workspaceId);
  }

  static async submitPhysicalCounts(id: string, workspaceId: string, items: PhysicalCountEntry[], userId?: string) {
    const count = await this.getById(id, workspaceId);

    if (count.status === 'completed' || count.status === 'cancelled') {
      throw AppError.badRequest(`Cannot update counts for a ${count.status} count sheet`);
    }

    for (const entry of items) {
      await supabaseAdmin
        .from('inventory_count_items')
        .update({
          physical_qty: entry.physicalQty,
          notes: entry.notes || null,
        })
        .eq('id', entry.itemId)
        .eq('count_id', id);
    }

    // Move to review status; record who submitted (four-eyes baseline —
    // the approver must be a different user when variance is high).
    await supabaseAdmin
      .from('inventory_counts')
      .update({
        status: 'review',
        submitted_by: userId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return this.getById(id, workspaceId);
  }

  static async approveCount(id: string, workspaceId: string, userId: string, userPermissions: string[] = []) {
    const count = await this.getById(id, workspaceId);

    // Phase 4: composite-forward edge — approval may run from in_progress or
    // review straight to completed (stock-moving correction batch).
    StateMachine.assertCanStockTransition('inventory_count', count.status, 'completed', userPermissions);

    // Four-eyes variance threshold (PRD §35): when any item's variance
    // exceeds the workspace threshold, the approver must differ from the
    // submitter. This holds regardless of permission level.
    const thresholdPct = await this.getApprovalThresholdPct(workspaceId);
    let maxVariancePct = 0;
    for (const item of count.items) {
      if (item.physical_qty == null) continue; // never submitted
      const pct =
        (Math.abs((item.physical_qty ?? item.system_qty) - item.system_qty) /
          Math.max(item.system_qty, 1)) *
        100;
      if (pct > maxVariancePct) maxVariancePct = pct;
    }

    const needsSecondApprover = maxVariancePct > thresholdPct;
    if (needsSecondApprover && count.submitted_by && count.submitted_by === userId) {
      throw AppError.forbidden(
        `Variance of ${maxVariancePct.toFixed(1)}% exceeds the ${thresholdPct}% threshold — a second approver (not the submitter) must approve this count`,
        'COUNT_SECOND_APPROVER_REQUIRED'
      );
    }

    // Apply all variance corrections in ONE atomic transaction (PRD §22):
    // a failure mid-approval rolls back every stock adjustment. The audit row
    // commits in the same transaction (PRD §41).
    await withTransaction(async (client) => {
      for (const item of count.items) {
        const variance = (item.physical_qty ?? item.system_qty) - item.system_qty;

        if (variance !== 0) {
          await InventoryService.adjustStockTx(client, {
            workspaceId,
            productId: item.product_id,
            variantId: item.variant_id || undefined,
            warehouseId: count.warehouse_id,
            qtyChange: variance,
            movementType: 'stock_count_correction',
            referenceType: 'inventory_count',
            referenceId: count.id,
            notes: `Cycle Count ${count.count_number} audit adjustment (Variance: ${variance > 0 ? '+' : ''}${variance})`,
            userId,
            idempotencyKey: `count:${count.id}:approve:${item.id}`,
          });
        }

        // Mark item as approved (same transaction as its stock correction)
        await client.query(`UPDATE inventory_count_items SET approved = TRUE WHERE id = $1`, [item.id]);
      }

      await AuditService.logTx(client, {
        workspaceId,
        userId,
        action: 'count.approved',
        entity: 'inventory_count',
        entityId: id,
        newValue: { status: 'completed', max_variance_pct: Math.round(maxVariancePct * 10) / 10 },
      });
    });

    // Mark count completed with the four-eyes trail
    const { data: updated, error } = await supabaseAdmin
      .from('inventory_counts')
      .update({
        status: 'completed',
        approved_by: userId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this.getById(id, workspaceId);
  }
}

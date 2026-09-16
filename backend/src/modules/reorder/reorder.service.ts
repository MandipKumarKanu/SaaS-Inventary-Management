import { supabaseAdmin } from '../../config/supabase.js';
import { InventoryService } from '../inventory/inventory.service.js';

export class ReorderService {
  static async getRecommendations(
    workspaceId: string,
    queryParams?: { page?: number; pageSize?: number; urgency?: string }
  ) {
    // 1. Fetch all active products for the workspace
    const { data: products, error: pErr } = await supabaseAdmin
      .from('products')
      .select('*, category:categories(id, name), brand:brands(id, name)')
      .eq('workspace_id', workspaceId);

    if (pErr) throw pErr;

    // 2. Available stock per product — reservations excluded (Phase 7, Rule #15).
    // Reserved units are promised to confirmed orders; reordering on them would oversell.
    const stockMap = await InventoryService.getAvailableByProduct(
      workspaceId,
      { productIds: (products || []).map((p: any) => p.id) }
    );

    const recommendations = (products || [])
      .map((p) => {
        const currentStock = stockMap[p.id] ?? 0; // available, not on-hand
        const reorderPoint = p.reorder_point ?? 10;
        const maxStock = p.max_stock || Math.max(reorderPoint * 3, 50);
        const isReorderNeeded = currentStock <= reorderPoint;
        const suggestedOrderQty = Math.max(0, maxStock - currentStock);

        return {
          product: p,
          currentStock,
          reorderPoint,
          minStock: p.min_stock || 0,
          maxStock,
          isReorderNeeded,
          suggestedOrderQty,
          urgency: currentStock === 0 ? 'CRITICAL' : currentStock <= Math.floor(reorderPoint / 2) ? 'HIGH' : 'MEDIUM',
        };
      })
      .filter((rec) => rec.isReorderNeeded)
      .sort((a, b) => a.currentStock - b.currentStock);

    // Optional urgency filter: 'standard' = MEDIUM only, otherwise exact match.
    // Unknown values are ignored (no filter) to stay backward compatible.
    const urgency = queryParams?.urgency;
    const filtered =
      !urgency || urgency === 'all'
        ? recommendations
        : urgency === 'standard'
          ? recommendations.filter((rec) => rec.urgency === 'MEDIUM')
          : ['CRITICAL', 'HIGH', 'MEDIUM'].includes(urgency)
            ? recommendations.filter((rec) => rec.urgency === urgency)
            : recommendations;

    // Summary over the full urgency-filtered set (not just the returned page).
    const criticalCount = filtered.filter((rec) => rec.urgency === 'CRITICAL').length;
    const suggestedTotal = filtered.reduce((sum, rec) => sum + (Number(rec.suggestedOrderQty) || 0), 0);

    const total = filtered.length;
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    const meta = (data: typeof filtered) => ({
      page: page || 1,
      pageSize: page ? pageSize : total,
      total,
      totalPages: page ? Math.ceil(total / pageSize) : 1,
      summary: { total, criticalCount, suggestedTotal },
    });
    if (page === undefined) {
      return { data: filtered, meta: meta(filtered) };
    }
    return {
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      meta: meta(filtered),
    };
  }
}

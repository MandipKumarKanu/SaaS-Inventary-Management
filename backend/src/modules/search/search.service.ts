import { supabaseAdmin } from '../../config/supabase.js';

/**
 * Phase 8 (PRD §42): global search.
 *
 * - Workspace-scoped on every query (verified — workspace_id from the
 *   verified membership, never from client input).
 * - Permission-aware: a result group is only queried when the caller holds
 *   the matching VIEW permission. No data leaks to members who can't read it.
 * - Bounded: term length capped, each group limited to 5 hits.
 */
export class SearchService {
  static async globalSearch(
    workspaceId: string,
    queryTerm: string,
    permissions: string[] = []
  ) {
    const term = (queryTerm || '').trim().slice(0, 100);
    if (term.length === 0) {
      return {
        products: [],
        warehouses: [],
        purchase_orders: [],
        sales_orders: [],
        suppliers: [],
        serials: [],
      };
    }

    const like = `%${term}%`;
    const has = (...codes: string[]) => codes.some((c) => permissions.includes(c));

    const [
      productsRes,
      warehousesRes,
      purchaseOrdersRes,
      salesOrdersRes,
      suppliersRes,
      serialsRes,
    ] = await Promise.all([
      // Products: PRODUCTS_VIEW or PURCHASES_VIEW (PO/SO items show skus)
      has('products.view', 'purchases.view')
        ? supabaseAdmin
            .from('products')
            .select('id, sku, name, unit')
            .eq('workspace_id', workspaceId)
            .or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like}`)
            .limit(5)
        : Promise.resolve({ data: null }),

      has('warehouses.view')
        ? supabaseAdmin
            .from('warehouses')
            .select('id, name, code')
            .eq('workspace_id', workspaceId)
            .or(`name.ilike.${like},code.ilike.${like}`)
            .limit(5)
        : Promise.resolve({ data: null }),

      has('purchases.view')
        ? supabaseAdmin
            .from('purchase_orders')
            .select('id, po_number, status, total_amount')
            .eq('workspace_id', workspaceId)
            .ilike('po_number', like)
            .limit(5)
        : Promise.resolve({ data: null }),

      has('sales.view')
        ? supabaseAdmin
            .from('sales_orders')
            .select('id, order_number, status, total_amount')
            .eq('workspace_id', workspaceId)
            .ilike('order_number', like)
            .limit(5)
        : Promise.resolve({ data: null }),

      has('purchases.view')
        ? supabaseAdmin
            .from('suppliers')
            .select('id, name, company_name')
            .eq('workspace_id', workspaceId)
            .or(`name.ilike.${like},company_name.ilike.${like}`)
            .limit(5)
        : Promise.resolve({ data: null }),

      has('inventory.view')
        ? supabaseAdmin
            .from('serial_numbers')
            .select('id, serial_number, status, product:products(id, name, sku)')
            .eq('workspace_id', workspaceId)
            .ilike('serial_number', like)
            .limit(5)
        : Promise.resolve({ data: null }),
    ]);

    return {
      products: productsRes.data || [],
      warehouses: warehousesRes.data || [],
      purchase_orders: purchaseOrdersRes.data || [],
      sales_orders: salesOrdersRes.data || [],
      suppliers: suppliersRes.data || [],
      serials: serialsRes.data || [],
    };
  }
}

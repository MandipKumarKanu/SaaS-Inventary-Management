import { supabaseAdmin } from '../../config/supabase.js';

export class SearchService {
  static async globalSearch(workspaceId: string, queryTerm: string) {
    if (!queryTerm || queryTerm.trim().length === 0) {
      return { products: [], warehouses: [], purchase_orders: [], sales_orders: [], suppliers: [] };
    }

    const term = `%${queryTerm.trim()}%`;

    const [
      { data: products },
      { data: warehouses },
      { data: purchaseOrders },
      { data: salesOrders },
      { data: suppliers },
    ] = await Promise.all([
      supabaseAdmin
        .from('products')
        .select('id, sku, name, unit')
        .eq('workspace_id', workspaceId)
        .or(`name.ilike.${term},sku.ilike.${term}`)
        .limit(5),

      supabaseAdmin
        .from('warehouses')
        .select('id, name, code')
        .eq('workspace_id', workspaceId)
        .or(`name.ilike.${term},code.ilike.${term}`)
        .limit(5),

      supabaseAdmin
        .from('purchase_orders')
        .select('id, po_number, status, total_amount')
        .eq('workspace_id', workspaceId)
        .ilike('po_number', term)
        .limit(5),

      supabaseAdmin
        .from('sales_orders')
        .select('id, order_number, status, total_amount')
        .eq('workspace_id', workspaceId)
        .ilike('order_number', term)
        .limit(5),

      supabaseAdmin
        .from('suppliers')
        .select('id, name, company_name')
        .eq('workspace_id', workspaceId)
        .or(`name.ilike.${term},company_name.ilike.${term}`)
        .limit(5),
    ]);

    return {
      products: products || [],
      warehouses: warehouses || [],
      purchase_orders: purchaseOrders || [],
      sales_orders: salesOrders || [],
      suppliers: suppliers || [],
    };
  }
}

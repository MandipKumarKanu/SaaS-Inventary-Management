import { supabaseAdmin } from '../../config/supabase.js';

export class RoutingService {
  static async listRules(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('warehouse_routing_rules')
      .select('*, warehouse:warehouses(id, name, code)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('priority', { ascending: true });

    if (page !== undefined) {
      query = query.range((page - 1) * pageSize, page * pageSize - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    const total = count ?? data?.length ?? 0;
    if (page === undefined) {
      return {
        data: data || [],
        meta: { page: 1, pageSize: total, total, totalPages: 1 },
      };
    }
    return {
      data: data || [],
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async createRule(
    workspaceId: string,
    destinationRegion: string,
    preferredWarehouseId: string,
    priority = 1
  ) {
    const { data, error } = await supabaseAdmin
      .from('warehouse_routing_rules')
      .insert({
        workspace_id: workspaceId,
        destination_region: destinationRegion,
        preferred_warehouse_id: preferredWarehouseId,
        priority,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async optimizeFulfillmentLocation(workspaceId: string, destinationRegion: string, productId: string) {
    // 1. Check matching routing rule
    const { data: rule } = await supabaseAdmin
      .from('warehouse_routing_rules')
      .select('preferred_warehouse_id, warehouse:warehouses(id, name, code)')
      .eq('workspace_id', workspaceId)
      .ilike('destination_region', `%${destinationRegion}%`)
      .order('priority', { ascending: true })
      .maybeSingle();

    if (rule && rule.preferred_warehouse_id) {
      return {
        recommended_warehouse_id: rule.preferred_warehouse_id,
        warehouse_name: (rule as any).warehouse?.name || 'Preferred 3PL Warehouse',
        match_reason: `Matched 3PL Regional Rule for region: ${destinationRegion}`,
      };
    }

    // 2. Default to warehouse with highest stock level
    const { data: inv } = await supabaseAdmin
      .from('inventory')
      .select('warehouse_id, quantity, warehouse:warehouses(id, name, code)')
      .eq('workspace_id', workspaceId)
      .eq('product_id', productId)
      .order('quantity', { ascending: false })
      .limit(1)
      .single();

    if (inv) {
      return {
        recommended_warehouse_id: inv.warehouse_id,
        warehouse_name: (inv as any).warehouse?.name || 'Stock Capacity Warehouse',
        match_reason: `Selected warehouse with maximum available stock (${inv.quantity} units)`,
      };
    }

    throw new Error('No warehouse with available stock found for routing');
  }
}

import { supabaseAdmin } from '../../config/supabase.js';

export class BackupService {
  /**
   * List past workspace backups
   */
  static async listBackups(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('workspace_backups')
      .select('id, status, file_name, file_size_bytes, summary, download_url, created_at, created_by', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

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

  /**
   * Create a full organization disaster recovery backup snapshot
   */
  static async createBackup(workspaceId: string, userId: string) {
    // 1. Fetch relational tables for workspace
    const [
      { data: products },
      { data: categories },
      { data: warehouses },
      { data: inventory },
      { data: purchaseOrders },
      { data: salesOrders },
      { data: suppliers },
      { data: customers },
    ] = await Promise.all([
      supabaseAdmin.from('products').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('categories').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('warehouses').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('inventory').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('purchase_orders').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('sales_orders').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('suppliers').select('*').eq('workspace_id', workspaceId),
      supabaseAdmin.from('customers').select('*').eq('workspace_id', workspaceId),
    ]);

    const backupDump = {
      workspace_id: workspaceId,
      exported_at: new Date().toISOString(),
      version: '1.0.0',
      data: {
        products: products || [],
        categories: categories || [],
        warehouses: warehouses || [],
        inventory: inventory || [],
        purchase_orders: purchaseOrders || [],
        sales_orders: salesOrders || [],
        suppliers: suppliers || [],
        customers: customers || [],
      },
    };

    const jsonString = JSON.stringify(backupDump, null, 2);
    const fileSize = Buffer.byteLength(jsonString, 'utf-8');
    const fileName = `stockflow_backup_${workspaceId.slice(0, 8)}_${Date.now()}.json`;

    const summary = {
      product_count: products?.length || 0,
      warehouse_count: warehouses?.length || 0,
      inventory_records: inventory?.length || 0,
      purchase_orders: purchaseOrders?.length || 0,
      sales_orders: salesOrders?.length || 0,
    };

    // Data URI for download
    const dataUrl = `data:application/json;base64,${Buffer.from(jsonString).toString('base64')}`;

    const { data: record, error } = await supabaseAdmin
      .from('workspace_backups')
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        status: 'completed',
        file_name: fileName,
        file_size_bytes: fileSize,
        summary,
        download_url: dataUrl,
      })
      .select()
      .single();

    if (error) throw error;
    return record;
  }
}

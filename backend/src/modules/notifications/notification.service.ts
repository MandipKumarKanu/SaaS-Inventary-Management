import { supabaseAdmin } from '../../config/supabase.js';

export interface NotificationItem {
  id: string;
  type: 'low_stock' | 'expiring_batch' | 'pending_transfer' | 'pending_count';
  title: string;
  message: string;
  severity: 'warning' | 'error' | 'info';
  timestamp: string;
}

export class NotificationService {
  static async getWorkspaceNotifications(
    workspaceId: string,
    queryParams?: { page?: number; pageSize?: number; severity?: string }
  ) {
    const notifications: NotificationItem[] = [];

    // 1. Check Low Stock Items
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, reorder_point')
      .eq('workspace_id', workspaceId);

    const { data: stockLevels } = await supabaseAdmin
      .from('inventory')
      .select('product_id, quantity')
      .eq('workspace_id', workspaceId);

    const stockMap: Record<string, number> = {};
    (stockLevels || []).forEach((s) => {
      stockMap[s.product_id] = (stockMap[s.product_id] || 0) + (s.quantity || 0);
    });

    (products || []).forEach((p) => {
      const qty = stockMap[p.id] || 0;
      const rp = p.reorder_point ?? 10;
      if (qty <= rp) {
        notifications.push({
          id: `low-stock-${p.id}`,
          type: 'low_stock',
          title: `Low Stock Warning: ${p.name}`,
          message: `Current stock (${qty} units) is at or below reorder threshold (${rp} units).`,
          severity: qty === 0 ? 'error' : 'warning',
          timestamp: new Date().toISOString(),
        });
      }
    });

    // 2. Check Pending Transfers
    const { data: transfers } = await supabaseAdmin
      .from('stock_transfers')
      .select('id, transfer_number, status')
      .eq('workspace_id', workspaceId)
      .in('status', ['requested', 'approved', 'shipped']);

    (transfers || []).forEach((t) => {
      notifications.push({
        id: `transfer-${t.id}`,
        type: 'pending_transfer',
        title: `Transfer ${t.transfer_number} Pending`,
        message: `Transfer is currently in status: ${t.status.toUpperCase()}.`,
        severity: 'info',
        timestamp: new Date().toISOString(),
      });
    });

    // Tab counts over the full assembled set (before severity filter / pagination).
    const counts = {
      all: notifications.length,
      error: notifications.filter((n) => n.severity === 'error').length,
      warning: notifications.filter((n) => n.severity === 'warning').length,
      info: notifications.filter((n) => n.severity === 'info').length,
    };

    // Optional severity filter. Unknown values are ignored (no filter).
    const severity = queryParams?.severity;
    const filtered =
      !severity || severity === 'all'
        ? notifications
        : ['error', 'warning', 'info'].includes(severity)
          ? notifications.filter((n) => n.severity === severity)
          : notifications;

    const total = filtered.length;
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);
    const meta = {
      page: page || 1,
      pageSize: page ? pageSize : total,
      total,
      totalPages: page ? Math.ceil(total / pageSize) : 1,
      counts,
    };
    if (page === undefined) {
      return { data: filtered, meta };
    }
    return {
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      meta,
    };
  }
}

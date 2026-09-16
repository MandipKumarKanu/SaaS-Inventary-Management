import { supabaseAdmin } from '../../config/supabase.js';

export class SecurityService {
  static async listEvents(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 50, 100);

    let query = supabaseAdmin
      .from('security_events')
      .select('id, event_type, severity, ip_address, user_agent, metadata, created_at, user:users(id, email, name)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (page !== undefined) {
      query = query.range((page - 1) * pageSize, page * pageSize - 1);
    } else {
      query = query.limit(pageSize);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    const total = count ?? data?.length ?? 0;
    return {
      data: data || [],
      meta: {
        page: page ?? 1,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async logEvent(params: {
    workspaceId?: string;
    userId?: string;
    eventType: string;
    severity?: 'info' | 'warning' | 'critical';
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }) {
    const { error } = await supabaseAdmin.from('security_events').insert({
      workspace_id: params.workspaceId || null,
      user_id: params.userId || null,
      event_type: params.eventType,
      severity: params.severity || 'info',
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      metadata: params.metadata || {},
    });

    if (error) console.error('Failed to log security event:', error.message);
  }
}

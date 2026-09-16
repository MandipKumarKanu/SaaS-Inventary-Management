import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import crypto from 'crypto';

export class WebhookService {
  static async listSubscriptions(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('webhook_subscriptions')
      .select('*', { count: 'exact' })
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

  static async createSubscription(workspaceId: string, url: string, events: string[]) {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const { data, error } = await supabaseAdmin
      .from('webhook_subscriptions')
      .insert({
        workspace_id: workspaceId,
        url,
        secret,
        events: events.length > 0 ? events : ['stock.updated'],
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async deleteSubscription(id: string, workspaceId: string) {
    const { error } = await supabaseAdmin
      .from('webhook_subscriptions')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;
  }

  static async handleStripeWebhookEvent(eventId: string, eventType: string) {
    // Idempotency check
    const { data: existing } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      return { status: 'already_processed' };
    }

    await supabaseAdmin
      .from('stripe_webhook_events')
      .insert({ event_id: eventId, event_type: eventType });

    return { status: 'processed' };
  }
}

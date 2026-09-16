import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import crypto from 'crypto';

export class APIKeyService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('api_keys')
      .select('id, name, key_prefix, scopes, last_used_at, expires_at, created_at', { count: 'exact' })
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

  static async createKey(workspaceId: string, name: string) {
    const randomBytes = crypto.randomBytes(24).toString('hex');
    const rawSecret = `sk_live_${randomBytes}`;
    const keyPrefix = rawSecret.slice(0, 12);
    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        workspace_id: workspaceId,
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes: ['read', 'write'],
      })
      .select('id, name, key_prefix, created_at')
      .single();

    if (error) throw error;

    return {
      ...data,
      rawSecret, // Secret returned only ONCE upon creation
    };
  }

  static async revokeKey(id: string, workspaceId: string) {
    const { error } = await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;
  }

  static async verifyKey(rawSecret: string) {
    if (!rawSecret || !rawSecret.startsWith('sk_live_')) {
      throw AppError.unauthorized('Invalid API key format', 'INVALID_API_KEY');
    }

    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, workspace_id, scopes')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      throw AppError.unauthorized('Invalid or revoked API key', 'INVALID_API_KEY');
    }

    // Update last_used_at timestamp asynchronously
    supabaseAdmin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then();

    return { workspaceId: data.workspace_id, scopes: data.scopes };
  }
}

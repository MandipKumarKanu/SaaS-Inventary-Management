import { supabaseAdmin } from '../../config/supabase.js';

export class CurrencyService {
  static async list(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('currency_rates')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('currency_code', { ascending: true });

    if (page !== undefined) {
      query = query.range((page - 1) * pageSize, page * pageSize - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    const total = count ?? data?.length ?? 0;
    if (total === 0) {
      // Lookup workspace default currency settings
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('settings')
        .eq('id', workspaceId)
        .maybeSingle();

      const settings = (ws?.settings as Record<string, any>) || {};
      const baseCode = (settings.currency || settings.default_currency || 'NPR').toUpperCase();
      const baseSymbol = settings.currency_symbol || (baseCode === 'NPR' ? 'रू' : baseCode === 'INR' ? '₹' : '$');

      const fallback = [{ currency_code: baseCode, symbol: baseSymbol, exchange_rate: 1.0, is_base: true }];
      if (page === undefined) {
        return {
          data: fallback,
          meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
        };
      }
      const paged = fallback.slice((page - 1) * pageSize, page * pageSize);
      return {
        data: paged,
        meta: { page, pageSize, total: 1, totalPages: 1 },
      };
    }
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

  static async addOrUpdateRate(workspaceId: string, currencyCode: string, symbol: string, exchangeRate: number) {
    const { data, error } = await supabaseAdmin
      .from('currency_rates')
      .upsert({
        workspace_id: workspaceId,
        currency_code: currencyCode.toUpperCase(),
        symbol,
        exchange_rate: exchangeRate,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

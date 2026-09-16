import { supabaseAdmin } from '../../config/supabase.js';

export class ShippingService {
  /**
   * Offline rate estimator (no live carrier credentials configured).
   * Uses the destination postal code to derive a distance zone and the
   * package weight for the base charge. Every quote is flagged
   * `is_estimate: true` so clients never present these as live carrier rates.
   */
  static async getRateQuotes(weightKg: number, destinationZip: string) {
    const weight = Math.max(0.1, Number(weightKg) || 0.1);
    const digits = String(destinationZip || '').replace(/\D/g, '');
    const zoneDigit = parseInt(digits.charAt(0) || '5', 10);
    const zone = Number.isNaN(zoneDigit) ? 5 : Math.min(8, Math.max(2, zoneDigit));
    const zoneFactor = 1 + (zone - 2) * 0.08;

    const baseRate = Math.max(8.5, weight * 4.2) * zoneFactor;

    const quotes = [
      {
        carrier: 'usps',
        service_level: 'Priority Mail',
        rate_amount: +(baseRate * 0.85).toFixed(2),
        estimated_days: 3,
      },
      {
        carrier: 'fedex',
        service_level: 'FedEx Ground',
        rate_amount: +(baseRate * 1.1).toFixed(2),
        estimated_days: 2,
      },
      {
        carrier: 'ups',
        service_level: 'UPS Next Day Air',
        rate_amount: +(baseRate * 2.4).toFixed(2),
        estimated_days: 1,
      },
      {
        carrier: 'dhl',
        service_level: 'DHL Express International',
        rate_amount: +(baseRate * 3.1).toFixed(2),
        estimated_days: 2,
      },
    ];

    return quotes.map((q) => ({ ...q, is_estimate: true, zone }));
  }

  /**
   * Record an internal shipping label. The tracking reference is derived
   * from the persisted row id (unique per label); no external carrier file
   * exists, so label_url stays null until a carrier integration provides one.
   */
  static async generateLabel(
    workspaceId: string,
    salesOrderId: string | null,
    carrier: string,
    serviceLevel: string,
    rateAmount: number
  ) {
    const { data: row, error: insertError } = await supabaseAdmin
      .from('shipping_labels')
      .insert({
        workspace_id: workspaceId,
        sales_order_id: salesOrderId || null,
        carrier,
        service_level: serviceLevel,
        tracking_number: 'PENDING',
        label_url: null,
        rate_amount: rateAmount,
        status: 'created',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const trackingNumber = `SF-${String(row.id).replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const { data, error } = await supabaseAdmin
      .from('shipping_labels')
      .update({ tracking_number: trackingNumber })
      .eq('id', row.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * List created shipping labels
   */
  static async listLabels(workspaceId: string, queryParams?: { page?: number; pageSize?: number }) {
    const page = queryParams?.page;
    const pageSize = Math.min(queryParams?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('shipping_labels')
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
}

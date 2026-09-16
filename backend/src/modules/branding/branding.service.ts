import { supabaseAdmin } from '../../config/supabase.js';

export class BrandingService {
  static async getBranding(workspaceId: string) {
    const { data } = await supabaseAdmin
      .from('workspace_branding')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!data) {
      return {
        workspace_id: workspaceId,
        company_name: '',
        logo_url: '',
        primary_color: '#6366f1',
        accent_color: '#10b981',
        company_address: '',
        tax_id: '',
        invoice_footer_text: 'Thank you for your business!',
      };
    }
    return data;
  }

  static async updateBranding(workspaceId: string, payload: Record<string, any>) {
    const { data, error } = await supabaseAdmin
      .from('workspace_branding')
      .upsert(
        {
          workspace_id: workspaceId,
          company_name: payload.company_name || null,
          logo_url: payload.logo_url || null,
          primary_color: payload.primary_color || '#6366f1',
          accent_color: payload.accent_color || '#10b981',
          company_address: payload.company_address || null,
          tax_id: payload.tax_id || null,
          invoice_footer_text: payload.invoice_footer_text || 'Thank you for your business!',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' }
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

import { supabaseAdmin } from '../../config/supabase.js';

export class AutomationService {
  static async listRules(workspaceId: string) {
    const { data, error } = await supabaseAdmin
      .from('automation_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  static async createRule(
    workspaceId: string,
    name: string,
    triggerEvent: string,
    actionType: string,
    conditions: Record<string, any>
  ) {
    const { data, error } = await supabaseAdmin
      .from('automation_rules')
      .insert({
        workspace_id: workspaceId,
        name,
        trigger_event: triggerEvent,
        action_type: actionType,
        conditions,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async toggleRule(workspaceId: string, id: string, isActive: boolean) {
    const { data, error } = await supabaseAdmin
      .from('automation_rules')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

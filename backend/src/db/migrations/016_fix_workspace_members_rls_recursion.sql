-- ============================================
-- 016: Fix Workspace Members RLS Infinite Recursion
--   - Replaces recursive self-referential RLS policies on workspace_members
--     and dependent tables with calls to public.is_workspace_member(ws_id).
--   - public.is_workspace_member is SECURITY DEFINER, so it executes under the
--     function creator's privileges (postgres), bypassing RLS evaluation on
--     workspace_members inside the check and breaking the infinite recursion loop.
-- ============================================

-- Ensure helper function exists and is SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Workspaces
DROP POLICY IF EXISTS workspaces_select ON public.workspaces;
CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id));

-- 2. Workspace Members
DROP POLICY IF EXISTS workspace_members_select ON public.workspace_members;
CREATE POLICY workspace_members_select ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- 3. Workspace Invitations
DROP POLICY IF EXISTS invitations_select ON public.workspace_invitations;
CREATE POLICY invitations_select ON public.workspace_invitations
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    OR email = (SELECT email FROM public.users WHERE id = auth.uid())
  );

-- 4. Roles
DROP POLICY IF EXISTS roles_select ON public.roles;
CREATE POLICY roles_select ON public.roles
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- 5. Role Permissions
DROP POLICY IF EXISTS role_permissions_select ON public.role_permissions;
CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT USING (
    role_id IN (
      SELECT id FROM public.roles WHERE public.is_workspace_member(workspace_id)
    )
  );

-- 6. Member Roles
DROP POLICY IF EXISTS member_roles_select ON public.member_roles;
CREATE POLICY member_roles_select ON public.member_roles
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM public.workspace_members WHERE public.is_workspace_member(workspace_id)
    )
  );

-- 7. Member Permissions
DROP POLICY IF EXISTS member_permissions_select ON public.member_permissions;
CREATE POLICY member_permissions_select ON public.member_permissions
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM public.workspace_members WHERE public.is_workspace_member(workspace_id)
    )
  );

-- 8. Subscriptions
DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- 9. Usage Records
DROP POLICY IF EXISTS usage_records_select ON public.usage_records;
CREATE POLICY usage_records_select ON public.usage_records
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- 10. Audit Logs
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- 11. Scale Integrations
DROP POLICY IF EXISTS "Workspace members can access integration_connections" ON public.integration_connections;
CREATE POLICY "Workspace members can access integration_connections"
  ON public.integration_connections FOR ALL
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can access shipping_labels" ON public.shipping_labels;
CREATE POLICY "Workspace members can access shipping_labels"
  ON public.shipping_labels FOR ALL
  USING (public.is_workspace_member(workspace_id));

-- 12. Security Events & Backups
DROP POLICY IF EXISTS "Workspace members can access security_events" ON public.security_events;
CREATE POLICY "Workspace members can access security_events"
  ON public.security_events FOR ALL
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can access workspace_backups" ON public.workspace_backups;
CREATE POLICY "Workspace members can access workspace_backups"
  ON public.workspace_backups FOR ALL
  USING (public.is_workspace_member(workspace_id));

-- 13. Workspace Branding
DROP POLICY IF EXISTS "Workspace members can access workspace_branding" ON public.workspace_branding;
CREATE POLICY "Workspace members can access workspace_branding"
  ON public.workspace_branding FOR ALL
  USING (public.is_workspace_member(workspace_id));

-- 14. AI Copilot & Automation
DROP POLICY IF EXISTS "Workspace members can access ai_conversations" ON public.ai_conversations;
CREATE POLICY "Workspace members can access ai_conversations"
  ON public.ai_conversations FOR ALL
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can access automation_rules" ON public.automation_rules;
CREATE POLICY "Workspace members can access automation_rules"
  ON public.automation_rules FOR ALL
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace members can access warehouse_routing_rules" ON public.warehouse_routing_rules;
CREATE POLICY "Workspace members can access warehouse_routing_rules"
  ON public.warehouse_routing_rules FOR ALL
  USING (public.is_workspace_member(workspace_id));

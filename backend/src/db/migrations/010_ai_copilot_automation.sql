-- Phase 10 Migration: AI Copilot, Automation Workflow Auto-Pilot & Smart 3PL Multi-Warehouse Routing

-- 1. AI Conversations Table
CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Stock Intelligence Chat',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace ON public.ai_conversations(workspace_id, updated_at DESC);

-- 2. Automation Workflow Auto-Pilot Rules Table
CREATE TABLE IF NOT EXISTS public.automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    trigger_event VARCHAR(50) NOT NULL, -- 'LOW_STOCK', 'SUPPLIER_DELAY', 'EXPIRING_BATCH'
    action_type VARCHAR(50) NOT NULL, -- 'AUTO_CREATE_PO', 'SEND_NOTIFICATION', 'DISPATCH_WEBHOOK'
    conditions JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_workspace ON public.automation_rules(workspace_id);

-- 3. Smart 3PL Multi-Warehouse Routing Rules Table
CREATE TABLE IF NOT EXISTS public.warehouse_routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    destination_region VARCHAR(100) NOT NULL,
    preferred_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
    priority INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_workspace ON public.warehouse_routing_rules(workspace_id);

-- Enable RLS
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_routing_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Workspace members can access ai_conversations" ON public.ai_conversations;
CREATE POLICY "Workspace members can access ai_conversations"
ON public.ai_conversations FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Workspace members can access automation_rules" ON public.automation_rules;
CREATE POLICY "Workspace members can access automation_rules"
ON public.automation_rules FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Workspace members can access warehouse_routing_rules" ON public.warehouse_routing_rules;
CREATE POLICY "Workspace members can access warehouse_routing_rules"
ON public.warehouse_routing_rules FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

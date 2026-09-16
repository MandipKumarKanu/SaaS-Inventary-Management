-- Phase 8 Migration: Production Polish, Security Hardening & Disaster Recovery

-- 1. Security Events Audit Trail Table
CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL, -- 'LOGIN_FAILED', 'API_KEY_REVOKED', 'RATE_LIMIT_EXCEEDED', 'BACKUP_CREATED', 'ROLE_CHANGED'
    severity VARCHAR(20) NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_workspace ON public.security_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type);

-- 2. Workspace Data Backups & Disaster Recovery Snapshots Table
CREATE TABLE IF NOT EXISTS public.workspace_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed', -- 'pending', 'completed', 'failed'
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    summary JSONB DEFAULT '{}'::jsonb,
    download_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_backups_workspace ON public.workspace_backups(workspace_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_backups ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Workspace members can access security_events" ON public.security_events;
CREATE POLICY "Workspace members can access security_events"
ON public.security_events FOR ALL
USING (
    workspace_id IS NULL OR workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Workspace members can access workspace_backups" ON public.workspace_backups;
CREATE POLICY "Workspace members can access workspace_backups"
ON public.workspace_backups FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

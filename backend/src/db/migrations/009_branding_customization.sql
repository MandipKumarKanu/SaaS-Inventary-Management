-- Phase 9 Migration: White-Label Branding & Workspace Customization

CREATE TABLE IF NOT EXISTS public.workspace_branding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    company_name VARCHAR(100),
    logo_url TEXT,
    primary_color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
    accent_color VARCHAR(20) NOT NULL DEFAULT '#10b981',
    company_address TEXT,
    tax_id VARCHAR(50),
    invoice_footer_text TEXT DEFAULT 'Thank you for your business!',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_workspace_branding UNIQUE (workspace_id)
);

-- Enable RLS
ALTER TABLE public.workspace_branding ENABLE ROW LEVEL SECURITY;

-- RLS Policy
DROP POLICY IF EXISTS "Workspace members can access workspace_branding" ON public.workspace_branding;
CREATE POLICY "Workspace members can access workspace_branding"
ON public.workspace_branding FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

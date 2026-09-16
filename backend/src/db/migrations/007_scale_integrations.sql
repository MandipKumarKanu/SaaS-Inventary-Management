-- Phase 7 Migration: Scale, E-Commerce & Shipping Integrations, Background Jobs & System Telemetry

-- 1. Integration Connections Table (Shopify, WooCommerce, Amazon, EasyPost)
CREATE TABLE IF NOT EXISTS public.integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'shopify', 'woocommerce', 'amazon', 'easypost'
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'disconnected', 'error'
    credentials JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_workspace_provider UNIQUE (workspace_id, provider)
);

-- Index for workspace lookup
CREATE INDEX IF NOT EXISTS idx_integration_connections_workspace ON public.integration_connections(workspace_id);

-- 2. Shipping Labels & Rate Quotes Table
CREATE TABLE IF NOT EXISTS public.shipping_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
    carrier VARCHAR(50) NOT NULL, -- 'fedex', 'ups', 'dhl', 'usps'
    service_level VARCHAR(50) NOT NULL DEFAULT 'ground',
    tracking_number VARCHAR(100) NOT NULL,
    label_url TEXT,
    rate_amount NUMERIC(15, 4) NOT NULL DEFAULT 0.0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'created', -- 'created', 'in_transit', 'delivered', 'cancelled'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_labels_workspace ON public.shipping_labels(workspace_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_order ON public.shipping_labels(sales_order_id);

-- 3. Background Job Log Execution History Table
CREATE TABLE IF NOT EXISTS public.background_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'running'
    details JSONB DEFAULT '{}'::jsonb,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_job_logs_name ON public.background_job_logs(job_name, executed_at DESC);

-- Enable RLS
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_job_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Workspace members can access integration_connections" ON public.integration_connections;
CREATE POLICY "Workspace members can access integration_connections"
ON public.integration_connections FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Workspace members can access shipping_labels" ON public.shipping_labels;
CREATE POLICY "Workspace members can access shipping_labels"
ON public.shipping_labels FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Allow service role access to background_job_logs" ON public.background_job_logs;
CREATE POLICY "Allow service role access to background_job_logs"
ON public.background_job_logs FOR ALL
USING (true);

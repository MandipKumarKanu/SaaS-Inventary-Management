-- ============================================
-- Phase 4: Commercial Operations Migration
-- Tables: suppliers, customers, purchase_orders, purchase_order_items,
--          sales_orders, sales_order_items, customer_returns, customer_return_items
-- ============================================

-- 1. SUPPLIERS
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  payment_terms TEXT,
  lead_time_days INT DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_workspace ON public.suppliers(workspace_id);

-- 2. CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_customers_workspace ON public.customers(workspace_id);

-- 3. PURCHASE ORDERS (Header)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')),
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  expected_delivery_date DATE,
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_po_workspace ON public.purchase_orders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);

-- 4. PURCHASE ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordered_qty INT NOT NULL CHECK (ordered_qty > 0),
  received_qty INT NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  total_cost NUMERIC(12,2) GENERATED ALWAYS AS (ordered_qty * unit_cost) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(po_id);

-- 5. SALES ORDERS (Header)
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  so_number TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'reserved', 'picking', 'packed', 'shipped', 'delivered', 'cancelled')),
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  shipping_address TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, so_number)
);

CREATE INDEX IF NOT EXISTS idx_so_workspace ON public.sales_orders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_so_status ON public.sales_orders(status);

-- 6. SALES ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  so_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordered_qty INT NOT NULL CHECK (ordered_qty > 0),
  fulfilled_qty INT NOT NULL DEFAULT 0 CHECK (fulfilled_qty >= 0),
  total_price NUMERIC(12,2) GENERATED ALWAYS AS (ordered_qty * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_so_items_so ON public.sales_order_items(so_id);

-- 7. CUSTOMER RETURNS (Header)
CREATE TABLE IF NOT EXISTS public.customer_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  return_number TEXT NOT NULL,
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'received', 'inspected', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, return_number)
);

CREATE INDEX IF NOT EXISTS idx_returns_workspace ON public.customer_returns(workspace_id);

-- 8. CUSTOMER RETURN ITEMS
CREATE TABLE IF NOT EXISTS public.customer_return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID NOT NULL REFERENCES public.customer_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  returned_qty INT NOT NULL CHECK (returned_qty > 0),
  restocked_qty INT NOT NULL DEFAULT 0 CHECK (restocked_qty >= 0),
  reason TEXT,
  condition TEXT DEFAULT 'resellable' CHECK (condition IN ('resellable', 'damaged', 'defective')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_items_return ON public.customer_return_items(return_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supplier access" ON public.suppliers FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Customer access" ON public.customers FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "PO access" ON public.purchase_orders FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "SO access" ON public.sales_orders FOR ALL USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Return access" ON public.customer_returns FOR ALL USING (public.is_workspace_member(workspace_id));

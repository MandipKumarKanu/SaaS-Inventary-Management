-- ============================================
-- Seed: Permissions catalog
--
-- Phase 7b: HARDCODED PLAN ROWS REMOVED. Subscription plans are seeded by
-- run-migrations.ts from the PLAN_SEED environment variable (JSON array) —
-- the DB is the runtime source of truth, env only bootstraps it. Same for
-- role templates (ROLE_TEMPLATE_SEED → role_templates table, migration 019).
-- ============================================

-- Insert all granular permissions (the DB-driven permission catalog).
-- Application code references codes via shared/permissions.ts constants but
-- NEVER declares the catalog itself — this table is authoritative.
INSERT INTO public.permissions (code, group_name, description) VALUES
  -- Products
  ('products.view', 'products', 'View products'),
  ('products.create', 'products', 'Create products'),
  ('products.update', 'products', 'Update products'),
  ('products.archive', 'products', 'Archive products'),
  -- Inventory
  ('inventory.view', 'inventory', 'View inventory'),
  ('inventory.adjust', 'inventory', 'Adjust inventory'),
  ('inventory.transfer', 'inventory', 'Transfer inventory'),
  ('inventory.count', 'inventory', 'Perform stock counts'),
  -- Warehouses
  ('warehouses.view', 'warehouses', 'View warehouses'),
  ('warehouses.create', 'warehouses', 'Create warehouses'),
  ('warehouses.update', 'warehouses', 'Update warehouses'),
  ('warehouses.archive', 'warehouses', 'Archive warehouses'),
  -- Purchases
  ('purchases.view', 'purchases', 'View purchase orders'),
  ('purchases.create', 'purchases', 'Create purchase orders'),
  ('purchases.approve', 'purchases', 'Approve purchase orders'),
  ('purchases.receive', 'purchases', 'Receive goods'),
  -- Sales
  ('sales.view', 'sales', 'View sales orders'),
  ('sales.create', 'sales', 'Create sales orders'),
  ('sales.reserve', 'sales', 'Reserve inventory'),
  ('sales.fulfill', 'sales', 'Fulfill sales orders'),
  ('sales.cancel', 'sales', 'Cancel sales orders'),
  -- Transfers
  ('transfers.view', 'transfers', 'View stock transfers'),
  ('transfers.create', 'transfers', 'Create stock transfers'),
  ('transfers.approve', 'transfers', 'Approve stock transfers'),
  ('transfers.ship', 'transfers', 'Ship stock transfers'),
  ('transfers.receive', 'transfers', 'Receive stock transfers'),
  -- Returns
  ('returns.view', 'returns', 'View returns'),
  ('returns.create', 'returns', 'Create returns'),
  ('returns.approve', 'returns', 'Approve returns'),
  ('returns.inspect', 'returns', 'Inspect returns'),
  ('returns.restock', 'returns', 'Restock returned items'),
  -- Reports
  ('reports.view', 'reports', 'View reports'),
  ('reports.export', 'reports', 'Export reports'),
  -- Team
  ('team.view', 'team', 'View team members'),
  ('team.invite', 'team', 'Invite team members'),
  ('team.manage', 'team', 'Manage team members'),
  -- Roles
  ('roles.view', 'roles', 'View roles'),
  ('roles.manage', 'roles', 'Manage roles'),
  -- Settings
  ('settings.view', 'settings', 'View workspace settings'),
  ('settings.manage', 'settings', 'Manage workspace settings'),
  -- Billing
  ('billing.view', 'billing', 'View billing information'),
  ('billing.manage', 'billing', 'Manage billing')
ON CONFLICT (code) DO NOTHING;

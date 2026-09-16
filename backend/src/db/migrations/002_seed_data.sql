-- ============================================
-- Seed: Permissions + Subscription Plans
-- ============================================

-- Insert all granular permissions
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

-- Insert subscription plans
INSERT INTO public.subscription_plans (name, display_name, price_monthly, price_annual, limits, features, sort_order) VALUES
  ('free', 'Free', 0, 0,
   '{"users": 2, "products": 100, "warehouses": 1, "transactions_per_month": 500, "storage_mb": 100}',
   '{"basic_reports": true, "csv_export": true, "forecasting": false, "api_access": false, "priority_support": false}',
   1),
  ('starter', 'Starter', 29, 290,
   '{"users": 5, "products": 1000, "warehouses": 2, "transactions_per_month": 5000, "storage_mb": 1000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": false, "api_access": false, "priority_support": false}',
   2),
  ('business', 'Business', 79, 790,
   '{"users": 25, "products": 10000, "warehouses": 10, "transactions_per_month": 50000, "storage_mb": 10000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": true, "api_access": true, "priority_support": true}',
   3),
  ('enterprise', 'Enterprise', 199, 1990,
   '{"users": -1, "products": -1, "warehouses": -1, "transactions_per_month": -1, "storage_mb": 100000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": true, "api_access": true, "priority_support": true, "custom_integrations": true}',
   4)
ON CONFLICT (name) DO NOTHING;

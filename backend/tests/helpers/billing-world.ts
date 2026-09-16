import { TestDb } from './supabase-mock';

/** Deterministic plan ids shared by billing + stripe suites. */
export const PLAN_IDS: Record<string, string> = {
  free: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  starter: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  business: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  enterprise: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
};

export const PLAN_SEED = [
  {
    id: PLAN_IDS.free,
    name: 'free',
    display_name: 'Free',
    price_monthly: 0,
    price_annual: 0,
    limits: { users: 2, products: 100, warehouses: 1, transactions_per_month: 500, storage_mb: 100 },
    features: { basic_reports: true, csv_export: true, forecasting: false, api_access: false, priority_support: false },
    is_active: true,
    sort_order: 1,
  },
  {
    id: PLAN_IDS.starter,
    name: 'starter',
    display_name: 'Starter',
    price_monthly: 29,
    price_annual: 290,
    limits: { users: 5, products: 1000, warehouses: 2, transactions_per_month: 5000, storage_mb: 1000 },
    features: { basic_reports: true, csv_export: true, forecasting: false, api_access: false, priority_support: false },
    is_active: true,
    sort_order: 2,
  },
  {
    id: PLAN_IDS.business,
    name: 'business',
    display_name: 'Business',
    price_monthly: 79,
    price_annual: 790,
    limits: { users: 25, products: 10000, warehouses: 10, transactions_per_month: 50000, storage_mb: 10000 },
    features: { basic_reports: true, csv_export: true, forecasting: true, api_access: true, priority_support: true },
    is_active: true,
    sort_order: 3,
  },
  {
    id: PLAN_IDS.enterprise,
    name: 'enterprise',
    display_name: 'Enterprise',
    price_monthly: 199,
    price_annual: 1990,
    limits: { users: -1, products: -1, warehouses: -1, transactions_per_month: -1, storage_mb: 100000 },
    features: { basic_reports: true, csv_export: true, forecasting: true, api_access: true, priority_support: true, custom_integrations: true },
    is_active: true,
    sort_order: 4,
  },
];

/** Seed the plan catalog into the test DB. */
export function seedPlans(testDb: TestDb): void {
  testDb.__insert('subscription_plans', PLAN_SEED);
}

/** Insert or replace the subscription row for a workspace (mirrors UNIQUE(workspace_id)). */
export function upsertSubscription(
  testDb: TestDb,
  workspaceId: string,
  planId: string,
  status = 'active',
  extra: Record<string, any> = {}
): void {
  const subs = testDb.__all('subscriptions') as any[];
  const existing = subs.find((s) => s.workspace_id === workspaceId);
  if (existing) {
    Object.assign(existing, { plan_id: planId, status, ...extra });
  } else {
    testDb.__insert('subscriptions', [
      {
        id: `sub_${workspaceId.slice(-6)}`,
        workspace_id: workspaceId,
        plan_id: planId,
        status,
        billing_interval: 'monthly',
        ...extra,
      },
    ]);
  }
}

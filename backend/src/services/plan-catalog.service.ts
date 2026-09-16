import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';

/**
 * Phase 3: DB-driven plan catalog (PRD §15 — "plan definitions must live in
 * the database"). Replaces every hardcoded PLAN_LIMITS record.
 *
 * Plan shapes come from migration 002 seeds:
 *   limits   JSONB: users, products, warehouses, transactions_per_month, storage_mb
 *   features JSONB: basic_reports, csv_export, forecasting, api_access,
 *                   priority_support, custom_integrations
 * Convention: limit === -1 means unlimited.
 */

export interface PlanLimits {
  users: number;
  products: number;
  warehouses: number;
  transactions_per_month: number;
  storage_mb: number;
}

export interface PlanFeatures {
  basic_reports: boolean;
  csv_export: boolean;
  forecasting: boolean;
  api_access: boolean;
  priority_support: boolean;
  custom_integrations: boolean;
}

export interface Plan {
  id: string;
  name: string; // lowercase tier key: free | starter | business | enterprise
  displayName: string;
  priceMonthly: number;
  priceAnnual: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

interface DbPlanRow {
  id: string;
  name: string;
  display_name: string;
  price_monthly: number | string;
  price_annual: number | string;
  limits: Partial<PlanLimits> | null;
  features: Partial<PlanFeatures> | null;
}

const UNLIMITED = -1;

function mapPlan(row: DbPlanRow): Plan {
  const l = row.limits || {};
  const f = row.features || {};
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    priceMonthly: Number(row.price_monthly ?? 0),
    priceAnnual: Number(row.price_annual ?? 0),
    limits: {
      users: l.users ?? UNLIMITED,
      products: l.products ?? UNLIMITED,
      warehouses: l.warehouses ?? UNLIMITED,
      transactions_per_month: l.transactions_per_month ?? UNLIMITED,
      storage_mb: l.storage_mb ?? UNLIMITED,
    },
    features: {
      basic_reports: f.basic_reports ?? true,
      csv_export: f.csv_export ?? true,
      forecasting: f.forecasting ?? false,
      api_access: f.api_access ?? false,
      priority_support: f.priority_support ?? false,
      custom_integrations: f.custom_integrations ?? false,
    },
  };
}

export const FEATURE_KEYS = [
  'basic_reports',
  'csv_export',
  'forecasting',
  'api_access',
  'priority_support',
  'custom_integrations',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Small in-process TTL cache: plans change rarely; avoids a DB hit per request. */
const CACHE_TTL_MS = 60_000;
let cache: { plans: Plan[]; fetchedAt: number } | null = null;

export class PlanCatalogService {
  static invalidateCache(): void {
    cache = null;
  }

  static async listActivePlans(): Promise<Plan[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.plans;
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    const plans = (data || []).map(mapPlan);

    cache = { plans, fetchedAt: Date.now() };
    return plans;
  }

  static async getPlanById(id: string): Promise<Plan | null> {
    const plans = await this.listActivePlans();
    return plans.find((p) => p.id === id) || null;
  }

  static async getPlanByName(name: string): Promise<Plan | null> {
    const plans = await this.listActivePlans();
    return plans.find((p) => p.name.toLowerCase() === name.toLowerCase()) || null;
  }

  /** Strict lookup — unknown plans are a client error. */
  static async requirePlanByName(name: string): Promise<Plan> {
    const plan = await this.getPlanByName(name);
    if (!plan) throw AppError.notFound(`Unknown plan: ${name}`, 'PLAN_NOT_FOUND');
    return plan;
  }

  static async requirePlanById(id: string): Promise<Plan> {
    const plan = await this.getPlanById(id);
    if (!plan) throw AppError.notFound(`Unknown plan: ${id}`, 'PLAN_NOT_FOUND');
    return plan;
  }
}

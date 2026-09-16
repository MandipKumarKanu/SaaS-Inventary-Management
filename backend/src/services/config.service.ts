import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../config/logger.js';

/**
 * Phase 7b: DB-driven configuration access.
 *
 * Operational defaults (trial length, thresholds, default plan tier) live in
 * the `config_defaults` table — seeded from env vars at migration time, then
 * OVERRIDABLE at runtime without a deploy. Reads fall back to the env var
 * only when the table row is missing (e.g. before first migration), and to
 * the last-resort literals below only when both are absent. No feature code
 * holds its own constants anymore.
 */
export class ConfigService {
  private static cache = new Map<string, { value: any; expires: number }>();
  private static TTL_MS = 60_000;

  /** Read one config value: DB → env fallback → null. */
  static async get<T = any>(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value as T;

    try {
      const { data, error } = await supabaseAdmin
        .from('config_defaults')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (!error && data) {
        this.cache.set(key, { value: data.value, expires: Date.now() + this.TTL_MS });
        return data.value as T;
      }
    } catch (err: any) {
      logger.warn('config_defaults read failed; falling back to env', { key, error: err.message });
    }

    const envFallback = this.fromEnv(key);
    if (envFallback !== null) {
      this.cache.set(key, { value: envFallback, expires: Date.now() + this.TTL_MS });
      return envFallback as T;
    }
    return null;
  }

  /** Read with a typed default — never throws. */
  static async getOr<T>(key: string, fallback: T): Promise<T> {
    const v = await this.get<T>(key);
    return v === null || v === undefined ? fallback : (v as T);
  }

  /** Invalidate the cache (config changes take effect immediately). */
  static invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  /** Env fallbacks — mirrors run-migrations.ts seeding. */
  private static fromEnv(key: string): any {
    switch (key) {
      case 'default_plan_tier': return process.env.DEFAULT_PLAN_TIER || null;
      case 'trial_days': return process.env.TRIAL_DAYS ? Number(process.env.TRIAL_DAYS) : null;
      case 'count_approval_threshold_pct':
        return process.env.COUNT_APPROVAL_THRESHOLD_PCT ? Number(process.env.COUNT_APPROVAL_THRESHOLD_PCT) : null;
      case 'expiry_alert_days':
        try { return process.env.EXPIRY_ALERT_DAYS ? JSON.parse(process.env.EXPIRY_ALERT_DAYS) : null; }
        catch { return null; }
      default: return null;
    }
  }
}

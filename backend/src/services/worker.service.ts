import { supabaseAdmin } from '../config/supabase.js';
import { ConfigService } from './config.service.js';
import { SubscriptionService } from '../modules/billing/subscription.service.js';
import { logger } from '../config/logger.js';

export class BackgroundWorkerService {
  private static isRunning = false;
  private static intervalTimer: NodeJS.Timeout | null = null;

  static startWorker(intervalMs = 300000) { // Default 5 minutes
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🚀 Background Worker Scheduler started...');

    // Run initial cycle after 5s
    setTimeout(() => this.runJobCycle(), 5000);

    // Periodic schedule
    this.intervalTimer = setInterval(() => this.runJobCycle(), intervalMs);
  }

  static stopWorker() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
    console.log('🛑 Background Worker Scheduler stopped.');
  }

  static async runJobCycle() {
    console.log('⚡ Running scheduled background jobs...');
    await this.runReorderCheckJob();
    await this.runFEFOExpirationCheckJob();
    await this.runExpirationAlertsJob();
    // SaaS Business Layer (§16): lifecycle jobs — all idempotent, safe to re-run.
    await this.runTrialExpirationJob();
    await this.runSubscriptionExpirationJob();
    await this.runCouponExpirationJob();
  }

  /**
   * §13/§16: expire finished trials (dev-mode subscriptions; Stripe-managed
   * ones are owned by webhooks). Idempotent: only rows still `trialing` with
   * a past trial_ends_at are touched, and the update guards on status.
   */
  private static async runTrialExpirationJob() {
    const jobName = 'CRON_TRIAL_EXPIRATION';
    try {
      const processed = await SubscriptionService.expireTrials();
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { trials_expired: processed },
      });
    } catch (err: any) {
      logger.error('Trial expiration job failed', { error: err.message });
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  /**
   * §14/§15/§16: period-end processing — scheduled cancels → cancelled,
   * everything else → past_due with grace; then grace expiry → cancelled.
   * Idempotent via status-guarded updates.
   */
  private static async runSubscriptionExpirationJob() {
    const jobName = 'CRON_SUBSCRIPTION_EXPIRATION';
    try {
      const processedPeriods = await SubscriptionService.processPeriodEnds();
      const expiredGrace = await SubscriptionService.expireGracePeriods();
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { periods_processed: processedPeriods, grace_periods_expired: expiredGrace },
      });
    } catch (err: any) {
      logger.error('Subscription expiration job failed', { error: err.message });
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  /**
   * §30: mark expired coupons inactive. Validation never depends on this job
   * (timestamps are checked at redemption time) — this is hygiene for admin
   * listings and dashboards.
   */
  private static async runCouponExpirationJob() {
    const jobName = 'CRON_COUPON_EXPIRATION';
    try {
      const nowIso = new Date().toISOString();
      const { data: expired, error } = await supabaseAdmin
        .from('coupons')
        .update({ active: false, updated_at: nowIso })
        .eq('active', true)
        .not('expires_at', 'is', null)
        .lt('expires_at', nowIso)
        .select('id');
      if (error) throw error;
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { coupons_expired: expired?.length ?? 0 },
      });
    } catch (err: any) {
      logger.error('Coupon expiration job failed', { error: err.message });
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  private static async runReorderCheckJob() {
    const jobName = 'CRON_REORDER_ALERTS_CHECK';
    try {
      // Find low-stock inventory items
      const { data, count } = await supabaseAdmin
        .from('inventory')
        .select('id', { count: 'exact' });

      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { items_checked: count || 0, alerts_generated: 0 },
      });
    } catch (err: any) {
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  private static async runFEFOExpirationCheckJob() {
    const jobName = 'CRON_FEFO_EXPIRATION_CHECK';
    try {
      const nowStr = new Date().toISOString();
      const { data, count } = await supabaseAdmin
        .from('batches')
        .select('id', { count: 'exact' })
        .lt('expiry_date', nowStr);

      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { expired_batches_found: count || 0 },
      });
    } catch (err: any) {
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  /**
   * Phase 6 (PRD §33, §38): expiration ALERTS at configurable thresholds.
   * Creates one persisted notification per (batch, day) — the partial unique
   * index from migration 017 makes re-runs idempotent.
   */
  private static async runExpirationAlertsJob() {
    const jobName = 'CRON_EXPIRATION_ALERTS';
    try {
      const today = new Date().toISOString().slice(0, 10); // DATE comparison

      // Thresholds: deployment default from config_defaults → env (Phase 7b),
      // overridable per workspace via workspaces.settings.expiry_alert_days
      const { data: workspaces, error: wsErr } = await supabaseAdmin
        .from('workspaces')
        .select('id, settings');
      if (wsErr) throw wsErr;

      const defaultThresholds = await ConfigService.getOr<number[]>('expiry_alert_days', [30, 14, 7, 1]);
      let alertsGenerated = 0;

      for (const ws of workspaces || []) {
        const thresholds: number[] = Array.isArray((ws.settings as any)?.expiry_alert_days)
          ? (ws.settings as any).expiry_alert_days
          : defaultThresholds;

        // Furthest horizon limits the scan window
        const horizonDays = Math.max(...thresholds, 0);
        if (horizonDays <= 0) continue;
        const horizon = new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

        // Batches expiring within the horizon (or already expired) with stock left
        const { data: batches, error: bErr } = await supabaseAdmin
          .from('batches')
          .select('id, batch_number, expiry_date, synced_quantity, product_id, product:products(id, name, sku)')
          .eq('workspace_id', ws.id)
          .lte('expiry_date', horizon)
          .gt('synced_quantity', 0);
        if (bErr) throw bErr;

        for (const b of (batches || []) as any[]) {
          if (!b.expiry_date) continue;
          const daysLeft = Math.ceil(
            (new Date(b.expiry_date).getTime() - new Date(today).getTime()) / (24 * 60 * 60 * 1000)
          );

          // Alert if expired or within ANY configured threshold
          const hitsThreshold = daysLeft < 0 || thresholds.some((t) => daysLeft === t || daysLeft < t);
          const shouldAlert = daysLeft < 0 ? true : thresholds.some((t) => daysLeft <= t);
          if (!shouldAlert || !hitsThreshold) continue;

          const expired = daysLeft < 0;
          const { error: insErr } = await supabaseAdmin.from('notifications').insert({
            workspace_id: ws.id,
            user_id: null, // workspace-wide
            type: 'expiring_batch',
            title: expired
              ? `Batch ${b.batch_number} has EXPIRED`
              : `Batch ${b.batch_number} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            message: `${b.product?.name ?? 'Product'} (SKU ${b.product?.sku ?? '—'}): ${b.synced_quantity} units ${expired ? 'have expired' : `expire on ${b.expiry_date}`}. ${expired ? 'Write off or dispose per FEFO policy.' : 'Prioritize shipping this batch first (FEFO).'}`,
            severity: expired ? 'error' : daysLeft <= 7 ? 'warning' : 'info',
            reference_type: 'batch',
            reference_id: b.id,
          });

          // Unique partial index (workspace, batch, day) → duplicates are
          // expected on re-runs and silently skipped.
          if (!insErr) alertsGenerated += 1;
        }
      }

      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'success',
        details: { alerts_generated: alertsGenerated },
      });
    } catch (err: any) {
      await supabaseAdmin.from('background_job_logs').insert({
        job_name: jobName,
        status: 'failed',
        details: { error: err.message },
      });
    }
  }

  static async getJobLogs(limit = 20) {
    const { data, error } = await supabaseAdmin
      .from('background_job_logs')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }
}

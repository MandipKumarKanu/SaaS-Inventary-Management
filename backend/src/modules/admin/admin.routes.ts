import { Router, Request, Response, NextFunction } from 'express';
import { AdminService } from './admin.service.js';
import {
  AdminCouponService,
  AdminSubscriptionService,
  AdminSettingsService,
  AdminNotificationService,
  AdminExportService,
  AdminRefundService,
  AdminPlanService,
  AdminAnalyticsService,
  AdminBulkService,
  getDashboardAddendum,
  globalSearch,
  getEntitlementDiagnostics,
} from './admin-saas.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePlatformAdmin, requirePlatformPermission } from '../../middleware/platform-admin.middleware.js';
import { requireReAuthentication } from '../../middleware/admin-reauth.middleware.js';
import { parsePagination } from '../../shared/http.js';
import { z } from 'zod';

const router = Router();

// Phase 0 hardening (PRD §14, §58): the platform admin area is a separate
// administration surface and must never be reachable without both
// authentication and an explicit platform-admin grant.
router.use(authMiddleware as any);
router.use(requirePlatformAdmin as any);

router.get('/check-access', (req: Request, res: Response) => {
  res.json({ success: true, is_platform_admin: true });
});

// ============================================
// SaaS Business Layer: platform admin panel APIs
// Every endpoint carries an explicit platform permission (§76, §78).
// ============================================

router.get(
  '/overview',
  requirePlatformPermission('platform.overview.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const overview = await AdminService.getPlatformOverview();
      const addendum = await getDashboardAddendum();
      res.json({ success: true, data: { ...overview, saas: addendum } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/workspaces',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const result = await AdminService.listWorkspaces({
        page,
        pageSize,
        search,
        status,
        sortBy: req.query.sortBy as string | undefined,
        sortDir: req.query.sortDir as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// Admin workspace detail (§47) — read paths under platform.workspaces.view
router.get(
  '/workspaces/:id',
  requirePlatformPermission('platform.workspaces.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminService.getWorkspaceDetail(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

// Workspace payments (§56/§57) — billing visibility is BILLING-tier perms up
router.get(
  '/workspaces/:id/payments',
  requirePlatformPermission('platform.billing.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminService.listWorkspacePayments(req.params.id as string, page, pageSize);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/workspaces/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['active', 'suspended'].includes(status)) {
        res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Status must be active or suspended' } });
        return;
      }
      const updated = await AdminService.updateWorkspaceStatus(req.params.id as string, status);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/users',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const result = await AdminService.listUsers({
        page,
        pageSize,
        search,
        status,
        sortBy: req.query.sortBy as string | undefined,
        sortDir: req.query.sortDir as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/users/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['active', 'suspended'].includes(status)) {
        res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Status must be active or suspended' } });
        return;
      }
      const updated = await AdminService.updateUserStatus(req.params.id as string, status);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// Admin user detail (§44/§45) — profile, memberships, subscriptions, activity
router.get(
  '/users/:id',
  requirePlatformPermission('platform.users.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminService.getUserDetail(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

// ── Platform-wide payments (§56) + refunds (§57) ─────────────────────

router.get(
  '/payments',
  requirePlatformPermission('platform.billing.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminService.listAllPayments({
        page,
        pageSize,
        status: req.query.status as string | undefined,
        search: req.query.search as string | undefined,
        sortBy: req.query.sortBy as string | undefined,
        sortDir: req.query.sortDir as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// §69 payment detail drill-in
router.get(
  '/payments/:id',
  requirePlatformPermission('platform.billing.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminService.getPaymentDetail(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/payments/:id/refund',
  requirePlatformPermission('platform.billing.view') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          reason: z.string().min(3).max(500),
          amount: z.number().positive().optional(),
        })
        .parse(req.body);
      const result = await AdminRefundService.refund(req.params.id as string, (req as any).user.id, body.reason, body.amount);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── Usage & analytics (§59) ──────────────────────────────────────

router.get(
  '/analytics',
  requirePlatformPermission('platform.analytics.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const to = req.query.to ? new Date(String(req.query.to)) : new Date();
      const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 86400_000);
      const summary = await AdminAnalyticsService.summary(from.toISOString(), to.toISOString());
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  }
);

// ── Plan management (§34/§51) ─────────────────────────────────────────

router.get(
  '/plans',
  requirePlatformPermission('platform.plans.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AdminPlanService.list();
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/plans/:id',
  requirePlatformPermission('platform.plans.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = await AdminPlanService.getById(req.params.id as string);
      const usage = await AdminPlanService.usageCount(req.params.id as string);
      res.json({ success: true, data: { ...plan, usage } });
    } catch (err) {
      next(err);
    }
  }
);

const createPlanSchema = z.object({
  name: z.string().min(2).max(50),
  display_name: z.string().min(1).max(100),
  price_monthly: z.number().min(0),
  price_annual: z.number().min(0),
  limits: z.record(z.number()).optional(),
  features: z.record(z.boolean()).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
});

router.post(
  '/plans',
  requirePlatformPermission('platform.plans.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPlanSchema.parse(req.body);
      const plan = await AdminPlanService.create(body, (req as any).user.id);
      res.status(201).json({ success: true, data: plan });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/plans/:id',
  requirePlatformPermission('platform.plans.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          display_name: z.string().min(1).max(100).optional(),
          price_monthly: z.number().min(0).optional(),
          price_annual: z.number().min(0).optional(),
          limits: z.record(z.number()).optional(),
          features: z.record(z.boolean()).optional(),
          is_active: z.boolean().optional(),
          sort_order: z.number().int().min(0).max(10000).optional(),
        })
        .parse(req.body);
      const plan = await AdminPlanService.update(req.params.id as string, body, (req as any).user.id);
      res.json({ success: true, data: plan });
    } catch (err) {
      next(err);
    }
  }
);

// ── Platform settings (§64) + notifications (§63) ───────────────────

router.get(
  '/settings',
  requirePlatformPermission('platform.system.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await AdminSettingsService.list();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/settings/:key',
  requirePlatformPermission('platform.system.view') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ value: z.unknown() }).parse(req.body);
      const updated = await AdminSettingsService.update(req.params.key as string, body.value, (req as any).user.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/notifications',
  requirePlatformPermission('platform.system.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const data = await AdminNotificationService.list(page, pageSize);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// Per-job monitoring (§62)
router.get(
  '/jobs',
  requirePlatformPermission('platform.system.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await AdminNotificationService.jobStatus();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// Admin-safe webhook retry (§58) — re-dispatches the stored payload
router.post(
  '/webhook-events/:id/retry',
  requirePlatformPermission('platform.system.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AdminNotificationService.retryWebhook(req.params.id as string, (req as any).user.id);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── Bulk operations (§70) ────────────────────────────────────────────

router.post(
  '/coupons/bulk-status',
  requirePlatformPermission('platform.coupons.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ ids: z.array(z.string().min(1)).min(1).max(100), active: z.boolean() })
        .parse(req.body);
      const result = await AdminBulkService.bulkCoupons(body.ids, body.active, (req as any).user.id);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/users/bulk-status',
  requirePlatformPermission('platform.users.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ ids: z.array(z.string().min(1)).min(1).max(100), status: z.enum(['active', 'suspended']) })
        .parse(req.body);
      const result = await AdminBulkService.bulkUsers(body.ids, body.status, (req as any).user.id);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── CSV exports (§71) ────────────────────────────────────────────────

router.get(
  '/exports/:entity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entity = req.params.entity as string;
      // Per-entity permission mirrors the underlying list endpoint (§65).
      const permission =
        entity === 'users'
          ? 'platform.users.view'
          : entity === 'workspaces'
            ? 'platform.workspaces.view'
            : entity === 'subscriptions'
              ? 'platform.subscriptions.view'
              : entity === 'coupons'
                ? 'platform.coupons.view'
                : entity === 'payments'
                  ? 'platform.billing.view'
                  : entity === 'audit_logs'
                    ? 'platform.audit.view'
                    : null;
      if (!permission || !['users', 'workspaces', 'subscriptions', 'coupons', 'payments', 'audit_logs'].includes(entity)) {
        res.status(404).json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Unknown export entity' } });
        return;
      }
      // Explicit per-request check (dynamic permission name).
      const { roleHasPermission } = await import('../../shared/platform-rbac.js');
      const role = await (await import('../../middleware/platform-admin.middleware.js')).getPlatformAdminRole((req as any).user.id, (req as any).user.email);
      if (!role || !roleHasPermission(role, permission as any)) {
        res.status(403).json({ success: false, error: { code: 'PLATFORM_PERMISSION_REQUIRED', message: `Platform permission required: ${permission}` } });
        return;
      }

      const { filename, csv } = await AdminExportService.csv(entity as 'users' | 'workspaces' | 'subscriptions' | 'coupons' | 'payments' | 'audit_logs');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/subscriptions',
  requirePlatformPermission('platform.subscriptions.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminSubscriptionService.list({
        page,
        pageSize,
        status: req.query.status as string | undefined,
        plan: req.query.plan as string | undefined,
        search: req.query.search as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/workspaces/:id/subscription',
  requirePlatformPermission('platform.subscriptions.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminSubscriptionService.getById(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/workspaces/:id/subscription/extend-trial',
  requirePlatformPermission('platform.subscriptions.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ days: z.number().int().min(1).max(90), reason: z.string().min(3).max(500) }).parse(req.body);
      const updated = await AdminSubscriptionService.extendTrial(req.params.id as string, body.days, (req as any).user.id, body.reason);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/workspaces/:id/subscription/change-plan',
  requirePlatformPermission('platform.subscriptions.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ planName: z.string().min(1).max(50), reason: z.string().min(3).max(500) }).parse(req.body);
      const updated = await AdminSubscriptionService.changePlan(req.params.id as string, body.planName, (req as any).user.id, body.reason);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/workspaces/:id/subscription/cancel',
  requirePlatformPermission('platform.subscriptions.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
      const updated = await AdminSubscriptionService.cancel(req.params.id as string, (req as any).user.id, body.reason);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/workspaces/:id/subscription/reactivate',
  requirePlatformPermission('platform.subscriptions.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
      const updated = await AdminSubscriptionService.reactivate(req.params.id as string, (req as any).user.id, body.reason);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/workspaces/:id/subscription/overrides',
  requirePlatformPermission('platform.subscriptions.manage') as any,
  requireReAuthentication as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          override_type: z.enum(['trial_extension', 'subscription_extension', 'feature_grant', 'limit_increase']),
          value: z.record(z.unknown()),
          reason: z.string().min(3).max(500),
          expires_at: z.string().datetime(),
        })
        .parse(req.body);
      const created = await AdminSubscriptionService.addOverride(req.params.id as string, (req as any).user.id, body);
      res.json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

// ── Coupons (§32, §52–§55) ─────────────────────────────────────────────

router.get(
  '/coupons',
  requirePlatformPermission('platform.coupons.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminCouponService.list({
        page,
        pageSize,
        status: req.query.status as string | undefined,
        discount_type: req.query.discount_type as string | undefined,
        search: req.query.search as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/coupons/:id',
  requirePlatformPermission('platform.coupons.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminCouponService.getById(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

const createCouponSchema = z.object({
  code: z.string().min(3).max(40),
  description: z.string().max(500).nullable().optional(),
  discount_type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FULL_DISCOUNT', 'PLAN_ACCESS']),
  discount_value: z.number().min(0),
  currency: z.string().length(3).optional(),
  target_plan_name: z.string().max(50).nullable().optional(),
  applicable_plan_names: z.array(z.string().max(50)).max(20).optional(),
  applies_to: z.enum(['new_subscriptions', 'upgrades', 'renewals', 'reactivations', 'any']).optional(),
  duration: z.enum(['ONE_TIME', 'FIRST_PERIOD', 'MULTI_MONTH']).optional(),
  duration_in_months: z.number().int().min(1).max(36).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  max_redemptions_per_user: z.number().int().min(1).nullable().optional(),
  max_redemptions_per_workspace: z.number().int().min(1).nullable().optional(),
});

router.post(
  '/coupons',
  requirePlatformPermission('platform.coupons.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createCouponSchema.parse(req.body);
      const coupon = await AdminCouponService.create(body, (req as any).user.id);
      res.status(201).json({ success: true, data: coupon });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/coupons/:id',
  requirePlatformPermission('platform.coupons.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          description: z.string().max(500).nullable().optional(),
          active: z.boolean().optional(),
          expires_at: z.string().datetime().nullable().optional(),
          max_redemptions: z.number().int().min(1).nullable().optional(),
          max_redemptions_per_user: z.number().int().min(1).nullable().optional()
            .describe('per-user redemption cap'),
          max_redemptions_per_workspace: z.number().int().min(1).nullable().optional(),
        })
        .parse(req.body);
      const coupon = await AdminCouponService.update(req.params.id as string, body, (req as any).user.id);
      res.json({ success: true, data: coupon });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/coupons/generate',
  requirePlatformPermission('platform.coupons.manage') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ prefix: z.string().max(20).default(''), length: z.number().int().min(6).max(24), count: z.number().int().min(1).max(500), charset: z.string().max(64).optional() })
        .parse(req.body);
      const codes = await AdminCouponService.generateCodes(body, (req as any).user.id);
      res.json({ success: true, data: { codes } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/coupons/:id/redemptions',
  requirePlatformPermission('platform.coupons.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminCouponService.getRedemptions(req.params.id as string, page, pageSize);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── Global search + diagnostics (§42, §73) ─────────────────────────────

router.get(
  '/search',
  requirePlatformPermission('platform.workspaces.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = String(req.query.q ?? '').slice(0, 100);
      const results = await globalSearch(term);
      res.json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/workspaces/:id/diagnostics',
  requirePlatformPermission('platform.workspaces.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await getEntitlementDiagnostics(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

// §69 micro-detail drill-ins (webhook event, audit event)
router.get(
  '/webhook-events/:id',
  requirePlatformPermission('platform.system.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminService.getWebhookEventDetail(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/audit-logs/:id',
  requirePlatformPermission('platform.audit.view') as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await AdminService.getAuditEventDetail(req.params.id as string);
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/audit-logs',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await AdminService.getPlatformAuditLogs({
        page,
        pageSize,
        search: req.query.search as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        action: req.query.action as string | undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export const adminRoutes = router;

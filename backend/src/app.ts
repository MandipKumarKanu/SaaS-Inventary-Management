import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { supabaseAdmin } from './config/supabase.js';
import { errorHandler } from './middleware/error-handler.middleware.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { workspaceMiddleware } from './middleware/workspace.middleware.js';

// Route imports
import { authRoutes } from './modules/auth/auth.routes.js';
import { workspaceRoutes } from './modules/workspaces/workspace.routes.js';
import { memberRoutes } from './modules/members/member.routes.js';
import { invitationRoutes, userInvitationRoutes } from './modules/invitations/invitation.routes.js';
import { roleRoutes, permissionsRoutes } from './modules/roles/role.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { categoryRoutes } from './modules/categories/category.routes.js';
import { brandRoutes } from './modules/brands/brand.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { warehouseRoutes } from './modules/warehouses/warehouse.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { transferRoutes } from './modules/transfers/transfer.routes.js';
import { countRoutes } from './modules/inventory_counts/count.routes.js';
import { batchRoutes } from './modules/batches/batch.routes.js';
import { serialRoutes } from './modules/serials/serial.routes.js';
import { supplierRoutes } from './modules/suppliers/supplier.routes.js';
import { customerRoutes } from './modules/customers/customer.routes.js';
import { purchaseRoutes } from './modules/purchases/purchase.routes.js';
import { salesRoutes } from './modules/sales/sales.routes.js';
import { returnRoutes } from './modules/returns/return.routes.js';
import { reorderRoutes } from './modules/reorder/reorder.routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { importRoutes } from './modules/import_export/import.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { apiKeyRoutes } from './modules/api_keys/api_key.routes.js';
import { webhookRoutes, stripeWebhookRouter } from './modules/webhooks/webhook.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { currencyRoutes } from './modules/currencies/currency.routes.js';
import { externalApiRoutes } from './modules/external/external_api.routes.js';
import { integrationRoutes } from './modules/integrations/integration.routes.js';
import { shippingRoutes } from './modules/shipping/shipping.routes.js';
import { monitoringRoutes } from './modules/monitoring/monitoring.routes.js';
import { backupRoutes } from './modules/backup/backup.routes.js';
import { securityRoutes } from './modules/security/security.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { brandingRoutes } from './modules/branding/branding.routes.js';
import { seedingRoutes } from './modules/seeding/seeding.routes.js';
import { aiCopilotRoutes } from './modules/ai_copilot/ai_copilot.routes.js';
import { automationRoutes } from './modules/automation/automation.routes.js';
import { routingRoutes } from './modules/routing/routing.routes.js';
import { metricsMiddleware } from './middleware/metrics.middleware.js';
import { auditContextMiddleware } from './middleware/audit-context.middleware.js';
import { seoHeadersMiddleware } from './middleware/seo-headers.middleware.js';
import { seoRoutes } from './modules/seo/seo.routes.js';
import { BackgroundWorkerService } from './services/worker.service.js';

const app = express();
app.set('etag', 'strong'); // Freshness signals (ETag) help Bing detect content changes


// ============================================
// Global middleware
// ============================================
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

// Capture the RAW body for webhook signature verification (Phase 0).
// Must run BEFORE express.json(), which would otherwise consume the stream.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  },
}));

// Phase 4: request-scoped audit context (IP + user-agent for audit_logs)
app.use(auditContextMiddleware);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later.' } },
});
app.use('/api/', apiLimiter);

// Real request metrics collection (bounded memory, health checks excluded)
app.use(metricsMiddleware as any);

// Bing: API payloads must never be indexed — send X-Robots-Tag: noindex.
app.use(seoHeadersMiddleware);

// Webhook endpoints use their own limiter (attacker-visible, unauthenticated surface)
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many webhook requests.' } },
});

// Auth rate limiting (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many authentication attempts.' } },
});

// ============================================
// Health check & Root routes
// ============================================
const getHealthInfo = async () => {
  let dbStatus = 'disconnected';
  try {
    const { error } = await supabaseAdmin.auth.getSession();
    if (!error) {
      dbStatus = 'connected';
    }
  } catch {
    dbStatus = 'error';
  }

  return {
    status: 'ok',
    db: dbStatus,
    message: 'Inventory Management SaaS API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
};

app.get('/', async (_req, res) => {
  const health = await getHealthInfo();
  res.json(health);
});

app.get('/api/health', async (_req, res) => {
  const health = await getHealthInfo();
  res.json(health);
});

// robots.txt for the API origin: never crawl API (frontend origin serves the
// real robots.txt + sitemap.xml from /public). robots.txt controls crawl, the
// X-Robots-Tag middleware above controls (non-)indexing.
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// ============================================
// API Routes
// ============================================
const api = express.Router();

// Auth routes (public + protected)
api.use('/auth', authLimiter, authRoutes);

// Permissions list (authenticated, not workspace-scoped)
api.use('/permissions', permissionsRoutes);

// User invitations (authenticated, not workspace-scoped)
api.use('/invitations', userInvitationRoutes);

// Workspace routes
api.use('/workspaces', workspaceRoutes);

// Workspace-scoped routes (require auth + workspace context)
function wsRouterUse() {
  const wsRouter = express.Router({ mergeParams: true });
  wsRouter.use(authMiddleware as any);
  wsRouter.use(workspaceMiddleware as any);

  wsRouter.use('/members', memberRoutes);
  wsRouter.use('/invitations', invitationRoutes);
  wsRouter.use('/roles', roleRoutes);
  wsRouter.use('/audit-logs', auditRoutes);
  wsRouter.use('/categories', categoryRoutes);
  wsRouter.use('/brands', brandRoutes);
  wsRouter.use('/products', productRoutes);
  wsRouter.use('/warehouses', warehouseRoutes);
  wsRouter.use('/inventory', inventoryRoutes);
  wsRouter.use('/transfers', transferRoutes);
  wsRouter.use('/counts', countRoutes);
  wsRouter.use('/batches', batchRoutes);
  wsRouter.use('/serials', serialRoutes);
  wsRouter.use('/suppliers', supplierRoutes);
  wsRouter.use('/customers', customerRoutes);
  wsRouter.use('/purchases', purchaseRoutes);
  wsRouter.use('/sales', salesRoutes);
  wsRouter.use('/returns', returnRoutes);
  wsRouter.use('/reorder', reorderRoutes);
  wsRouter.use('/analytics', analyticsRoutes);
  wsRouter.use('/notifications', notificationRoutes);
  wsRouter.use('/import', importRoutes);
  wsRouter.use('/api-keys', apiKeyRoutes);
  wsRouter.use('/webhooks', webhookRoutes);
  wsRouter.use('/billing', billingRoutes);
  wsRouter.use('/currencies', currencyRoutes);
  wsRouter.use('/integrations', integrationRoutes);
  wsRouter.use('/shipping', shippingRoutes);
  wsRouter.use('/backup', backupRoutes);
  wsRouter.use('/security', securityRoutes);
  wsRouter.use('/search', searchRoutes);
  wsRouter.use('/branding', brandingRoutes);
  wsRouter.use('/ai', aiCopilotRoutes);
  wsRouter.use('/automation', automationRoutes);
  wsRouter.use('/routing', routingRoutes);
  wsRouter.use('/', seedingRoutes);

  api.use('/workspaces/:workspaceId', wsRouter);
}

wsRouterUse();

// Public REST API & Webhooks & Admin Routes
api.use('/external', externalApiRoutes);
api.use('/webhooks', webhookLimiter, stripeWebhookRouter);
api.use('/admin', adminRoutes);
api.use('/monitoring', monitoringRoutes);
api.use('/seo', seoRoutes);

// Mount API
app.use('/api/v1', api);
app.use('/v1', api);

// ============================================
// Error handling (must be last)
// ============================================
app.use(errorHandler as any);

// ============================================
// Start server & verify DB
// ============================================
async function verifyDbAndStart() {
  app.listen(env.PORT, async () => {
    logger.info(`🚀 Server running on port ${env.PORT}`);
    logger.info(`   Environment: ${env.NODE_ENV}`);
    logger.info(`   Frontend URL: ${env.FRONTEND_URL}`);

    // Verify DB connection
    try {
      const { error } = await supabaseAdmin.auth.getSession();
      if (!error) {
        console.log('✅ DB connected successfully!');
        logger.info('✅ DB connected successfully!');
      } else {
        console.log('⚠️ DB connected (Auth session check notice:', error.message, ')');
      }

      // Start background worker cron
      BackgroundWorkerService.startWorker();
    } catch (err: any) {
      console.log('❌ DB connection failed:', err.message);
    }
  });
}

verifyDbAndStart();

export default app;

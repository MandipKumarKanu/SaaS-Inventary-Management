import express, { Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middleware/error-handler.middleware';
import { authMiddleware } from '../../src/middleware/auth.middleware';
import { workspaceMiddleware } from '../../src/middleware/workspace.middleware';
import { metricsMiddleware } from '../../src/middleware/metrics.middleware';
import { auditContextMiddleware } from '../../src/middleware/audit-context.middleware';
import { productRoutes } from '../../src/modules/products/product.routes';
import { billingRoutes } from '../../src/modules/billing/billing.routes';
import { analyticsRoutes } from '../../src/modules/analytics/analytics.routes';
import { aiCopilotRoutes } from '../../src/modules/ai_copilot/ai_copilot.routes';
import { transferRoutes } from '../../src/modules/transfers/transfer.routes';
import { countRoutes } from '../../src/modules/inventory_counts/count.routes';
import { batchRoutes } from '../../src/modules/batches/batch.routes';
import { serialRoutes } from '../../src/modules/serials/serial.routes';
import { salesRoutes } from '../../src/modules/sales/sales.routes';
import { warehouseRoutes } from '../../src/modules/warehouses/warehouse.routes';
import { purchaseRoutes } from '../../src/modules/purchases/purchase.routes';
import { goodsReceiptRoutes } from '../../src/modules/goods_receipts/goods_receipt.routes';
import { adminRoutes } from '../../src/modules/admin/admin.routes';
import { monitoringRoutes } from '../../src/modules/monitoring/monitoring.routes';
import { webhookRoutes, stripeWebhookRouter } from '../../src/modules/webhooks/webhook.routes';

/**
 * Builds an express app that uses the REAL middleware chain and route modules,
 * with supabaseAdmin swapped for the in-memory mock (see tests/setup.ts).
 *
 * Mirrors the mounting order of src/app.ts:
 *   rawBody capture -> metrics -> auth -> workspace -> permission -> handler
 */
export function buildTestApp(): Express {
  const app = express();

  // Raw body capture, same as app.ts (webhook signature verification needs it)
  app.use(
    express.json({
      limit: '1mb',
      verify: (_req, _res, buf) => {
        (_req as any).rawBody = buf;
      },
    })
  );
  app.use(metricsMiddleware as any);
  app.use(auditContextMiddleware as any);

  const api = express.Router();

  // Platform-level routes (admin/monitoring: auth + platform admin gate)
  api.use('/admin', adminRoutes);
  api.use('/monitoring', monitoringRoutes);
  api.use('/webhooks', stripeWebhookRouter);

  // Workspace-scoped routes (auth + membership + permissions)
  const wsRouter = express.Router({ mergeParams: true });
  wsRouter.use(authMiddleware as any);
  wsRouter.use(workspaceMiddleware as any);
  wsRouter.use('/products', productRoutes);
  wsRouter.use('/billing', billingRoutes);
  wsRouter.use('/analytics', analyticsRoutes);
  wsRouter.use('/ai', aiCopilotRoutes);
  wsRouter.use('/transfers', transferRoutes);
  wsRouter.use('/warehouses', warehouseRoutes);
  wsRouter.use('/purchases', purchaseRoutes);
  wsRouter.use('/goods-receipts', goodsReceiptRoutes);
  wsRouter.use('/sales', salesRoutes);
  wsRouter.use('/counts', countRoutes);
  wsRouter.use('/batches', batchRoutes);
  wsRouter.use('/serials', serialRoutes);

  api.use('/workspaces/:workspaceId', wsRouter);

  app.use('/api/v1', api);
  app.use(errorHandler as any);

  return app;
}

export { request };

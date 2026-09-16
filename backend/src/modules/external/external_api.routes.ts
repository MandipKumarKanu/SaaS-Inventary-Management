import { Router, Request, Response, NextFunction } from 'express';
import { ExternalApiService } from './external_api.service.js';
import { APIKeyService } from '../api_keys/api_key.service.js';
import { requireFeature } from '../../middleware/feature.middleware.js';
import { z } from 'zod';

const router = Router();

// Middleware to authenticate X-API-Key header
const authenticateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = (req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '')) as string;
    if (!apiKey) {
      res.status(401).json({ success: false, error: { message: 'X-API-Key header required' } });
      return;
    }
    const authData = await APIKeyService.verifyKey(apiKey);
    (req as any).workspaceId = authData.workspaceId;
    next();
  } catch (err: any) {
    res.status(401).json({ success: false, error: { message: err.message || 'Unauthorized API Key' } });
  }
};

const ingestOrderSchema = z.object({
  external_order_id: z.string().min(1),
  customer_name: z.string().min(1),
  customer_email: z.string().email().optional(),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
      unit_price: z.number().nonnegative(),
    })
  ).min(1),
});

// GET /api/v1/external/products — gated on plan `api_access` (PRD §16)
router.get('/products', authenticateApiKey as any, requireFeature('api_access') as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await ExternalApiService.listProducts((req as any).workspaceId, limit, offset);
    res.json({ success: true, data: result.products, pagination: { total: result.total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/external/inventory
router.get('/inventory', authenticateApiKey as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const balances = await ExternalApiService.listInventory((req as any).workspaceId);
    res.json({ success: true, data: balances });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/external/orders
router.post('/orders', authenticateApiKey as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsedPayload = ingestOrderSchema.parse(req.body);
    const result = await ExternalApiService.ingestExternalOrder((req as any).workspaceId, parsedPayload);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export const externalApiRoutes = router;

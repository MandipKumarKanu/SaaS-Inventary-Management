import { Router, Request, Response, NextFunction } from 'express';
import { ShippingService } from './shipping.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const rateQuoteSchema = z.object({
  weightKg: z.number().positive().default(1.0),
  destinationZip: z.string().default('90210'),
});

const generateLabelSchema = z.object({
  salesOrderId: z.string().uuid().optional().nullable(),
  carrier: z.string().min(1),
  serviceLevel: z.string().min(1),
  rateAmount: z.number().nonnegative(),
});

router.post(
  '/quotes',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weightKg, destinationZip } = rateQuoteSchema.parse(req.body);
      const quotes = await ShippingService.getRateQuotes(weightKg, destinationZip);
      res.json({ success: true, data: quotes });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/labels',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await ShippingService.listLabels(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/labels',
  requirePermission(PERMISSIONS.SALES_FULFILL) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { salesOrderId, carrier, serviceLevel, rateAmount } = generateLabelSchema.parse(req.body);
      const label = await ShippingService.generateLabel(
        req.workspace!.id,
        salesOrderId || null,
        carrier,
        serviceLevel,
        rateAmount
      );
      res.status(201).json({ success: true, data: label });
    } catch (err) {
      next(err);
    }
  }
);

export const shippingRoutes = router;

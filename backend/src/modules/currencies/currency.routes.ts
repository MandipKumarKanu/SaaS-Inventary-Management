import { Router, Request, Response, NextFunction } from 'express';
import { CurrencyService } from './currency.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const rateSchema = z.object({
  currencyCode: z.string().min(3).max(5),
  symbol: z.string().min(1).max(5),
  exchangeRate: z.number().positive(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await CurrencyService.list(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currencyCode, symbol, exchangeRate } = rateSchema.parse(req.body);
      const rate = await CurrencyService.addOrUpdateRate(
        req.workspace!.id,
        currencyCode,
        symbol,
        exchangeRate
      );
      res.status(201).json({ success: true, data: rate });
    } catch (err) {
      next(err);
    }
  }
);

export const currencyRoutes = router;

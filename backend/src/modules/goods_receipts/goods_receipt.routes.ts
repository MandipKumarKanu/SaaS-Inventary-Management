import { Router, Request, Response, NextFunction } from 'express';
import { GoodsReceiptService } from './goods_receipt.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

// Phase 8 (PRD §45): standalone printable receipt document.
// (PO-scoped listing lives at GET /purchases/:id/goods-receipts.)

router.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const receipt = await GoodsReceiptService.getById(
        req.params.id as string,
        req.workspace!.id
      );
      res.json({ success: true, data: receipt });
    } catch (err) {
      next(err);
    }
  }
);

export const goodsReceiptRoutes = router;

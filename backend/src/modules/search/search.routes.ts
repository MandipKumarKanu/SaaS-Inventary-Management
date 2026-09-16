import { Router, Request, Response, NextFunction } from 'express';
import { SearchService } from './search.service.js';

const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryTerm = (req.query.q as string) || '';
    // Phase 8: permission-aware — result groups the caller can't read are omitted
    const results = await SearchService.globalSearch(
      req.workspace!.id,
      queryTerm,
      req.membership?.permissions || []
    );
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

export const searchRoutes = router;

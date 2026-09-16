import { Router, Request, Response, NextFunction } from 'express';
import { SearchService } from './search.service.js';

const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryTerm = (req.query.q as string) || '';
    const results = await SearchService.globalSearch(req.workspace!.id, queryTerm);
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

export const searchRoutes = router;

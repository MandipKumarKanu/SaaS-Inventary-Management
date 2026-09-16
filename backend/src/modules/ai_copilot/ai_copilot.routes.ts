import { Router, Request, Response, NextFunction } from 'express';
import { AICopilotService } from './ai_copilot.service.js';
import { requireFeature } from '../../middleware/feature.middleware.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const chatSchema = z.object({
  message: z.string().min(1),
});

// AI assistant is a paid-tier feature (gated on the seeded `forecasting` flag)
router.post('/chat', requireFeature('forecasting') as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = chatSchema.parse(req.body);
    const result = await AICopilotService.chat(req.workspace!.id, message);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export const aiCopilotRoutes = router;

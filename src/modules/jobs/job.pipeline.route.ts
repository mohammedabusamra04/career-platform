import { Router } from 'express';
import { z } from 'zod';
import { jobPipelineService } from '../../config/services.js';
import { requirePipelineAuth } from '../../shared/middleware/auth.middleware.js';
import { validateBody } from '../../shared/middleware/validation.middleware.js';

export const pipelineTriggerBodySchema = z.record(z.unknown()).optional();

const router = Router();

router.post(
  '/run',
  requirePipelineAuth,
  validateBody(pipelineTriggerBodySchema),
  async (_req, res, next) => {
    try {
      const result = await jobPipelineService.run();

      res.success({
        message: 'Job pipeline executed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;


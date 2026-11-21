import { Router } from 'express';
import { z } from 'zod';
import { jobPipelineService } from '../../config/services.js';
import { requirePipelineAuth } from '../../shared/middleware/auth.middleware.js';
import { validateBody } from '../../shared/middleware/validation.middleware.js';
import logger from '../../shared/utils/logger.js';

export const pipelineTriggerBodySchema = z.record(z.unknown()).optional();

const router = Router();

router.post(
  '/run',
  requirePipelineAuth,
  validateBody(pipelineTriggerBodySchema),
  (req, res, next): void => {
    const isAsync = req.query?.async === 'true' || req.headers?.['x-async'] === 'true';

    if (isAsync) {
      res.success({
        message: 'Job pipeline execution started in background',
      });

      void (async () => {
        try {
          await jobPipelineService.run();
        } catch (error: unknown) {
          logger.error(
            `[JobPipelineRoute] Background execution failed: ${(error as Error).message}`,
          );
        }
      })();
      return;
    }

    void (async () => {
      try {
        const result = await jobPipelineService.run();

        res.success({
          message: 'Job pipeline executed successfully',
          data: result,
        });
      } catch (error: unknown) {
        next(error);
      }
    })();
  },
);

export default router;


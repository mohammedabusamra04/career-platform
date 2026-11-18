import { Router } from 'express';
import { z } from 'zod';
import { jobCollectionService } from '../../config/services.js';
import { requirePipelineAuth } from '../../shared/middleware/auth.middleware.js';
import { validateQuery, validateBody } from '../../shared/middleware/validation.middleware.js';

export const collectionTriggerQuerySchema = z.object({
  force: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export const collectionTriggerBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

const router = Router();

/**
 * POST /jobs/collection/run
 * Internal authenticated endpoint to trigger decoupled job collection cycle.
 * Protected by requirePipelineAuth and validated via Zod schemas.
 */
router.post(
  '/run',
  requirePipelineAuth,
  validateQuery(collectionTriggerQuerySchema),
  validateBody(collectionTriggerBodySchema),
  (req, res, next): void => {
    void (async () => {
      try {
        const force = String(req.query.force) === 'true' || req.body?.force === true;
        const result = await jobCollectionService.executeCollectionCycle({ force });

        if (!result.executed) {
          res.status(409).json({
            success: false,
            message: result.skippedReason || 'Collection cycle locked by another runner',
            runId: result.runId,
          });
          return;
        }

        res.success({
          message: 'Job collection cycle executed successfully',
          data: result.stats,
        });
      } catch (error: unknown) {
        next(error);
      }
    })();
  },
);

export default router;

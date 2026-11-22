import { Router } from 'express';
import { z } from 'zod';
import { jobCollectionService } from '../../config/services.js';
import { requirePipelineAuth } from '../../shared/middleware/auth.middleware.js';
import { validateBody } from '../../shared/middleware/validation.middleware.js';

export const ingestJobItemSchema = z.object({
  title: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company name is required'),
  location: z.string().optional(),
  url: z.string().min(1, 'Job URL is required'),
  description: z.string().optional(),
  publishedAt: z.union([z.string(), z.number(), z.date()]).optional(),
});

export const jobIngestPayloadSchema = z.object({
  jobs: z.array(ingestJobItemSchema),
});

export type JobIngestPayload = z.infer<typeof jobIngestPayloadSchema>;
export type IngestJobItem = z.infer<typeof ingestJobItemSchema>;

const router = Router();

/**
 * POST /api/internal/jobs/ingest
 * Ingest external jobs (e.g. from LinkedIn Gmail alerts via Google Apps Script).
 * Protected by requirePipelineAuth (PIPELINE_API_SECRET / API_BEARER_TOKEN).
 */
router.post(
  '/ingest',
  requirePipelineAuth,
  validateBody(jobIngestPayloadSchema),
  (req, res, next): void => {
    void (async () => {
      try {
        const payload = req.body as JobIngestPayload;
        const result = await jobCollectionService.ingestJobs(payload.jobs);

        res.success({
          message: 'Jobs processed and ingested successfully',
          data: result,
        });
      } catch (error: unknown) {
        next(error);
      }
    })();
  },
);

export default router;


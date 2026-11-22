import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { jobCollectionService } from '../../src/config/services.js';
import router, { jobIngestPayloadSchema } from '../../src/modules/jobs/job.ingest.route.js';
import { requirePipelineAuth } from '../../src/shared/middleware/auth.middleware.js';
import { AppError } from '../../src/shared/errors/AppError.js';
import env from '../../src/config/env.js';

vi.mock('../../src/config/services.js', () => ({
  jobCollectionService: {
    ingestJobs: vi.fn(),
  },
}));

describe('Job Ingestion Route: POST /api/internal/jobs/ingest', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: {
    success: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let nextFunction: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = {
      body: {},
      headers: {},
      ip: '127.0.0.1',
      method: 'POST',
      path: '/api/internal/jobs/ingest',
    };
    mockResponse = {
      success: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    nextFunction = vi.fn();
  });

  const getIngestHandler = () => {
    const route = router.stack.find((layer) => layer.route && layer.route.path === '/ingest');
    if (!route || !route.route) {
      throw new Error('Route /ingest not found on router');
    }
    const handlers = route.route.stack;
    return handlers[handlers.length - 1].handle;
  };

  describe('Zod Payload Validation', () => {
    it('rejects payloads missing jobs array', () => {
      const result = jobIngestPayloadSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects job items missing required fields (title, company, url)', () => {
      const missingTitle = jobIngestPayloadSchema.safeParse({
        jobs: [{ company: 'Google', url: 'https://linkedin.com/jobs/view/123' }],
      });
      expect(missingTitle.success).toBe(false);

      const missingCompany = jobIngestPayloadSchema.safeParse({
        jobs: [{ title: 'Backend Engineer', url: 'https://linkedin.com/jobs/view/123' }],
      });
      expect(missingCompany.success).toBe(false);

      const missingUrl = jobIngestPayloadSchema.safeParse({
        jobs: [{ title: 'Backend Engineer', company: 'Google' }],
      });
      expect(missingUrl.success).toBe(false);
    });

    it('accepts valid job payloads with optional location, description, publishedAt', () => {
      const valid = jobIngestPayloadSchema.safeParse({
        jobs: [
          {
            title: 'Senior Node.js Developer',
            company: 'Acme Corp',
            location: 'Remote',
            url: 'https://www.linkedin.com/jobs/view/987654321',
            description: 'Building high throughput systems',
            publishedAt: new Date().toISOString(),
          },
        ],
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.jobs).toHaveLength(1);
        expect(valid.data.jobs[0].title).toBe('Senior Node.js Developer');
      }
    });
  });

  describe('Route Handler Execution', () => {
    it('processes jobs via jobCollectionService and returns formatted success response', async () => {
      const ingestResult = {
        received: 2,
        valid: 2,
        unique: 2,
        inserted: 2,
        updated: 0,
        droppedNonTechnical: 0,
        droppedDuplicates: 0,
      };

      vi.mocked(jobCollectionService.ingestJobs).mockResolvedValueOnce(ingestResult);

      mockRequest.body = {
        jobs: [
          {
            title: 'Backend Engineer',
            company: 'Tech Corp',
            url: 'https://www.linkedin.com/jobs/view/111',
          },
          {
            title: 'Frontend Engineer',
            company: 'Web Studio',
            url: 'https://www.linkedin.com/jobs/view/222',
          },
        ],
      };

      const handler = getIngestHandler();
      await handler(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(jobCollectionService.ingestJobs).toHaveBeenCalledTimes(1);
      expect(jobCollectionService.ingestJobs).toHaveBeenCalledWith(mockRequest.body.jobs);
      expect(mockResponse.success).toHaveBeenCalledWith({
        message: 'Jobs processed and ingested successfully',
        data: ingestResult,
      });
    });

    it('passes errors to next middleware if service throws', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(jobCollectionService.ingestJobs).mockRejectedValueOnce(dbError);

      mockRequest.body = {
        jobs: [
          {
            title: 'Backend Engineer',
            company: 'Tech Corp',
            url: 'https://www.linkedin.com/jobs/view/111',
          },
        ],
      };

      const handler = getIngestHandler();
      await handler(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(dbError);
    });
  });

  describe('Authentication: requirePipelineAuth', () => {
    const originalEnvKey = env.pipelineApiKey;
    const originalProcessSecret = process.env.PIPELINE_API_SECRET;
    const originalBearerToken = process.env.API_BEARER_TOKEN;

    beforeEach(() => {
      // Set test secrets
      env.pipelineApiKey = 'test_secret_pipeline_123';
      delete process.env.API_BEARER_TOKEN;
    });

    afterEach(() => {
      env.pipelineApiKey = originalEnvKey;
      process.env.PIPELINE_API_SECRET = originalProcessSecret;
      process.env.API_BEARER_TOKEN = originalBearerToken;
    });

    it('rejects requests without authorization header or api key', () => {
      mockRequest.headers = {};
      requirePipelineAuth(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Unauthorized'),
        }),
      );
    });

    it('rejects requests with invalid bearer token', () => {
      mockRequest.headers = {
        authorization: 'Bearer wrong_token_xyz',
      };
      requirePipelineAuth(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Unauthorized'),
        }),
      );
    });

    it('accepts requests with valid PIPELINE_API_SECRET via Bearer auth', () => {
      mockRequest.headers = {
        authorization: 'Bearer test_secret_pipeline_123',
      };
      requirePipelineAuth(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });

    it('accepts requests with valid API_BEARER_TOKEN from process.env', () => {
      process.env.API_BEARER_TOKEN = 'custom_apps_script_bearer_token';
      mockRequest.headers = {
        authorization: 'Bearer custom_apps_script_bearer_token',
      };
      requirePipelineAuth(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });

    it('accepts requests with valid key via x-api-key header', () => {
      mockRequest.headers = {
        'x-api-key': 'test_secret_pipeline_123',
      };
      requirePipelineAuth(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });
  });
});

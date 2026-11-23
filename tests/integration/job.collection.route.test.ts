import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { jobCollectionService } from '../../src/config/services.js';
import router from '../../src/modules/jobs/job.collection.route.js';
import app from '../../src/app.js';

vi.mock('../../src/config/services.js', () => ({
  jobCollectionService: {
    executeCollectionCycle: vi.fn(),
    getLastStats: vi.fn(),
  },
  jobSourceManager: {
    getLastFailedSources: vi.fn().mockReturnValue([]),
  },
  jobPipelineService: {
    getLastStats: vi.fn().mockReturnValue(null),
  },
  jobNotificationScheduler: {
    getSchedulerStatus: vi.fn().mockReturnValue({
      isRunning: true,
      nextRun: null,
      lastRun: null,
      notificationTimes: ['09:00', '21:00'],
      timezone: 'UTC',
    }),
  },
  scheduledDigestRunner: {
    getStatus: vi.fn().mockReturnValue({
      isRunning: false,
      lastExecutedSlotKey: null,
    }),
  },
  activeJobSources: [],
  prismaJobRepository: {},
  deduplicationService: {},
  fingerprintService: {},
}));

vi.mock('../../src/shared/middleware/auth.middleware.js', () => ({
  requirePipelineAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

vi.mock('../../src/shared/database/prisma.service.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    getPoolMetrics: vi.fn().mockResolvedValue({ total: 5, active: 1, idle: 4, maxPoolSize: 20 }),
    deliverySlot: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    setHealthSnapshot: vi.fn(),
  },
}));

describe('Job Collection Route & Concurrency Guard (TASK-26.1 & TASK-26.2)', () => {
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
      query: {},
      body: {},
    };
    mockResponse = {
      success: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    nextFunction = vi.fn();
  });

  const getRunHandler = () => {
    const route = router.stack.find((layer) => layer.route && layer.route.path === '/run');
    if (!route || !route.route) {
      throw new Error('Route /run not found on jobCollectionRouter');
    }
    const handlers = route.route.stack;
    return handlers[handlers.length - 1].handle;
  };

  describe('POST /jobs/collection/run', () => {
    it('executes collection cycle and returns HTTP 200 with stats', async () => {
      const stats = {
        runId: 'col_12345',
        durationMs: 250,
        sourcesAttempted: 11,
        sourcesFailed: 0,
        totalFetched: 45,
        newJobsInserted: 40,
        existingJobsUpdated: 5,
        duplicatesDropped: 2,
        timestamp: new Date().toISOString(),
      };

      vi.mocked(jobCollectionService.executeCollectionCycle).mockResolvedValueOnce({
        runId: 'col_12345',
        executed: true,
        stats,
      });

      const handler = getRunHandler();
      await handler(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(jobCollectionService.executeCollectionCycle).toHaveBeenCalledWith({ force: false });
      expect(mockResponse.success).toHaveBeenCalledWith({
        message: 'Job collection cycle executed successfully',
        data: stats,
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('returns HTTP 409 Conflict when concurrent run is locked by another runner (Test Specification: concurrency guard)', async () => {
      vi.mocked(jobCollectionService.executeCollectionCycle).mockResolvedValueOnce({
        runId: 'col_concurrent',
        executed: false,
        skippedReason: 'Advisory lock already held by another runner',
      });

      const handler = getRunHandler();
      await handler(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Advisory lock already held by another runner',
          runId: 'col_concurrent',
        }),
      );
      expect(mockResponse.success).not.toHaveBeenCalled();
    });

    it('passes unhandled error to next middleware', async () => {
      const error = new Error('Database connection failed');
      vi.mocked(jobCollectionService.executeCollectionCycle).mockRejectedValueOnce(error);

      const handler = getRunHandler();
      await handler(mockRequest as Request, mockResponse as unknown as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /health Collection Metrics Visibility (TASK-26.2)', () => {
    it('exposes lastCollectionStats in /health payload', async () => {
      const mockStats = {
        runId: 'col_health_test',
        durationMs: 150,
        sourcesAttempted: 10,
        sourcesFailed: 1,
        totalFetched: 30,
        newJobsInserted: 25,
        existingJobsUpdated: 5,
        duplicatesDropped: 3,
        timestamp: '2026-10-30T12:00:00.000Z',
      };

      vi.mocked(jobCollectionService.getLastStats).mockReturnValue(mockStats);

      const stack = (app as any).router?.stack || (app as any)._router?.stack || [];
      const healthRoute = stack.find(
        (layer: any) => layer.route && layer.route.path === '/health',
      );
      expect(healthRoute).toBeDefined();

      const healthHandler = healthRoute.route.stack[0].handle;

      const healthRes = {
        success: vi.fn(),
      };

      await healthHandler({} as Request, healthRes as unknown as Response, () => {});

      expect(healthRes.success).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastCollectionStats: mockStats,
          }),
        }),
      );
    });
  });
});

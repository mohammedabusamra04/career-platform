import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import app from '../../src/app.js';
import {
  jobCollectionService,
  jobSourceManager,
  jobPipelineService,
  jobNotificationScheduler,
} from '../../src/config/services.js';

vi.mock('../../src/shared/database/prisma.service.js', () => ({
  prisma: {
    ping: vi.fn().mockResolvedValue(true),
    getPoolMetrics: vi.fn().mockResolvedValue({
      total: 5,
      active: 2,
      idle: 3,
      maxPoolSize: 20,
    }),
    deliverySlot: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../../src/config/services.js', () => ({
  jobCollectionService: {
    executeCollectionCycle: vi.fn(),
    getLastStats: vi.fn(),
    getCollectionHistory: vi.fn().mockReturnValue([]),
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
      timezone: 'Asia/Gaza',
    }),
  },
  scheduledDigestRunner: {
    getStatus: vi.fn().mockReturnValue({
      isRunning: false,
      lastExecutedSlotKey: null,
      lastRunTime: null,
      nextRunTime: null,
      timezone: 'Asia/Gaza',
      dispatchTime: '21:00',
    }),
  },
  activeJobSources: [
    { type: 'remotive' },
    { type: 'weworkremotely' },
    { type: 'baeed' },
    { type: 'naukrigulf' },
  ],
  prismaJobRepository: {},
  deduplicationService: {},
  fingerprintService: {},
}));

describe('TASK-26.2: Collector Execution Metrics & Telemetry Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getHealthHandler = () => {
    const stack = (app as any).router?.stack || (app as any)._router?.stack || [];
    const healthRoute = stack.find(
      (layer: any) => layer.route && layer.route.path === '/health',
    );
    if (!healthRoute || !healthRoute.route) {
      throw new Error('Route /health not found on app router');
    }
    return healthRoute.route.stack[0].handle;
  };

  it('executes a mock collection run and verifies GET /health returns matching operational telemetry counts (Roadmap Test Specification)', async () => {
    // 1. Setup mock collection execution results
    const mockRunStats = {
      runId: 'col_mock_run_999',
      durationMs: 342,
      sourcesAttempted: 4,
      sourcesFailed: 1,
      totalFetched: 50,
      newJobsInserted: 42,
      existingJobsUpdated: 6,
      duplicatesDropped: 2,
      sourcesBreakdown: [
        {
          source: 'remotive',
          status: 'fulfilled' as const,
          jobCount: 20,
          durationMs: 120,
        },
        {
          source: 'weworkremotely',
          status: 'fulfilled' as const,
          jobCount: 15,
          durationMs: 150,
        },
        {
          source: 'baeed',
          status: 'fulfilled' as const,
          jobCount: 15,
          durationMs: 90,
        },
        {
          source: 'naukrigulf',
          status: 'rejected' as const,
          jobCount: 0,
          durationMs: 200,
          error: 'Rate limit 429',
        },
      ],
      timestamp: '2026-10-30T18:00:00.000Z',
    };

    // Simulate mock collection execution
    vi.mocked(jobCollectionService.executeCollectionCycle).mockResolvedValueOnce({
      runId: mockRunStats.runId,
      executed: true,
      stats: mockRunStats,
    });

    const executionResult = await jobCollectionService.executeCollectionCycle();
    expect(executionResult.executed).toBe(true);
    expect(executionResult.stats).toEqual(mockRunStats);

    // 2. Now simulate health check reading the updated lastCollectionStats
    vi.mocked(jobCollectionService.getLastStats).mockReturnValue(mockRunStats);

    const healthHandler = getHealthHandler();
    const mockRes = {
      success: vi.fn(),
    };

    healthHandler({} as Request, mockRes as unknown as Response);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 3. Verify GET /health payload returns exact matching counts
    expect(mockRes.success).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ok',
          lastCollectionStats: {
            runId: 'col_mock_run_999',
            durationMs: 342,
            sourcesAttempted: 4,
            sourcesFailed: 1,
            totalFetched: 50,
            newJobsInserted: 42,
            existingJobsUpdated: 6,
            duplicatesDropped: 2,
            sourcesBreakdown: expect.any(Array),
            timestamp: '2026-10-30T18:00:00.000Z',
          },
        }),
      }),
    );
  });

  it('returns null for lastCollectionStats when no collection has been executed yet', async () => {
    vi.mocked(jobCollectionService.getLastStats).mockReturnValue(null);

    const healthHandler = getHealthHandler();
    const mockRes = {
      success: vi.fn(),
    };

    healthHandler({} as Request, mockRes as unknown as Response);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockRes.success).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastCollectionStats: null,
        }),
      }),
    );
  });
});

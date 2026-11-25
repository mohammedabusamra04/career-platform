import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import app, { getHealthTelemetry } from '../../src/app.js';
import { prisma } from '../../src/shared/database/prisma.service.js';
import {
  jobCollectionService,
  jobSourceManager,
  jobPipelineService,
  jobNotificationScheduler,
  scheduledDigestRunner,
} from '../../src/config/services.js';
import redisClient from '../../src/config/redis.js';

vi.mock('../../src/shared/database/prisma.service.js', () => ({
  prisma: {
    ping: vi.fn(),
    getPoolMetrics: vi.fn(),
    getHealthSnapshot: vi.fn().mockReturnValue({
      status: 'connected',
      pool: {
        total: 4,
        active: 1,
        idle: 3,
        maxPoolSize: 20,
      },
    }),
    setHealthSnapshot: vi.fn(),
    deliverySlot: {
      findFirst: vi.fn(),
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
    getSourceHealthMap: vi.fn().mockReturnValue({
      remotive: { status: 'HEALTHY', consecutiveFailures: 0 },
      weworkremotely: { status: 'HEALTHY', consecutiveFailures: 0 },
    }),
    getOverallHealth: vi.fn().mockReturnValue('HEALTHY'),
  },
  jobPipelineService: {
    getLastStats: vi.fn().mockReturnValue({
      lastRunAt: new Date('2026-11-19T12:00:00.000Z'),
      subscribers: 15,
      notifiedWithJobs: 12,
      notifiedNoMatch: 3,
      skippedNoPreferences: 0,
      errors: 0,
    }),
  },
  jobNotificationScheduler: {
    getSchedulerStatus: vi.fn().mockReturnValue({
      isRunning: true,
      nextRun: new Date('2026-11-19T21:00:00.000Z'),
      lastRun: new Date('2026-11-19T09:00:00.000Z'),
      notificationTimes: ['09:00', '21:00'],
      timezone: 'Asia/Gaza',
    }),
  },
  scheduledDigestRunner: {
    getStatus: vi.fn().mockReturnValue({
      isRunning: true,
      lastExecutedSlotKey: 'digest:2026-11-19:2100',
      lastRunTime: new Date('2026-11-19T19:00:00.000Z'),
      nextRunTime: new Date('2026-11-20T19:00:00.000Z'),
      timezone: 'Asia/Gaza',
      dispatchTime: '21:00',
    }),
  },
  activeJobSources: [{ type: 'remotive' }, { type: 'weworkremotely' }],
  prismaJobRepository: {},
  deduplicationService: {},
  fingerprintService: {},
}));

describe('TASK-46.1: Detailed Health Telemetry Endpoint (#130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns complete JSON telemetry object with database connectivity, connection pool stats, and last digest slot (Acceptance Criteria & Test Spec)', async () => {
    // 1. Mock DB ping and live connection pool stats
    vi.mocked(prisma.ping).mockResolvedValueOnce(true);
    vi.mocked(prisma.getPoolMetrics).mockResolvedValueOnce({
      total: 8,
      active: 3,
      idle: 5,
      maxPoolSize: 20,
    });

    // 2. Mock last collection stats
    const mockCollectionStats = {
      runId: 'col_health_123',
      durationMs: 450,
      sourcesAttempted: 5,
      sourcesFailed: 0,
      totalFetched: 60,
      newJobsInserted: 50,
      existingJobsUpdated: 10,
      duplicatesDropped: 0,
      timestamp: '2026-11-19T10:00:00.000Z',
    };
    vi.mocked(jobCollectionService.getLastStats).mockReturnValue(mockCollectionStats);

    // 3. Mock database last delivery slot
    const mockDeliverySlot = {
      slotKey: 'digest:2026-11-19:2100',
      status: 'SENT',
      totalRecipients: 100,
      sentCount: 98,
      failedCount: 2,
      startedAt: new Date('2026-11-19T19:00:00.000Z'),
      completedAt: new Date('2026-11-19T19:00:05.000Z'),
    };
    vi.mocked(prisma.deliverySlot.findFirst).mockResolvedValueOnce(mockDeliverySlot as any);

    // Execute health check telemetry gatherer
    const telemetry = await getHealthTelemetry();

    // Verify all Acceptance Criteria fields
    expect(telemetry.status).toBe('ok');
    expect(telemetry.database).toEqual({
      status: 'connected',
      pool: {
        total: 8,
        active: 3,
        idle: 5,
        maxPoolSize: 20,
      },
    });

    expect(telemetry.lastCollectionStats).toEqual(mockCollectionStats);

    expect(telemetry.lastDigestSlot).toEqual({
      slotKey: 'digest:2026-11-19:2100',
      status: 'SENT',
      totalRecipients: 100,
      sentCount: 98,
      failedCount: 2,
      startedAt: '2026-11-19T19:00:00.000Z',
      completedAt: '2026-11-19T19:00:05.000Z',
    });

    expect(telemetry.scheduler).toBeDefined();
    expect(telemetry.pipeline).toBeDefined();
    expect(telemetry.sourcesSummary).toBeDefined();
  });

  it('marks status as UNHEALTHY when PostgreSQL database connection fails', async () => {
    vi.mocked(prisma.ping).mockResolvedValueOnce(false);
    vi.mocked(prisma.deliverySlot.findFirst).mockResolvedValueOnce(null);

    const telemetry = await getHealthTelemetry();

    expect(telemetry.status).toBe('UNHEALTHY');
    expect(telemetry.database).toMatchObject({
      status: 'disconnected',
    });
  });

  it('reports DEGRADED when database is connected but overall source health is DEGRADED (minority source failure)', async () => {
    vi.mocked(prisma.ping).mockResolvedValueOnce(true);
    vi.mocked(prisma.getPoolMetrics).mockResolvedValueOnce({
      total: 8,
      active: 2,
      idle: 6,
      maxPoolSize: 20,
    });
    vi.mocked(prisma.deliverySlot.findFirst).mockResolvedValueOnce(null);
    vi.mocked(jobSourceManager.getOverallHealth).mockReturnValueOnce('DEGRADED');

    const telemetry = await getHealthTelemetry();

    expect(telemetry.status).toBe('DEGRADED');
    expect(telemetry.database).toMatchObject({
      status: 'connected',
    });
  });

  it('falls back gracefully to scheduled runner status when no slot is recorded in database', async () => {
    vi.mocked(prisma.ping).mockResolvedValueOnce(true);
    vi.mocked(prisma.getPoolMetrics).mockResolvedValueOnce({
      total: 1,
      active: 1,
      idle: 0,
      maxPoolSize: 20,
    });
    vi.mocked(prisma.deliverySlot.findFirst).mockResolvedValueOnce(null);

    const telemetry = await getHealthTelemetry();

    expect(telemetry.lastDigestSlot).toEqual({
      slotKey: 'digest:2026-11-19:2100',
      status: 'COMPLETED',
      lastRunTime: '2026-11-19T19:00:00.000Z',
    });
  });

  it('handles database exceptions safely without throwing or leaving empty catch', async () => {
    vi.mocked(prisma.ping).mockRejectedValueOnce(new Error('PostgreSQL socket error'));
    vi.mocked(prisma.deliverySlot.findFirst).mockRejectedValueOnce(new Error('Query timeout'));
    vi.mocked(scheduledDigestRunner.getStatus).mockReturnValueOnce({
      isRunning: false,
      lastExecutedSlotKey: null,
      lastRunTime: null,
      nextRunTime: null,
      timezone: 'Asia/Gaza',
      dispatchTime: '21:00',
    });

    const telemetry = await getHealthTelemetry();

    expect(telemetry.status).toBe('UNHEALTHY');
    expect(telemetry.database).toMatchObject({
      status: 'disconnected',
    });
    expect(telemetry.lastDigestSlot).toBeNull();
  });

  it('verifies GET /health endpoint handler returns HTTP 200 with formatted data response', async () => {
    vi.mocked(prisma.ping).mockResolvedValueOnce(true);
    vi.mocked(prisma.getPoolMetrics).mockResolvedValueOnce({
      total: 4,
      active: 1,
      idle: 3,
      maxPoolSize: 20,
    });
    vi.mocked(prisma.deliverySlot.findFirst).mockResolvedValueOnce(null);

    const mockReq = {
      method: 'GET',
      url: '/health',
      headers: {},
    } as unknown as Request;

    const mockRes = {
      success: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      getHeader: vi.fn(),
    } as unknown as Response;

    await new Promise<void>((resolve) => {
      app.handle(mockReq, mockRes, () => resolve());
      setTimeout(resolve, 50);
    });

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: true,
        data: expect.objectContaining({
          status: 'ok',
          database: expect.objectContaining({
            status: 'connected',
            pool: expect.objectContaining({
              active: 1,
              idle: 3,
            }),
          }),
        }),
      }),
    );
  });
});

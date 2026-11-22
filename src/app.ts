import express from 'express';
import { errorHandler } from './shared/middleware/error.middleware.js';
import { responseFormatter } from './shared/middleware/response.middleware.js';
import jobPipelineRouter from './modules/jobs/job.pipeline.route.js';
import jobCollectionRouter from './modules/jobs/job.collection.route.js';
import jobIngestRouter from './modules/jobs/job.ingest.route.js';
import env from './config/env.js';
import redisClient from './config/redis.js';
import { prisma } from './shared/database/prisma.service.js';
import logger from './shared/utils/logger.js';
import * as services from './config/services.js';

const app = express();

app.use(express.json());

app.use(responseFormatter);

app.use('/jobs/pipeline', jobPipelineRouter);
app.use('/internal/pipeline', jobPipelineRouter);
app.use('/jobs/collection', jobCollectionRouter);
app.use('/api/internal/jobs', jobIngestRouter);
app.use('/internal/jobs', jobIngestRouter);
app.use('/jobs', jobIngestRouter);

app.get('/', (_req, res) => {
  res.success({
    message: 'AI Career Platform API is running',
  });
});

export function buildHealthTelemetry(overrides?: {
  database?: { status: 'connected' | 'disconnected'; pool: { total: number; active: number; idle: number; maxPoolSize: number } };
  lastDigestSlot?: Record<string, unknown> | null;
  subscribers?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const dbHealth =
    overrides?.database ??
    (typeof prisma.getHealthSnapshot === 'function'
      ? prisma.getHealthSnapshot()
      : {
          status: 'connected',
          pool: {
            total: 1,
            active: 1,
            idle: 0,
            maxPoolSize: env.databasePoolSize,
          },
        });

  // Last Digest Slot Status
  let lastDigestSlot: Record<string, unknown> | null =
    overrides?.lastDigestSlot !== undefined ? overrides.lastDigestSlot : null;

  if (lastDigestSlot === null) {
    try {
      const runner = 'scheduledDigestRunner' in services ? (services as any).scheduledDigestRunner : undefined;
      if (runner && typeof runner.getStatus === 'function') {
        const runnerStatus = runner.getStatus();
        if (runnerStatus && runnerStatus.lastExecutedSlotKey) {
          lastDigestSlot = {
            slotKey: runnerStatus.lastExecutedSlotKey,
            status: 'COMPLETED',
            lastRunTime: runnerStatus.lastRunTime ? runnerStatus.lastRunTime.toISOString() : null,
          };
        }
      }
    } catch (err: unknown) {
      logger.warn(
        `[HealthCheck] Failed to inspect scheduledDigestRunner: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const schedulerStatus =
    typeof services.jobNotificationScheduler?.getSchedulerStatus === 'function'
      ? services.jobNotificationScheduler.getSchedulerStatus()
      : { isRunning: false, nextRun: null, lastRun: null, notificationTimes: [], timezone: env.timezone };

  const lastPipelineStats =
    typeof services.jobPipelineService?.getLastStats === 'function'
      ? services.jobPipelineService.getLastStats()
      : null;

  const lastCollectionStats =
    typeof services.jobCollectionService?.getLastStats === 'function'
      ? services.jobCollectionService.getLastStats()
      : null;

  const failedSources =
    typeof services.jobSourceManager?.getLastFailedSources === 'function'
      ? services.jobSourceManager.getLastFailedSources()
      : [];

  const sourceHealthMap =
    typeof services.jobSourceManager?.getSourceHealthMap === 'function'
      ? services.jobSourceManager.getSourceHealthMap()
      : {};

  const overallSourceHealth =
    typeof services.jobSourceManager?.getOverallHealth === 'function'
      ? services.jobSourceManager.getOverallHealth()
      : 'HEALTHY';

  let status: string = 'ok';
  if (dbHealth.status === 'disconnected' || overallSourceHealth === 'UNHEALTHY') {
    status = 'UNHEALTHY';
  } else if (overallSourceHealth === 'DEGRADED') {
    status = 'DEGRADED';
  }

  return {
    status,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    timezone: env.timezone,
    database: dbHealth,
    redis: redisClient.isOpen ? 'connected' : 'disconnected',
    scheduler: {
      isRunning: schedulerStatus.isRunning,
      nextScheduledRun: schedulerStatus.nextRun ? schedulerStatus.nextRun.toISOString() : null,
      lastRun: schedulerStatus.lastRun ? schedulerStatus.lastRun.toISOString() : null,
      notificationTimes: schedulerStatus.notificationTimes,
      timezone: schedulerStatus.timezone,
    },
    pipeline: lastPipelineStats
      ? {
          lastRunAt: lastPipelineStats.lastRunAt.toISOString(),
          subscribers: lastPipelineStats.subscribers,
          notifiedWithJobs: lastPipelineStats.notifiedWithJobs,
          notifiedNoMatch: lastPipelineStats.notifiedNoMatch,
          skippedNoPreferences: lastPipelineStats.skippedNoPreferences,
          errors: lastPipelineStats.errors,
        }
      : null,
    lastCollectionStats: lastCollectionStats ?? null,
    lastDigestSlot,
    subscribers: overrides?.subscribers ?? null,
    sources: sourceHealthMap,
    sourcesSummary: {
      active: services.activeJobSources ? services.activeJobSources.map((s) => s.type) : [],
      failedLastRun: failedSources,
      totalCount: services.activeJobSources ? services.activeJobSources.length : 0,
    },
  };
}

export async function getHealthTelemetry(): Promise<Record<string, unknown>> {
  let dbStatus: 'connected' | 'disconnected' = 'connected';
  let pool = {
    total: 1,
    active: 1,
    idle: 0,
    maxPoolSize: env.databasePoolSize,
  };

  try {
    if (typeof prisma.ping === 'function') {
      const isDbAlive = await prisma.ping();
      dbStatus = isDbAlive ? 'connected' : 'disconnected';
      pool = {
        total: isDbAlive ? 1 : 0,
        active: isDbAlive ? 1 : 0,
        idle: 0,
        maxPoolSize: env.databasePoolSize,
      };
      if (isDbAlive && typeof prisma.getPoolMetrics === 'function') {
        pool = await prisma.getPoolMetrics();
      }
      if (typeof prisma.setHealthSnapshot === 'function') {
        prisma.setHealthSnapshot({ status: dbStatus, pool });
      }
    }
  } catch (err: unknown) {
    logger.warn(
      `[HealthCheck] Live DB health check probe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    dbStatus = 'disconnected';
    if (typeof prisma.setHealthSnapshot === 'function') {
      prisma.setHealthSnapshot({ status: 'disconnected' });
    }
  }

  // Check delivery slot in database if available
  let lastDigestSlot: Record<string, unknown> | null = null;
  try {
    if (prisma.deliverySlot && typeof prisma.deliverySlot.findFirst === 'function') {
      const latestSlot = await prisma.deliverySlot.findFirst({
        orderBy: { scheduledTime: 'desc' },
        select: {
          slotKey: true,
          status: true,
          totalRecipients: true,
          sentCount: true,
          failedCount: true,
          startedAt: true,
          completedAt: true,
        },
      });
      if (latestSlot) {
        lastDigestSlot = {
          slotKey: latestSlot.slotKey,
          status: latestSlot.status,
          totalRecipients: latestSlot.totalRecipients,
          sentCount: latestSlot.sentCount,
          failedCount: latestSlot.failedCount,
          startedAt: latestSlot.startedAt ? latestSlot.startedAt.toISOString() : null,
          completedAt: latestSlot.completedAt ? latestSlot.completedAt.toISOString() : null,
        };
      }
    }
  } catch (err: unknown) {
    logger.warn(
      `[HealthCheck] Failed retrieving latest delivery slot: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Retrieve subscribers summary with delivery tracking
  let subscribersSummary: Record<string, unknown> | null = null;
  try {
    if (prisma.user && typeof prisma.user.findMany === 'function') {
      const users = await prisma.user.findMany({
        where: { status: { in: ['ACTIVE', 'PAUSED'] } },
        include: {
          preference: true,
          sentJobs: {
            orderBy: { sentAt: 'desc' },
            take: 1,
          },
          digestDeliveries: {
            orderBy: { slot: { scheduledTime: 'desc' } },
            take: 1,
            include: {
              slot: true,
            },
          },
          _count: {
            select: { sentJobs: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      subscribersSummary = {
        total: users.length,
        active: users.filter((u) => u.status === 'ACTIVE').length,
        paused: users.filter((u) => u.status === 'PAUSED').length,
        list: users.map((u) => {
          const latestDelivery = u.digestDeliveries[0];
          let deliveryStatus = 'PENDING';
          if (latestDelivery) {
            deliveryStatus = latestDelivery.status;
          } else if (u._count.sentJobs > 0) {
            deliveryStatus = 'SENT';
          } else {
            deliveryStatus = 'NO_JOBS_YET';
          }

          return {
            telegramId: String(u.telegramId),
            name: u.firstName || u.username || 'User',
            status: u.status,
            specializations: u.preference?.specializations || [],
            experienceLevel: u.preference?.experienceLevel || 'ALL',
            totalSentJobs: u._count.sentJobs,
            lastSentAt: u.sentJobs[0]?.sentAt ? u.sentJobs[0].sentAt.toISOString() : null,
            latestDeliveryStatus: deliveryStatus,
          };
        }),
      };
    }
  } catch (err: unknown) {
    logger.warn(
      `[HealthCheck] Failed retrieving subscribers summary: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return buildHealthTelemetry({
    database: {
      status: dbStatus,
      pool,
    },
    lastDigestSlot,
    subscribers: subscribersSummary,
  });
}

app.get('/health', async (_req, res, next) => {
  try {
    const data = await getHealthTelemetry();
    res.success({ data });
  } catch (err: unknown) {
    next(err);
  }
});

app.use(errorHandler);

export default app;

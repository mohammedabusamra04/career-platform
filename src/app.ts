import express from 'express';
import { errorHandler } from './shared/middleware/error.middleware.js';
import { responseFormatter } from './shared/middleware/response.middleware.js';
import jobPipelineRouter from './modules/jobs/job.pipeline.route.js';
import jobCollectionRouter from './modules/jobs/job.collection.route.js';
import env from './config/env.js';
import redisClient from './config/redis.js';
import {
  activeJobSources,
  jobNotificationScheduler,
  jobPipelineService,
  jobSourceManager,
  jobCollectionService,
} from './config/services.js';

const app = express();

app.use(express.json());

app.use(responseFormatter);

app.use('/jobs/pipeline', jobPipelineRouter);
app.use('/internal/pipeline', jobPipelineRouter);
app.use('/jobs/collection', jobCollectionRouter);

app.get('/', (_req, res) => {
  res.success({
    message: 'AI Career Platform API is running',
  });
});

app.get('/health', (_req, res) => {
  const schedulerStatus = jobNotificationScheduler.getSchedulerStatus();
  const lastPipelineStats = jobPipelineService.getLastStats();
  const lastCollectionStats = jobCollectionService.getLastStats();
  const failedSources = jobSourceManager.getLastFailedSources();
  const sourceHealthMap =
    typeof jobSourceManager.getSourceHealthMap === 'function'
      ? jobSourceManager.getSourceHealthMap()
      : {};
  const overallSourceHealth =
    typeof jobSourceManager.getOverallHealth === 'function'
      ? jobSourceManager.getOverallHealth()
      : 'HEALTHY';

  let status: string = 'ok';
  if (overallSourceHealth === 'UNHEALTHY') {
    status = 'UNHEALTHY';
  } else if (overallSourceHealth === 'DEGRADED') {
    status = 'DEGRADED';
  }

  res.success({
    data: {
      status,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      timezone: env.timezone,
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
      sources: sourceHealthMap,
      sourcesSummary: {
        active: activeJobSources.map((s) => s.type),
        failedLastRun: failedSources,
        totalCount: activeJobSources.length,
      },
    },
  });
});

app.use(errorHandler);

export default app;

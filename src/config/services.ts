import redisClient from './redis.js';

import { RedisAdapter } from '../cache/redis.adapter.js';

import { JobCollectionService } from '../modules/jobs/job.collection.service.js';

import { JobPipelineService } from '../modules/jobs/job.pipeline.service.js';

import env from './env.js';

import {
  JobSourceManager,
  ArbeitnowJobSource,
  AdzunaJobSource,
  JoobleJobSource,
  TanqeebJobSource,
  RemotiveJobSource,
  WeWorkRemotelyJobSource,
  MostaqlJobSource,
  BaytJobSource,
  WuzzufJobSource,
  ForasnaJobSource,
  LinkedinJobSource,
  FirecrawlLinkedInSource,
  BaeedJobSource,
  NaukrigulfJobSource,
} from '../modules/jobs/sources/index.js';
import type { JobSource } from '../modules/jobs/sources/job-source.interface.js';

import { DeduplicationService } from '../modules/deduplication/deduplication.service.js';

import { FingerprintService } from '../modules/deduplication/fingerprint.service.js';

import { GeminiProvider } from '../modules/matching/ai/gemini.provider.js';

import { MatchingService } from '../modules/matching/matching.service.js';

import { JobNotificationScheduler } from '../modules/notifications/job-notification.scheduler.js';

import { NotificationScheduleService } from '../modules/notifications/notification.schedule.js';

import { TelegramNotificationService } from '../modules/notifications/telegram/telegram-notification.service.js';

import { preferenceService } from '../modules/preferences/preference.service.js';

import { subscriptionService } from '../modules/subscriptions/subscription.service.js';

import { bot } from '../bot/bot.js';
import { advisoryLockService } from '../shared/database/advisory-lock.service.js';

export const cache = new RedisAdapter(redisClient);

export const activeJobSources: JobSource[] = [
  new ArbeitnowJobSource(),
  new RemotiveJobSource(),
  new WeWorkRemotelyJobSource(),
  new MostaqlJobSource(),
  new TanqeebJobSource(),
  new BaytJobSource(),
  new WuzzufJobSource(),
  new ForasnaJobSource(),
  new BaeedJobSource(),
  new NaukrigulfJobSource(),
  ...(env.adzunaAppId && env.adzunaAppKey
    ? [new AdzunaJobSource(env.adzunaAppId, env.adzunaAppKey)]
    : []),
  ...(env.joobleApiKey ? [new JoobleJobSource(env.joobleApiKey, { maxAgeDays: 3 })] : []),
  ...(env.rapidApiKey
    ? [new LinkedinJobSource(env.rapidApiKey)]
    : env.firecrawlApiKey
      ? [new FirecrawlLinkedInSource(env.firecrawlApiKey)]
      : []),
];

import { PrismaJobRepository } from '../modules/jobs/repositories/prisma-job.repository.js';

export const jobSourceManager = new JobSourceManager(activeJobSources);

export const fingerprintService = new FingerprintService();

export const deduplicationService = new DeduplicationService(fingerprintService, cache);

export const prismaJobRepository = new PrismaJobRepository();

export const jobCollectionService = new JobCollectionService(
  jobSourceManager,
  prismaJobRepository,
  deduplicationService,
  fingerprintService,
);

const aiProvider = new GeminiProvider();

const matchingService = new MatchingService(
  aiProvider,
  cache,
  fingerprintService,
)

const telegramNotificationService = new TelegramNotificationService(bot.api);

export const jobPipelineService = new JobPipelineService(
  jobCollectionService,
  deduplicationService,
  fingerprintService,
  cache,
  subscriptionService,
  preferenceService,
  matchingService,
  telegramNotificationService,
  advisoryLockService,
);

const notificationScheduleService = new NotificationScheduleService();

export const jobNotificationScheduler = new JobNotificationScheduler(
  jobPipelineService,
  notificationScheduleService,
  subscriptionService,
  preferenceService,
);

import { ScheduledDigestRunner } from '../modules/delivery/scheduled-digest.runner.js';
import { MissedSlotWatchdogService } from '../modules/delivery/missed-slot-watchdog.service.js';

export const scheduledDigestRunner = new ScheduledDigestRunner();
export const missedSlotWatchdogService = new MissedSlotWatchdogService({
  scheduledRunner: scheduledDigestRunner,
});


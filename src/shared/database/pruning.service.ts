import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from './prisma.service.js';
import logger from '../utils/logger.js';

export const RETENTION_POLICIES = {
  SENT_JOBS: ms('60d'),
  CLOSED_JOBS: ms('30d'),
  DELIVERY_SLOTS: ms('30d'),
} as const;

export interface PruningOptions {
  sentJobsRetentionMs?: number;
  closedJobsRetentionMs?: number;
  deliverySlotsRetentionMs?: number;
  now?: Date;
}

export interface PruningResult {
  sentJobsDeleted: number;
  closedJobsDeleted: number;
  deliverySlotsDeleted: number;
  totalDeleted: number;
  durationMs: number;
}

export class PruningService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Prunes SentJob records older than retention threshold (default: ms('60d')).
   */
  public async pruneSentJobs(
    retentionMs: number = RETENTION_POLICIES.SENT_JOBS,
    now: Date = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs);

    const result = await this.db.sentJob.deleteMany({
      where: {
        sentAt: {
          lt: cutoff,
        },
      },
    });

    return result.count;
  }

  /**
   * Prunes CLOSED Job records older than retention threshold (default: ms('30d')).
   * Note: Active and expired jobs are preserved.
   */
  public async pruneClosedJobs(
    retentionMs: number = RETENTION_POLICIES.CLOSED_JOBS,
    now: Date = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs);

    const result = await this.db.job.deleteMany({
      where: {
        status: 'CLOSED',
        lastSeenAt: {
          lt: cutoff,
        },
      },
    });

    return result.count;
  }

  /**
   * Prunes DeliverySlot (and cascading DigestDelivery) records older than retention threshold (default: ms('30d')).
   */
  public async pruneDeliverySlots(
    retentionMs: number = RETENTION_POLICIES.DELIVERY_SLOTS,
    now: Date = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs);

    const result = await this.db.deliverySlot.deleteMany({
      where: {
        scheduledTime: {
          lt: cutoff,
        },
      },
    });

    return result.count;
  }

  /**
   * Runs all automated pruning lifecycle routines and returns aggregated counts.
   */
  public async runAllPruning(options?: PruningOptions): Promise<PruningResult> {
    const startTime = Date.now();
    const now = options?.now ?? new Date();

    const sentRetention = options?.sentJobsRetentionMs ?? RETENTION_POLICIES.SENT_JOBS;
    const closedRetention = options?.closedJobsRetentionMs ?? RETENTION_POLICIES.CLOSED_JOBS;
    const slotRetention = options?.deliverySlotsRetentionMs ?? RETENTION_POLICIES.DELIVERY_SLOTS;

    logger.info(`Starting automated data retention pruning...`);

    const sentJobsDeleted = await this.pruneSentJobs(sentRetention, now);
    const closedJobsDeleted = await this.pruneClosedJobs(closedRetention, now);
    const deliverySlotsDeleted = await this.pruneDeliverySlots(slotRetention, now);

    const totalDeleted = sentJobsDeleted + closedJobsDeleted + deliverySlotsDeleted;
    const durationMs = Date.now() - startTime;

    logger.info(
      `Pruning completed in ${durationMs}ms: ${sentJobsDeleted} sent jobs, ${closedJobsDeleted} closed jobs, ${deliverySlotsDeleted} delivery slots deleted (Total: ${totalDeleted}).`,
    );

    return {
      sentJobsDeleted,
      closedJobsDeleted,
      deliverySlotsDeleted,
      totalDeleted,
      durationMs,
    };
  }
}

export const pruningService = new PruningService();

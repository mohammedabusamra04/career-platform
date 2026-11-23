import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from './prisma.service.js';
import { verifyJobLinkLiveness } from '../../modules/jobs/job.link-verifier.js';
import { negativeExclusionMatcher } from '../../modules/jobs/classifier/negative-exclusion.matcher.js';
import type { Cache } from '../../cache/cache.interface.js';
import logger from '../utils/logger.js';

export const RETENTION_POLICIES = {
  SENT_JOBS: ms('60d'),
  CLOSED_JOBS: ms('30d'),
  DELIVERY_SLOTS: ms('30d'),
  ACTIVE_JOB_MAX_AGE_DAYS: 21,
} as const;

export interface PruningOptions {
  sentJobsRetentionMs?: number;
  closedJobsRetentionMs?: number;
  deliverySlotsRetentionMs?: number;
  activeJobMaxAgeDays?: number;
  now?: Date;
  cache?: Cache | null;
  verifyAggregatorLinks?: boolean;
}

export interface PruningResult {
  sentJobsDeleted: number;
  closedJobsDeleted: number;
  deliverySlotsDeleted: number;
  staleJobsExpired: number;
  deadLinksExpired: number;
  closedNonTechJobs?: number;
  correctedSources?: number;
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
   * Marks stored ACTIVE jobs older than retention threshold (default: 21 days) as EXPIRED.
   */
  public async markStaleActiveJobsAsExpired(
    retentionDays: number = RETENTION_POLICIES.ACTIVE_JOB_MAX_AGE_DAYS,
    now: Date = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - ms(`${retentionDays}d`));

    const result = await this.db.job.updateMany({
      where: {
        status: 'ACTIVE',
        publishedAt: { lt: cutoff },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return result.count;
  }

  /**
   * Cleans invalid active jobs:
   * 1. Closes non-technical jobs matching negative exclusion patterns.
   * 2. Corrects fake LinkedIn source badges when URLs do not point to linkedin.com.
   */
  public async cleanInvalidAndNonTechnicalJobs(): Promise<{
    closedNonTechCount: number;
    correctedSourceCount: number;
  }> {
    const activeJobs = await this.db.job.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, title: true, source: true, url: true },
    });

    let closedNonTechCount = 0;
    let correctedSourceCount = 0;

    for (const job of activeJobs) {
      const exclusion = negativeExclusionMatcher.evaluate(job.title);
      if (exclusion.isExcluded) {
        await this.db.job.update({
          where: { id: job.id },
          data: { status: 'CLOSED' },
        });
        logger.info(
          `[PruningService] Closed non-technical job: "${job.title}" (${exclusion.reason})`,
        );
        closedNonTechCount++;
        continue;
      }

      if (
        job.source.toLowerCase() === 'linkedin' &&
        !job.url.toLowerCase().includes('linkedin.com')
      ) {
        try {
          const parsed = new URL(job.url);
          const domain = parsed.hostname.toLowerCase().replace(/^www\./, '').split('.')[0];
          await this.db.job.update({
            where: { id: job.id },
            data: { source: domain || 'other' },
          });
          logger.info(
            `[PruningService] Corrected fake LinkedIn source for: "${job.title}" -> ${domain} (${job.url})`,
          );
          correctedSourceCount++;
        } catch (parseErr: unknown) {
          logger.debug(
            `[PruningService] Failed to parse URL for domain fix on job ${job.id}: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
          );
        }
      }
    }

    return { closedNonTechCount, correctedSourceCount };
  }

  /**
   * Verifies existing stored aggregator links (adzuna, jooble, linkedin, career, euremotejobs, dailyremote)
   * with verifyJobLinkLiveness, marking dead/expired ones as EXPIRED.
   */
  public async verifyAndExpireDeadAggregatorLinks(
    cache?: Cache | null,
    batchSize: number = 5,
  ): Promise<number> {
    const aggregatorJobs = await this.db.job.findMany({
      where: {
        status: 'ACTIVE',
        source: {
          in: ['adzuna', 'jooble', 'linkedin', 'career', 'euremotejobs', 'dailyremote'],
        },
      },
      select: {
        id: true,
        title: true,
        url: true,
        applicationUrl: true,
        source: true,
      },
    });

    if (aggregatorJobs.length === 0) {
      return 0;
    }

    let expiredCount = 0;

    for (let i = 0; i < aggregatorJobs.length; i += batchSize) {
      const batch = aggregatorJobs.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (job) => {
          const targetUrl = job.applicationUrl || job.url;
          const liveness = await verifyJobLinkLiveness(targetUrl, cache);
          return { job, liveness };
        }),
      );

      for (const { job, liveness } of results) {
        if (!liveness.isAlive) {
          await this.db.job.update({
            where: { id: job.id },
            data: { status: 'EXPIRED' },
          });
          logger.info(
            `[PruningService] Marked dead/expired job as EXPIRED: "${job.title}" (${liveness.reason})`,
          );
          expiredCount++;
        }
      }
    }

    return expiredCount;
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
    const maxAgeDays = options?.activeJobMaxAgeDays ?? RETENTION_POLICIES.ACTIVE_JOB_MAX_AGE_DAYS;

    logger.info(`Starting automated data retention pruning...`);

    const sentJobsDeleted = await this.pruneSentJobs(sentRetention, now);
    const closedJobsDeleted = await this.pruneClosedJobs(closedRetention, now);
    const deliverySlotsDeleted = await this.pruneDeliverySlots(slotRetention, now);
    const staleJobsExpired = await this.markStaleActiveJobsAsExpired(maxAgeDays, now);
    const { closedNonTechCount, correctedSourceCount } =
      await this.cleanInvalidAndNonTechnicalJobs();

    let deadLinksExpired = 0;
    if (options?.verifyAggregatorLinks !== false) {
      deadLinksExpired = await this.verifyAndExpireDeadAggregatorLinks(options?.cache);
    }

    const totalDeleted = sentJobsDeleted + closedJobsDeleted + deliverySlotsDeleted;
    const durationMs = Date.now() - startTime;

    logger.info(
      `Pruning completed in ${durationMs}ms: ${sentJobsDeleted} sent jobs deleted, ${closedJobsDeleted} closed jobs deleted, ${deliverySlotsDeleted} delivery slots deleted, ${staleJobsExpired} stale jobs marked EXPIRED, ${deadLinksExpired} dead links marked EXPIRED, ${closedNonTechCount} non-tech closed, ${correctedSourceCount} sources corrected (Total deleted: ${totalDeleted}).`,
    );

    return {
      sentJobsDeleted,
      closedJobsDeleted,
      deliverySlotsDeleted,
      staleJobsExpired,
      deadLinksExpired,
      closedNonTechJobs: closedNonTechCount,
      correctedSources: correctedSourceCount,
      totalDeleted,
      durationMs,
    };
  }
}

export const pruningService = new PruningService();

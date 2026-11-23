import type { Cache } from '../../cache/cache.interface.js';
import { cacheKeys } from '../../cache/cache.keys.js';
import { CACHE_TTL } from '../../cache/cache.ttl.js';
import env from '../../config/env.js';
import logger from '../../shared/utils/logger.js';
import {
  JOB_PIPELINE_ADVISORY_LOCK_ID,
  type IAdvisoryLockService,
} from '../../shared/database/advisory-lock.service.js';

import type {
  Job,
  JobSearchQuery,
} from './job.types.js';
import { filterLiveJobs } from './job.link-verifier.js';

import type { MatchedJob } from '../matching/matching.service.js';
import { MAX_DIGEST_TOTAL_JOBS } from '../notifications/telegram/digest-card.formatter.js';

import type { UserPreferences } from '../preferences/preference.types.js';

import type { JobAnalysis } from '../matching/matching.types.js';

interface JobCollector {
  collectJobs(
    query: JobSearchQuery,
  ): Promise<Job[]>;
}

interface JobDeduplicator {
  deduplicate(jobs: Job[]): Promise<{
    uniqueJobs: Job[];
    duplicateJobs: Job[];
  }>;
}

interface JobFingerprinter {
  generate(job: Job): string;
}

interface SubscriptionReader {
  getSubscribedUsers(): Promise<number[]>;
  isSubscribed(userId: number): Promise<boolean>;
}

interface PreferenceReader {
  getPreferences(
    userId: number,
  ): Promise<UserPreferences | null>;
}

interface JobMatcher {
  analyzeJobs(
    jobs: Job[],
  ): Promise<Map<string, JobAnalysis>>;

  matchJobs(
    jobs: Job[],
    preferences: UserPreferences,
    analyses: Map<string, JobAnalysis>,
  ): Promise<MatchedJob[]>;
}

interface JobNotifier {
  sendJobs(
    chatId: number,
    matchedJobs: MatchedJob[],
  ): Promise<void>;
}

const MINIMUM_MATCH_SCORE =
  env.minMatchScore;

export interface PipelineRunResult {
  subscribers: number;
  processed: number;
  notifiedWithJobs: number;
  notifiedNoMatch: number;
  skippedNoPreferences: number;
  errors: number;
  totalJobsCollected: number;
  executed?: boolean;
  skippedReason?: string;
}

export interface LastPipelineStats {
  lastRunAt: Date;
  subscribers: number;
  notifiedWithJobs: number;
  notifiedNoMatch: number;
  skippedNoPreferences: number;
  errors: number;
  totalJobsCollected: number;
}

type UserOutcome =
  | 'sent_jobs'
  | 'no_match'
  | 'skipped_no_preferences'
  | 'skipped'
  | 'error';

/**
 * Enforces fair source diversity so that no single source (e.g. Jooble or Adzuna)
 * monopolizes the digest, ensuring balanced representation across all platforms.
 */
export function balanceMatchesBySource(
  matches: MatchedJob[],
  maxTotal: number = MAX_DIGEST_TOTAL_JOBS,
  maxPerSource: number = 4,
): MatchedJob[] {
  const selected: MatchedJob[] = [];
  const sourceCount = new Map<string, number>();
  const remaining: MatchedJob[] = [];

  for (const match of matches) {
    const source = match.job.source || 'other';
    const count = sourceCount.get(source) || 0;
    if (count < maxPerSource && selected.length < maxTotal) {
      selected.push(match);
      sourceCount.set(source, count + 1);
    } else {
      remaining.push(match);
    }
  }

  while (selected.length < maxTotal && remaining.length > 0) {
    selected.push(remaining.shift()!);
  }

  return selected;
}

export class JobPipelineService {
  private lastStats:
    | LastPipelineStats
    | null = null;

  constructor(
    private readonly jobCollectionService: JobCollector,
    private readonly deduplicationService: JobDeduplicator,
    private readonly fingerprintService: JobFingerprinter,
    private readonly cache: Cache,
    private readonly subscriptionService: SubscriptionReader,
    private readonly preferenceService: PreferenceReader,
    private readonly matchingService: JobMatcher,
    private readonly notificationService: JobNotifier,
    private readonly advisoryLock?: IAdvisoryLockService,
  ) {}

  getLastStats(): LastPipelineStats | null {
    return this.lastStats;
  }

  async run(options?: { force?: boolean }): Promise<PipelineRunResult> {
    let acquired = false;
    if (this.advisoryLock) {
      acquired = await this.advisoryLock.tryAcquire(JOB_PIPELINE_ADVISORY_LOCK_ID);
      if (!acquired && !options?.force) {
        logger.warn('Pipeline already running in another process');
        return {
          subscribers: 0,
          processed: 0,
          notifiedWithJobs: 0,
          notifiedNoMatch: 0,
          skippedNoPreferences: 0,
          errors: 0,
          totalJobsCollected: 0,
          executed: false,
          skippedReason: 'Pipeline already running in another process',
        };
      }
    }

    try {
      const subscribers =
        await this.subscriptionService.getSubscribedUsers();

      logger.info(
        `Job pipeline started. Found ${subscribers.length} subscribed users.`,
      );

      const result: PipelineRunResult = {
        subscribers: subscribers.length,
        processed: subscribers.length,
        notifiedWithJobs: 0,
        notifiedNoMatch: 0,
        skippedNoPreferences: 0,
        errors: 0,
        totalJobsCollected: 0,
        executed: true,
      };

    /*
     * ---------------------------------------------------------
     * STEP 1
     * Load preferences and collect jobs for every user.
     * ---------------------------------------------------------
     */

    const userPreferences =
      new Map<number, UserPreferences>();

    const userJobs =
      new Map<number, Job[]>();

    /*
     * All unique jobs across ALL users.
     *
     * Key:
     *   fingerprint
     *
     * Value:
     *   Job
     *
     * Average lookup/insertion:
     *   O(1)
     */
    const uniqueJobsMap =
      new Map<string, Job>();

    for (const userId of subscribers) {
      try {
        const isSubscribed =
          await this.subscriptionService.isSubscribed(
            userId,
          );

        if (!isSubscribed) {
          logger.info(
            `User ${userId} is not subscribed. Skipping.`,
          );

          continue;
        }

        const preferences =
          await this.preferenceService.getPreferences(
            userId,
          );

        if (!preferences) {
          logger.info(
            `User ${userId} has no saved preferences. Skipping.`,
          );

          result.skippedNoPreferences += 1;
          

          continue;
        }

        userPreferences.set(
          userId,
          preferences,
        );

        const jobs =
          await this.jobCollectionService.collectJobs({
            jobTitle: preferences.jobTitle,
            workType: preferences.workType,
            experienceLevel:
              preferences.experienceLevel,
            location: preferences.location,
            skills: preferences.skills,
          });

        result.totalJobsCollected +=
          jobs.length;

        if (jobs.length === 0) {
          userJobs.set(userId, []);

          logger.info(
            `No jobs collected for user ${userId}.`,
          );

          continue;
        }

        /*
         * Deduplicate jobs for this user.
         */
        const { uniqueJobs } =
          await this.deduplicationService.deduplicate(
            jobs,
          );

        /*
         * Verify link liveness for deduplicated candidate jobs (e.g. adzuna, jooble)
         * before caching, matching, and notifying.
         */
        const liveCandidateJobs = await filterLiveJobs(uniqueJobs, this.cache);

        userJobs.set(
          userId,
          liveCandidateJobs,
        );

        /*
         * Add the jobs to the global Map.
         *
         * If another user already collected the same job,
         * Map.set() is avoided.
         */
        for (const job of liveCandidateJobs) {
          const fingerprint =
            this.fingerprintService.generate(job);

          if (!uniqueJobsMap.has(fingerprint)) {
            uniqueJobsMap.set(
              fingerprint,
              job,
            );
          }
        }
      } catch (error) {
        result.errors += 1;
        

        logger.error(
          `Failed to collect jobs for user ${userId}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    /*
     * ---------------------------------------------------------
     * STEP 2
     * Convert the Map into an array.
     *
     * We need an array because:
     * - cacheJobs expects an array
     * - analyzeJobs expects an array
     *
     * At this point every job is globally unique.
     * ---------------------------------------------------------
     */

    const allUniqueJobs =
      Array.from(uniqueJobsMap.values());

    logger.info(
      `Collected ${result.totalJobsCollected} jobs. Found ${allUniqueJobs.length} unique jobs across all users.`,
    );

    /*
     * ---------------------------------------------------------
     * STEP 3
     * Cache jobs.
     * ---------------------------------------------------------
     */

    if (allUniqueJobs.length > 0) {
      await this.cacheJobs(
        allUniqueJobs,
      );
    }

    /*
     * ---------------------------------------------------------
     * STEP 4
     * Analyze each unique job ONLY ONCE.
     *
     * This is the important architectural change.
     *
     * Example:
     *
     * 100 jobs × 3 users
     *
     * Before:
     * 300 possible AI analyses
     *
     * Now:
     * 100 analyses maximum.
     * ---------------------------------------------------------
     */

    let analyses =
      new Map<string, JobAnalysis>();

    if (allUniqueJobs.length > 0) {
      analyses =
        await this.matchingService.analyzeJobs(
          allUniqueJobs,
        );
    }

    logger.info(
      `AI analysis completed. ${analyses.size}/${allUniqueJobs.length} jobs have analysis data.`,
    );

    /*
     * ---------------------------------------------------------
     * STEP 5
     * Process each user using the SAME analysis Map.
     * ---------------------------------------------------------
     */

    for (const userId of subscribers) {
      /*
       * User had no preferences or collection failed.
       */
      const preferences =
        userPreferences.get(userId);

      if (!preferences) {
        /*
         * If we already counted this user as processed
         * because of missing preferences, do not count twice.
         */
        if (!userJobs.has(userId)) {
          continue;
        }

        continue;
      }


      try {
        const jobs =
          userJobs.get(userId) ?? [];

        if (jobs.length === 0) {
          logger.info(
            `No jobs available for user ${userId}. Sending no-match notification.`,
          );

          await this.notificationService.sendJobs(
            userId,
            [],
          );

          result.notifiedNoMatch += 1;

          continue;
        }

        /*
         * Match locally.
         *
         * No Gemini request happens here.
         *
         * We only use the already-created analysis Map.
         */
        const matchedJobs =
          await this.matchingService.matchJobs(
            jobs,
            preferences,
            analyses,
          );

        const qualityMatches =
          matchedJobs.filter(
            (matchedJob) =>
              matchedJob.score >=
              MINIMUM_MATCH_SCORE,
          );

        if (qualityMatches.length === 0) {
          logger.info(
            `No matches met the minimum score (${MINIMUM_MATCH_SCORE}) for user ${userId}. Sending no-match notification.`,
          );

          await this.notificationService.sendJobs(
            userId,
            [],
          );

          result.notifiedNoMatch += 1;

          continue;
        }

        /*
         * -----------------------------------------------------
         * Check which jobs were already sent.
         *
         * We use Promise.all so Redis checks happen in parallel.
         * -----------------------------------------------------
         */

        const sentChecks =
          await Promise.all(
            qualityMatches.map(
              async (match) => {
                const fingerprint =
                  this.fingerprintService.generate(
                    match.job,
                  );

                const sentKey =
                  cacheKeys.userSentJob(
                    userId,
                    fingerprint,
                  );

                const alreadySent =
                  await this.cache.get(
                    sentKey,
                  );

                return {
                  match,
                  fingerprint,
                  alreadySent:
                    alreadySent !== null &&
                    alreadySent !== undefined,
                };
              },
            ),
          );

        /*
         * Set gives O(1) average lookup if we ever
         * need to check these fingerprints again.
         */
        const sentFingerprints =
          new Set<string>();

        for (const item of sentChecks) {
          if (item.alreadySent) {
            sentFingerprints.add(
              item.fingerprint,
            );
          }
        }

        const unsentMatches =
          sentChecks
            .filter(
              (item) =>
                !sentFingerprints.has(
                  item.fingerprint,
                ),
            )
            .map(
              (item) => item.match,
            );

        if (unsentMatches.length === 0) {
          logger.info(
            `All ${qualityMatches.length} matching jobs were already sent to user ${userId} previously.`,
          );

          result.notifiedNoMatch += 1;

          continue;
        }

        const jobsToNotify = balanceMatchesBySource(
          unsentMatches,
          MAX_DIGEST_TOTAL_JOBS,
          4,
        );

        logger.info(
          `Sending ${jobsToNotify.length} of ${unsentMatches.length} new matched jobs to user ${userId}.`,
        );

        await this.notificationService.sendJobs(
          userId,
          jobsToNotify,
        );

        /*
         * Record only notified jobs in Redis so overflow jobs remain available in /jobs.
         */
        await Promise.all(
          jobsToNotify.map(
            async (match) => {
              const fingerprint =
                this.fingerprintService.generate(
                  match.job,
                );

              const sentKey =
                cacheKeys.userSentJob(
                  userId,
                  fingerprint,
                );

              await this.cache.set(
                sentKey,
                {
                  sentAt:
                    new Date().toISOString(),
                  jobTitle:
                    match.job.title,
                  company:
                    match.job.company,
                },
                CACHE_TTL.SENT_JOB,
              );
            },
          ),
        );

        result.notifiedWithJobs += 1;
      } catch (error) {
        result.errors += 1;

        logger.error(
          `Failed to process user ${userId}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    this.lastStats = {
      lastRunAt: new Date(),
      subscribers: result.subscribers,
      notifiedWithJobs:
        result.notifiedWithJobs,
      notifiedNoMatch:
        result.notifiedNoMatch,
      skippedNoPreferences:
        result.skippedNoPreferences,
      errors: result.errors,
      totalJobsCollected:
        result.totalJobsCollected,
    };

    logger.info(
      `Job pipeline finished. subscribers=${result.subscribers}, processed=${result.processed}, notifiedWithJobs=${result.notifiedWithJobs}, notifiedNoMatch=${result.notifiedNoMatch}, skippedNoPrefs=${result.skippedNoPreferences}, errors=${result.errors}, totalJobsCollected=${result.totalJobsCollected}`,
    );

      return result;
    } finally {
      if (acquired && this.advisoryLock) {
        await this.advisoryLock.release(JOB_PIPELINE_ADVISORY_LOCK_ID);
      }
    }
  }

  /*
   * Kept as a public-ish helper because it may still be useful
   * for manual processing/testing.
   */
  async runForUser(
    userId: number,
  ): Promise<UserOutcome> {
    try {
      const isSubscribed =
        await this.subscriptionService.isSubscribed(
          userId,
        );

      if (!isSubscribed) {
        logger.info(
          `User ${userId} is not subscribed. Skipping.`,
        );

        return 'skipped';
      }

      const preferences =
        await this.preferenceService.getPreferences(
          userId,
        );

      if (!preferences) {
        logger.info(
          `User ${userId} has no saved preferences. Skipping.`,
        );

        return 'skipped_no_preferences';
      }

      /*
       * This method is kept for compatibility.
       *
       * The main scheduled pipeline should use run(),
       * because run() performs global job analysis once.
       */

      const jobs =
        await this.jobCollectionService.collectJobs({
          jobTitle: preferences.jobTitle,
          workType: preferences.workType,
          experienceLevel:
            preferences.experienceLevel,
          location: preferences.location,
          skills: preferences.skills,
        });

      if (jobs.length === 0) {
        await this.notificationService.sendJobs(
          userId,
          [],
        );

        return 'no_match';
      }

      const {
        uniqueJobs,
      } =
        await this.deduplicationService.deduplicate(
          jobs,
        );

      if (uniqueJobs.length === 0) {
        await this.notificationService.sendJobs(
          userId,
          [],
        );

        return 'no_match';
      }

      await this.cacheJobs(
        uniqueJobs,
      );

      const analyses =
        await this.matchingService.analyzeJobs(
          uniqueJobs,
        );

      const matchedJobs =
        await this.matchingService.matchJobs(
          uniqueJobs,
          preferences,
          analyses,
        );

      const qualityMatches =
        matchedJobs.filter(
          (matchedJob) =>
            matchedJob.score >=
            MINIMUM_MATCH_SCORE,
        );

      if (qualityMatches.length === 0) {
        await this.notificationService.sendJobs(
          userId,
          [],
        );

        return 'no_match';
      }

      const sentChecks =
        await Promise.all(
          qualityMatches.map(
            async (match) => {
              const fingerprint =
                this.fingerprintService.generate(
                  match.job,
                );

              const sentKey =
                cacheKeys.userSentJob(
                  userId,
                  fingerprint,
                );

              const alreadySent =
                await this.cache.get(
                  sentKey,
                );

              return {
                match,
                fingerprint,
                alreadySent:
                  alreadySent !== null &&
                  alreadySent !== undefined,
              };
            },
          ),
        );

      const unsentMatches =
        sentChecks
          .filter(
            (item) => !item.alreadySent,
          )
          .map(
            (item) => item.match,
          );

      if (unsentMatches.length === 0) {
        return 'no_match';
      }

      const jobsToNotify = unsentMatches.slice(0, MAX_DIGEST_TOTAL_JOBS);

      await this.notificationService.sendJobs(
        userId,
        jobsToNotify,
      );

      await Promise.all(
        jobsToNotify.map(
          async (match) => {
            const fingerprint =
              this.fingerprintService.generate(
                match.job,
              );

            const sentKey =
              cacheKeys.userSentJob(
                userId,
                fingerprint,
              );

            await this.cache.set(
              sentKey,
              {
                sentAt:
                  new Date().toISOString(),
                jobTitle:
                  match.job.title,
                company:
                  match.job.company,
              },
              CACHE_TTL.SENT_JOB,
            );
          },
        ),
      );

      return 'sent_jobs';
    } catch (error) {
      logger.error(
        `Failed to process job pipeline for user ${userId}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );

      return 'error';
    }
  }

  private async cacheJobs(
    jobs: Job[],
  ): Promise<void> {
    await Promise.all(
      jobs.map(
        async (job) => {
          const fingerprint =
            this.fingerprintService.generate(
              job,
            );

          await this.cache.set(
            cacheKeys.job(fingerprint),
            job,
            CACHE_TTL.JOB,
          );
        },
      ),
    );
  }
}
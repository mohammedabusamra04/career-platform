import ms from 'ms';
import type { Job, JobSearchQuery } from './job.types.js';
import { JobSourceManager } from './sources/job-source.manager.js';
import { validateJob } from './job.validator.js';
import { normalizeJob } from './job.normalizer.js';
import type { IJobRepository, NormalizedJobInput } from './repositories/job.repository.interface.js';
import { DeduplicationService } from '../deduplication/deduplication.service.js';
import { FingerprintService } from '../deduplication/fingerprint.service.js';
import {
  DeterministicJobClassifier,
  deterministicJobClassifier,
  type AmbiguityResolver,
} from './classifier/job.classifier.js';
import {
  AdvisoryLockService,
  JOB_COLLECTION_ADVISORY_LOCK_ID,
  type IAdvisoryLockService,
} from '../../shared/database/advisory-lock.service.js';
import logger from '../../shared/utils/logger.js';

export interface SourceExecutionStat {
  source: string;
  status: 'fulfilled' | 'rejected' | 'timeout' | 'circuit_open';
  jobCount: number;
  durationMs: number;
  error?: string;
}

export interface CollectionStats {
  runId: string;
  durationMs: number;
  sourcesAttempted: number;
  sourcesFailed: number;
  totalFetched: number;
  newJobsInserted: number;
  existingJobsUpdated: number;
  duplicatesDropped: number;
  sourcesBreakdown?: SourceExecutionStat[];
  timestamp: string;
}

export interface CollectionCycleResult {
  runId: string;
  executed: boolean;
  skippedReason?: string;
  stats?: CollectionStats;
}

export class JobCollectionService {
  private lastStats: CollectionStats | null = null;
  private readonly history: CollectionStats[] = [];
  private static readonly MAX_HISTORY_SIZE = 10;

  constructor(
    private readonly sourceManager: JobSourceManager,
    private readonly jobRepository?: IJobRepository,
    private readonly deduplicationService?: DeduplicationService,
    private readonly fingerprintService?: FingerprintService,
    private readonly classifier: DeterministicJobClassifier = deterministicJobClassifier,
    private readonly advisoryLock: IAdvisoryLockService = new AdvisoryLockService(),
    private readonly ambiguityResolver?: AmbiguityResolver,
  ) {}

  /**
   * Decoupled Collection Pipeline Engine (TASK-26.1 & TASK-26.2).
   * Sequence: Harvest Sources -> Normalize & Sanitize -> Two-Tier Deduplicate -> Deterministic Classify -> Upsert to Shared Pool.
   * Concurrency is guarded via PostgreSQL advisory lock (pg_try_advisory_lock).
   */
  public async executeCollectionCycle(options?: {
    force?: boolean;
    query?: JobSearchQuery;
  }): Promise<CollectionCycleResult> {
    const startTime = Date.now();
    const runId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Guard against concurrent collection runs using PostgreSQL advisory locks
    const acquired = await this.advisoryLock.tryAcquire(JOB_COLLECTION_ADVISORY_LOCK_ID);
    if (!acquired && !options?.force) {
      logger.warn(
        `[JobCollectionService] Run ${runId} skipped: PostgreSQL advisory lock already held by another runner.`,
      );
      return {
        runId,
        executed: false,
        skippedReason: 'Advisory lock already held by another runner',
      };
    }

    try {
      logger.info(`[JobCollectionService] Starting independent collection cycle (Run: ${runId})`);

      // 2. Harvest Sources
      let rawJobs: Job[] = [];
      let sourcesAttempted = 0;
      let sourcesFailed = 0;
      let sourcesBreakdown: SourceExecutionStat[] = [];

      if (typeof this.sourceManager.fetchJobsDetailed === 'function') {
        const detailed = await this.sourceManager.fetchJobsDetailed(options?.query);
        rawJobs = detailed.jobs;
        sourcesAttempted = detailed.attempted;
        sourcesFailed = detailed.failed;
        sourcesBreakdown = (detailed.telemetry || []).map((t) => ({
          source: t.source,
          status: t.status,
          jobCount: t.jobCount,
          durationMs: t.durationMs,
          error: t.error,
        }));
      } else {
        rawJobs = await this.sourceManager.fetchJobs(options?.query);
        const telemetry = this.sourceManager.getLastTelemetry();
        sourcesAttempted = telemetry.length;
        sourcesFailed = telemetry.filter((t) => t.status !== 'fulfilled').length;
        sourcesBreakdown = telemetry.map((t) => ({
          source: t.source,
          status: t.status,
          jobCount: t.jobCount,
          durationMs: t.durationMs,
          error: t.error,
        }));
      }

      // 3. Normalize & Sanitize
      const normalizedJobs = rawJobs
        .map((raw) => normalizeJob(raw))
        .filter(validateJob)
        .filter((job) => this.isRecentJob(job));

      // 4. Two-Tier Deduplication
      let uniqueJobs = normalizedJobs;
      let duplicatesDropped = 0;

      if (this.deduplicationService) {
        const dedupeResult = await this.deduplicationService.deduplicate(normalizedJobs);
        uniqueJobs = dedupeResult.uniqueJobs;
        duplicatesDropped = dedupeResult.duplicateJobs.length;
      }

      // 5. Deterministic Classify & 6. Upsert to Shared Pool
      let newJobsInserted = 0;
      let existingJobsUpdated = 0;

      const fpService = this.fingerprintService ?? new FingerprintService();

      if (this.jobRepository) {
        for (const job of uniqueJobs) {
          const deduplicationKey = fpService.generate(job);
          const semanticKey = fpService.generateSemanticFingerprint(job);
          const classification = this.ambiguityResolver
            ? await this.classifier.classifyWithFallback(job, this.ambiguityResolver)
            : this.classifier.classify(job);

          // Drop non-technical / excluded postings from shared pool (TASK-30.2)
          if (classification.isExcluded || !classification.primarySpecialization) {
            logger.info(
              `[JobCollectionService] Dropping non-technical job: "${job.title}" (${classification.exclusionReason || 'Non-technical'})`,
            );
            continue;
          }

          const input: NormalizedJobInput = {
            deduplicationKey,
            semanticKey,
            title: job.title,
            company: job.company,
            source: job.source,
            url: job.url,
            applicationUrl: job.applicationUrl || null,
            location: job.location || null,
            country: job.country || null,
            remoteScope: classification.remoteScope,
            primarySpecialization: classification.primarySpecialization,
            secondarySpecialization: classification.secondarySpecialization,
            experienceLevel: classification.experienceLevel,
            workType: classification.workType,
            description: job.description || '',
            skills: job.skills || [],
            salaryMin: job.salaryMin ?? null,
            salaryMax: job.salaryMax ?? null,
            currency: job.currency ?? null,
            publishedAt: job.publishedAt || job.publicationDate || new Date(),
            scrapedAt: job.scrapedAt || new Date(),
            lastSeenAt: new Date(),
            status: 'ACTIVE',
          };

          if (typeof this.jobRepository.upsertJobWithResult === 'function') {
            const res = await this.jobRepository.upsertJobWithResult(input);
            if (res.isNew) {
              newJobsInserted++;
            } else {
              existingJobsUpdated++;
            }
          } else {
            await this.jobRepository.upsertJob(input);
            newJobsInserted++;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const stats: CollectionStats = {
        runId,
        durationMs,
        sourcesAttempted,
        sourcesFailed,
        totalFetched: rawJobs.length,
        newJobsInserted,
        existingJobsUpdated,
        duplicatesDropped,
        sourcesBreakdown,
        timestamp: new Date().toISOString(),
      };

      this.lastStats = stats;
      this.recordHistory(stats);

      // Structured JSON log for operational observability (Loki / Datadog / CloudWatch)
      logger.info(
        `[COLLECTOR_EXECUTION_METRICS] ${JSON.stringify({
          event: 'job_collection_completed',
          runId: stats.runId,
          durationMs: stats.durationMs,
          sourcesAttempted: stats.sourcesAttempted,
          sourcesFailed: stats.sourcesFailed,
          totalFetched: stats.totalFetched,
          newJobsInserted: stats.newJobsInserted,
          existingJobsUpdated: stats.existingJobsUpdated,
          duplicatesDropped: stats.duplicatesDropped,
          timestamp: stats.timestamp,
        })}`,
      );

      return {
        runId,
        executed: true,
        stats,
      };
    } finally {
      if (acquired) {
        await this.advisoryLock.release(JOB_COLLECTION_ADVISORY_LOCK_ID);
      }
    }
  }

  /**
   * Backward-compatible collection query method.
   */
  public async collectJobs(query?: JobSearchQuery): Promise<Job[]> {
    const jobs = await this.sourceManager.fetchJobs(query);
    return jobs.filter(validateJob).filter((job) => this.isRecentJob(job));
  }

  public getLastStats(): CollectionStats | null {
    return this.lastStats;
  }

  public setLastStatsForTesting(stats: CollectionStats | null): void {
    this.lastStats = stats;
  }

  public getCollectionHistory(): CollectionStats[] {
    return [...this.history];
  }

  public clearHistoryForTesting(): void {
    this.history.length = 0;
  }

  private recordHistory(stats: CollectionStats): void {
    this.history.unshift(stats);
    if (this.history.length > JobCollectionService.MAX_HISTORY_SIZE) {
      this.history.pop();
    }
  }

  private isRecentJob(job: Job): boolean {
    if (!job.publicationDate || isNaN(job.publicationDate.getTime())) {
      return true;
    }
    const cutoff = new Date(Date.now() - ms('21d'));
    return job.publicationDate >= cutoff;
  }
}

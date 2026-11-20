import ms from 'ms';
import type { Job, JobSearchQuery } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { JobSourceError } from './job-source.error.js';
import {
  CircuitBreaker,
  CircuitState,
  type CircuitBreakerOptions,
} from './circuit-breaker.js';
import {
  SourceHealthMonitor,
  type SourceHealthStatus,
  type HealthStatusLevel,
} from './source-health-monitor.js';
import logger from '../../../shared/utils/logger.js';

export const DEFAULT_SOURCE_TIMEOUT_MS = ms('10s');

export interface SourceTelemetry {
  source: string;
  status: 'fulfilled' | 'rejected' | 'timeout' | 'circuit_open';
  jobCount: number;
  durationMs: number;
  error?: string;
}

export interface CollectionExecutionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  jobs: Job[];
  telemetry: SourceTelemetry[];
  durationMs: number;
  sourceHealth?: Record<string, SourceHealthStatus>;
}

export class JobSourceManager {
  private lastFailedSources: string[] = [];
  private lastTelemetry: SourceTelemetry[] = [];
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly healthMonitor: SourceHealthMonitor;

  constructor(
    private readonly sources: JobSource[],
    private readonly defaultTimeoutMs: number = DEFAULT_SOURCE_TIMEOUT_MS,
    circuitBreakerOptions?: CircuitBreakerOptions,
    healthMonitor?: SourceHealthMonitor,
  ) {
    this.healthMonitor =
      healthMonitor ?? new SourceHealthMonitor(this.sources.map((s) => s.type));

    for (const source of this.sources) {
      this.circuitBreakers.set(
        source.type,
        new CircuitBreaker(source.type, circuitBreakerOptions),
      );
    }
  }

  getSources(): JobSource[] {
    return [...this.sources];
  }

  getLastFailedSources(): string[] {
    return [...this.lastFailedSources];
  }

  getLastTelemetry(): SourceTelemetry[] {
    return [...this.lastTelemetry];
  }

  getCircuitBreaker(sourceType: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(sourceType);
  }

  getCircuitBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.circuitBreakers);
  }

  getHealthMonitor(): SourceHealthMonitor {
    return this.healthMonitor;
  }

  getSourceHealthMap(): Record<string, SourceHealthStatus> {
    // Sync current breaker states before returning health map
    for (const [source, breaker] of this.circuitBreakers.entries()) {
      this.healthMonitor.syncCircuitBreaker(source, breaker);
    }
    return this.healthMonitor.getAllSourceHealth();
  }

  getOverallHealth(): HealthStatusLevel {
    return this.healthMonitor.getOverallHealth();
  }

  async fetchJobs(
    query?: JobSearchQuery,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<Job[]> {
    this.lastFailedSources = [];
    this.lastTelemetry = [];

    const invocations = this.sources.map(async (source) => {
      const breaker = this.circuitBreakers.get(source.type);

      // 1. Circuit breaker guard: Immediately skip source if breaker is OPEN
      if (breaker && !breaker.canExecute()) {
        const nextAttempt = breaker.getNextAttemptAt();
        const nextTimeStr = nextAttempt ? ` (until ${nextAttempt.toISOString()})` : '';
        logger.warn(
          `[JobSourceManager] Skipping source ${source.type}: Circuit breaker is OPEN${nextTimeStr}`,
        );

        this.lastTelemetry.push({
          source: source.type,
          status: 'circuit_open',
          jobCount: 0,
          durationMs: 0,
          error: `Circuit breaker is OPEN${nextTimeStr}`,
        });

        if (!this.lastFailedSources.includes(source.type)) {
          this.lastFailedSources.push(source.type);
        }

        // Record health status for skipped source
        this.healthMonitor.recordRun(source.type, {
          success: false,
          jobCount: 0,
          error: `Circuit breaker is OPEN${nextTimeStr}`,
          circuitBreakerState: CircuitState.OPEN,
          nextAttemptAt: breaker.getNextAttemptAt(),
        });

        return [];
      }

      const startTime = Date.now();
      let timer: NodeJS.Timeout | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new JobSourceError(
              `[Source: ${source.type}] Request timed out after ${timeoutMs}ms`,
              source.type,
            ),
          );
        }, timeoutMs);
      });

      try {
        const jobs = await Promise.race([source.fetchJobs(query), timeoutPromise]);
        const durationMs = Date.now() - startTime;

        breaker?.recordSuccess();

        // Record health telemetry for successful run
        this.healthMonitor.recordRun(source.type, {
          success: true,
          jobCount: jobs.length,
          circuitBreakerState: CircuitState.CLOSED,
        });

        this.lastTelemetry.push({
          source: source.type,
          status: 'fulfilled',
          jobCount: jobs.length,
          durationMs,
        });

        return jobs;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const isTimeout =
          err instanceof JobSourceError && err.message.includes('timed out');
        const errorMessage = err instanceof Error ? err.message : String(err);

        breaker?.recordFailure(err);

        // Record health telemetry for failed run
        this.healthMonitor.recordRun(source.type, {
          success: false,
          jobCount: 0,
          error: errorMessage,
          circuitBreakerState: breaker?.getState(),
          nextAttemptAt: breaker?.getNextAttemptAt(),
        });

        this.lastTelemetry.push({
          source: source.type,
          status: isTimeout ? 'timeout' : 'rejected',
          jobCount: 0,
          durationMs,
          error: errorMessage,
        });

        throw err;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    });

    const results = await Promise.allSettled(invocations);

    return results.flatMap((result, index) => {
      const source = this.sources[index];

      if (result.status === 'fulfilled') {
        return result.value;
      }

      if (!this.lastFailedSources.includes(source.type)) {
        this.lastFailedSources.push(source.type);
      }

      const errorMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);

      const error =
        result.reason instanceof JobSourceError
          ? result.reason
          : new JobSourceError(
              `[Source: ${source.type}] Request failed: ${errorMessage}`,
              source.type,
              result.reason,
            );

      logger.error(error.message);

      return [];
    });
  }

  async fetchJobsDetailed(
    query?: JobSearchQuery,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<CollectionExecutionSummary> {
    const startTime = Date.now();
    const jobs = await this.fetchJobs(query, timeoutMs);
    const durationMs = Date.now() - startTime;

    return {
      attempted: this.sources.length,
      succeeded: this.sources.length - this.lastFailedSources.length,
      failed: this.lastFailedSources.length,
      jobs,
      telemetry: this.getLastTelemetry(),
      durationMs,
      sourceHealth: this.getSourceHealthMap(),
    };
  }
}

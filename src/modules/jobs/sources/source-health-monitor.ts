import { CircuitState, type CircuitBreaker } from './circuit-breaker.js';

export type HealthStatusLevel = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface SourceHealthStatus {
  source: string;
  status: HealthStatusLevel;
  consecutiveFailures: number;
  consecutiveZeroYieldRuns: number;
  circuitBreakerState: CircuitState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastJobCount: number;
  nextAttemptAt: string | null;
}

export interface RecordRunParams {
  success: boolean;
  jobCount: number;
  error?: string;
  circuitBreakerState?: CircuitState;
  nextAttemptAt?: Date | null;
}

interface SourceInternalState {
  source: string;
  consecutiveFailures: number;
  consecutiveZeroYieldRuns: number;
  circuitBreakerState: CircuitState;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  lastJobCount: number;
  nextAttemptAt: Date | null;
}

/**
 * Automated Health Monitoring & Telemetry for Job Sources (TASK-29.2).
 *
 * Tracks failure streaks, zero-yield runs, and circuit breaker status per source.
 * Categorizes source status into:
 * - HEALTHY: Normal operation, yield > 0, failures = 0, breaker CLOSED.
 * - DEGRADED: 2+ consecutive zero-yield runs, or 1 transient failure, or breaker HALF_OPEN.
 * - UNHEALTHY: 2+ consecutive failures, or breaker OPEN.
 */
export class SourceHealthMonitor {
  private readonly sources = new Map<string, SourceInternalState>();

  constructor(sourceNames: string[] = []) {
    for (const name of sourceNames) {
      this.initSource(name);
    }
  }

  private initSource(source: string): SourceInternalState {
    const existing = this.sources.get(source);
    if (existing) {
      return existing;
    }

    const state: SourceInternalState = {
      source,
      consecutiveFailures: 0,
      consecutiveZeroYieldRuns: 0,
      circuitBreakerState: CircuitState.CLOSED,
      lastRunAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      lastJobCount: 0,
      nextAttemptAt: null,
    };

    this.sources.set(source, state);
    return state;
  }

  /**
   * Records the outcome of a collection run for a specific source.
   */
  public recordRun(source: string, params: RecordRunParams, now: Date = new Date()): void {
    const state = this.initSource(source);

    state.lastRunAt = now;
    state.circuitBreakerState = params.circuitBreakerState ?? state.circuitBreakerState;
    state.nextAttemptAt = params.nextAttemptAt ?? null;

    if (params.success) {
      state.consecutiveFailures = 0;
      state.lastSuccessAt = now;
      state.lastError = null;
      state.lastJobCount = params.jobCount;

      if (params.jobCount === 0) {
        state.consecutiveZeroYieldRuns++;
      } else {
        state.consecutiveZeroYieldRuns = 0;
      }
    } else {
      state.consecutiveFailures++;
      state.lastFailureAt = now;
      state.lastError = params.error || 'Unknown error';
      state.lastJobCount = 0;
    }
  }

  /**
   * Synchronizes the circuit breaker state and failures for a source.
   */
  public syncCircuitBreaker(source: string, breaker: CircuitBreaker): void {
    const state = this.initSource(source);
    state.circuitBreakerState = breaker.getState();
    state.nextAttemptAt = breaker.getNextAttemptAt();

    if (breaker.getLastError()) {
      state.lastError = breaker.getLastError()!;
    }
  }

  /**
   * Computes the health level for a given source internal state.
   */
  public computeHealthLevel(state: SourceInternalState): HealthStatusLevel {
    // 1. UNHEALTHY: 2 or more consecutive failures OR circuit breaker is OPEN
    if (state.consecutiveFailures >= 2 || state.circuitBreakerState === CircuitState.OPEN) {
      return 'UNHEALTHY';
    }

    // 2. DEGRADED: 2 or more consecutive zero-yield runs, or 1 transient failure, or HALF_OPEN trial
    if (
      state.consecutiveZeroYieldRuns >= 2 ||
      state.consecutiveFailures === 1 ||
      state.circuitBreakerState === CircuitState.HALF_OPEN
    ) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }

  /**
   * Returns health status for a single source.
   */
  public getSourceHealth(source: string): SourceHealthStatus {
    const state = this.initSource(source);
    const status = this.computeHealthLevel(state);

    return {
      source: state.source,
      status,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveZeroYieldRuns: state.consecutiveZeroYieldRuns,
      circuitBreakerState: state.circuitBreakerState,
      lastRunAt: state.lastRunAt ? state.lastRunAt.toISOString() : null,
      lastSuccessAt: state.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
      lastFailureAt: state.lastFailureAt ? state.lastFailureAt.toISOString() : null,
      lastError: state.lastError,
      lastJobCount: state.lastJobCount,
      nextAttemptAt: state.nextAttemptAt ? state.nextAttemptAt.toISOString() : null,
    };
  }

  /**
   * Returns health status map for all tracked sources: Record<string, SourceHealthStatus>.
   */
  public getAllSourceHealth(): Record<string, SourceHealthStatus> {
    const result: Record<string, SourceHealthStatus> = {};
    for (const source of this.sources.keys()) {
      result[source] = this.getSourceHealth(source);
    }
    return result;
  }

  /**
   * Computes overall source health across all tracked sources.
   */
  public getOverallHealth(): HealthStatusLevel {
    const all = Object.values(this.getAllSourceHealth());
    if (all.length === 0) {
      return 'HEALTHY';
    }

    if (all.some((s) => s.status === 'UNHEALTHY')) {
      return 'UNHEALTHY';
    }

    if (all.some((s) => s.status === 'DEGRADED')) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }

  /**
   * Resets health state for a specific source or all sources.
   */
  public reset(source?: string): void {
    if (source) {
      this.sources.delete(source);
      this.initSource(source);
    } else {
      const keys = [...this.sources.keys()];
      this.sources.clear();
      for (const key of keys) {
        this.initSource(key);
      }
    }
  }
}

import ms from 'ms';
import logger from '../../../shared/utils/logger.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before tripping to OPEN. Default: 3.
   */
  failureThreshold?: number;

  /**
   * Base cooldown duration in milliseconds before moving from OPEN to HALF_OPEN. Default: 15 minutes.
   */
  cooldownMs?: number;

  /**
   * Base delay in milliseconds for exponential backoff. Default: 1000ms.
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds for exponential backoff. Default: 15 minutes.
   */
  maxDelayMs?: number;

  /**
   * Multiplier factor for exponential backoff. Default: 2.
   */
  backoffFactor?: number;
}

export const DEFAULT_FAILURE_THRESHOLD = 3;
export const DEFAULT_COOLDOWN_MS = ms('15m'); // 15 minutes
export const DEFAULT_BASE_DELAY_MS = ms('1s');
export const DEFAULT_MAX_DELAY_MS = ms('15m');
export const DEFAULT_BACKOFF_FACTOR = 2;

/**
 * Custom error thrown when an execution is attempted on an OPEN circuit breaker.
 */
export class CircuitBreakerOpenError extends Error {
  public readonly source: string;
  public readonly nextAttemptAt: Date | null;

  constructor(source: string, nextAttemptAt: Date | null) {
    const nextTimeStr = nextAttemptAt ? ` (Next attempt after ${nextAttemptAt.toISOString()})` : '';
    super(`[CircuitBreaker: ${source}] Circuit is OPEN. Calls are temporarily blocked${nextTimeStr}.`);
    this.name = 'CircuitBreakerOpenError';
    this.source = source;
    this.nextAttemptAt = nextAttemptAt;
  }
}

/**
 * Parses HTTP `Retry-After` header value (either seconds integer or HTTP-date string).
 * Returns delay in milliseconds, or null if invalid/unspecified.
 */
export function parseRetryAfter(headerValue?: string | null, now: Date = new Date()): number | null {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }

  // Case 1: Numeric seconds (e.g. "120")
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return Math.max(0, seconds * 1000);
  }

  // Case 2: HTTP-date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  const parsedTimestamp = Date.parse(trimmed);
  if (!isNaN(parsedTimestamp)) {
    const diffMs = parsedTimestamp - now.getTime();
    return Math.max(0, diffMs);
  }

  return null;
}

/**
 * Computes exponential backoff with ceiling guarantee.
 */
export function calculateExponentialBackoff(
  consecutiveFailures: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS,
  factor: number = DEFAULT_BACKOFF_FACTOR,
): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }

  const exponential = baseDelayMs * Math.pow(factor, consecutiveFailures - 1);
  return Math.min(exponential, maxDelayMs);
}

/**
 * Checks whether an error is considered a tripping failure (HTTP 5xx, HTTP 429, or network timeout).
 */
export function isTrippingFailure(error: unknown): boolean {
  if (!error) return false;

  const anyErr = error as any;
  const status = typeof anyErr.status === 'number' ? anyErr.status : anyErr.statusCode;

  // HTTP 429 Rate Limit or 5xx Server Error
  if (typeof status === 'number') {
    if (status === 429 || (status >= 500 && status < 600)) {
      return true;
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timed out') || msg.includes('timeout')) return true;
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
    if (
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('internal server error') ||
      msg.includes('bad gateway') ||
      msg.includes('service unavailable') ||
      msg.includes('gateway timeout')
    ) {
      return true;
    }
  }

  return true; // Default to treating unhandled source errors as tripping failures
}

/**
 * Detects if an error is an explicit HTTP 429 Rate Limit error.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;

  const anyErr = error as any;
  const status = typeof anyErr.status === 'number' ? anyErr.status : anyErr.statusCode;
  if (status === 429) return true;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }

  return false;
}

/**
 * Circuit Breaker per source protecting remote endpoints from being flooded during outages.
 *
 * States:
 * - CLOSED: Normal operation. Invocations pass through.
 * - OPEN: Outage detected. Invocations are immediately blocked and skipped.
 * - HALF_OPEN: Cooldown has passed. A single trial invocation is permitted to test recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private currentCooldownMs: number;
  private lastError?: string;
  private halfOpenTrialInProgress = false;

  public readonly failureThreshold: number;
  public readonly defaultCooldownMs: number;
  public readonly baseDelayMs: number;
  public readonly maxDelayMs: number;
  public readonly backoffFactor: number;

  constructor(
    public readonly source: string,
    options?: CircuitBreakerOptions,
  ) {
    this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.defaultCooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.currentCooldownMs = this.defaultCooldownMs;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.backoffFactor = options?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  }

  /**
   * Returns current state, auto-transitioning from OPEN to HALF_OPEN if cooldown has expired.
   */
  public getState(now: number = Date.now()): CircuitState {
    if (this.state === CircuitState.OPEN && this.openedAt !== null) {
      if (now - this.openedAt >= this.currentCooldownMs) {
        this.transitionToHalfOpen();
      }
    }

    return this.state;
  }

  /**
   * Indicates whether a call is permitted to execute.
   */
  public canExecute(now: number = Date.now()): boolean {
    const currentState = this.getState(now);

    if (currentState === CircuitState.CLOSED) {
      return true;
    }

    if (currentState === CircuitState.HALF_OPEN) {
      // In HALF_OPEN, only one trial invocation is allowed simultaneously
      if (!this.halfOpenTrialInProgress) {
        this.halfOpenTrialInProgress = true;
        return true;
      }
      return false;
    }

    return false; // OPEN
  }

  /**
   * Executes an async operation through the circuit breaker.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerOpenError(this.source, this.getNextAttemptAt());
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err: unknown) {
      this.recordFailure(err);
      throw err;
    }
  }

  /**
   * Records a successful operation, resetting the breaker back to CLOSED.
   */
  public recordSuccess(): void {
    if (this.state !== CircuitState.CLOSED) {
      logger.info(
        `[CircuitBreaker: ${this.source}] Trial call succeeded. Recovering from ${this.state} to CLOSED.`,
      );
    }

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.currentCooldownMs = this.defaultCooldownMs;
    this.lastError = undefined;
    this.halfOpenTrialInProgress = false;
  }

  /**
   * Records an operation failure. Trips to OPEN if threshold is reached or if HTTP 429.
   */
  public recordFailure(error?: unknown, now: number = Date.now()): void {
    this.halfOpenTrialInProgress = false;
    this.consecutiveFailures++;

    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    this.lastError = errorMessage;

    // Check for explicit Retry-After in error or cause
    const anyErr = error as any;
    const retryAfterHeader =
      anyErr?.retryAfter ||
      anyErr?.headers?.['retry-after'] ||
      anyErr?.response?.headers?.get?.('retry-after');

    const parsedRetryMs = parseRetryAfter(retryAfterHeader);

    // Rate Limit (HTTP 429) trips breaker immediately
    if (isRateLimitError(error)) {
      const effectiveCooldown = parsedRetryMs
        ? Math.max(parsedRetryMs, this.defaultCooldownMs)
        : this.defaultCooldownMs;

      this.trip(effectiveCooldown, now);
      logger.warn(
        `[CircuitBreaker: ${this.source}] Rate limit (HTTP 429) detected. Tripping to OPEN immediately for ${this.currentCooldownMs}ms.`,
      );
      return;
    }

    // In HALF_OPEN, any failure immediately trips back to OPEN with backoff
    if (this.state === CircuitState.HALF_OPEN) {
      const backoffDelay = calculateExponentialBackoff(
        this.consecutiveFailures,
        this.baseDelayMs,
        this.maxDelayMs,
        this.backoffFactor,
      );

      const effectiveCooldown = Math.max(this.defaultCooldownMs, backoffDelay, parsedRetryMs || 0);
      this.trip(effectiveCooldown, now);
      logger.warn(
        `[CircuitBreaker: ${this.source}] Trial in HALF_OPEN failed. Re-tripping to OPEN for ${this.currentCooldownMs}ms. Reason: ${errorMessage}`,
      );
      return;
    }

    // In CLOSED, trip if consecutive failure threshold is reached
    if (this.consecutiveFailures >= this.failureThreshold) {
      const backoffDelay = calculateExponentialBackoff(
        this.consecutiveFailures,
        this.baseDelayMs,
        this.maxDelayMs,
        this.backoffFactor,
      );

      const effectiveCooldown = Math.max(this.defaultCooldownMs, backoffDelay, parsedRetryMs || 0);
      this.trip(effectiveCooldown, now);
      logger.error(
        `[CircuitBreaker: ${this.source}] Failure threshold (${this.failureThreshold}) reached. Tripping to OPEN for ${this.currentCooldownMs}ms. Last error: ${errorMessage}`,
      );
    }
  }

  /**
   * Forces the breaker into the OPEN state.
   */
  public trip(cooldownMs: number = this.defaultCooldownMs, now: number = Date.now()): void {
    this.state = CircuitState.OPEN;
    this.openedAt = now;
    this.currentCooldownMs = cooldownMs;
    this.halfOpenTrialInProgress = false;
  }

  /**
   * Transitions breaker to HALF_OPEN trial state.
   */
  public transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenTrialInProgress = false;
    logger.info(
      `[CircuitBreaker: ${this.source}] Cooldown expired. Transitioning from OPEN to HALF_OPEN (Trial mode).`,
    );
  }

  /**
   * Resets the breaker completely to CLOSED state.
   */
  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.currentCooldownMs = this.defaultCooldownMs;
    this.lastError = undefined;
    this.halfOpenTrialInProgress = false;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  public getLastError(): string | undefined {
    return this.lastError;
  }

  public getOpenedAt(): Date | null {
    return this.openedAt ? new Date(this.openedAt) : null;
  }

  public getNextAttemptAt(): Date | null {
    if (this.state === CircuitState.OPEN && this.openedAt !== null) {
      return new Date(this.openedAt + this.currentCooldownMs);
    }
    return null;
  }

  public getCurrentCooldownMs(): number {
    return this.currentCooldownMs;
  }
}

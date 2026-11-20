import { describe, it, expect, vi, beforeEach } from 'vitest';
import ms from 'ms';
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  parseRetryAfter,
  calculateExponentialBackoff,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_COOLDOWN_MS,
} from '../../src/modules/jobs/sources/circuit-breaker.js';
import {
  JobSourceManager,
} from '../../src/modules/jobs/sources/job-source.manager.js';
import type { JobSource } from '../../src/modules/jobs/sources/job-source.interface.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('TASK-29.1: Circuit Breaker & Exponential Backoff for Source Outages (#89)', () => {
  const dummyJob: Job = {
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
    source: JobSourceType.REMOTIVE,
    applicationUrl: 'https://example.com/job1',
    url: 'https://example.com/job1',
    skills: ['Node.js'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  describe('CircuitBreaker State Machine & Transitions', () => {
    it('initializes in CLOSED state with 0 failures', () => {
      const breaker = new CircuitBreaker('test-source');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getConsecutiveFailures()).toBe(0);
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getOpenedAt()).toBeNull();
      expect(breaker.getNextAttemptAt()).toBeNull();
    });

    it('remains in CLOSED state when failures are below threshold', () => {
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 3 });

      breaker.recordFailure(new Error('Network glitch 1'));
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getConsecutiveFailures()).toBe(1);
      expect(breaker.canExecute()).toBe(true);

      breaker.recordFailure(new Error('Network glitch 2'));
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getConsecutiveFailures()).toBe(2);
      expect(breaker.canExecute()).toBe(true);
    });

    it('resets consecutive failures to 0 upon successful execution in CLOSED state', () => {
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 3 });

      breaker.recordFailure(new Error('Transient failure'));
      expect(breaker.getConsecutiveFailures()).toBe(1);

      breaker.recordSuccess();
      expect(breaker.getConsecutiveFailures()).toBe(0);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('trips to OPEN state when reaching failure threshold (3 consecutive failures)', () => {
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 3 });

      breaker.recordFailure(new Error('HTTP 503: Service Unavailable'));
      breaker.recordFailure(new Error('HTTP 503: Service Unavailable'));
      breaker.recordFailure(new Error('HTTP 503: Service Unavailable'));

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.getConsecutiveFailures()).toBe(3);
      expect(breaker.canExecute()).toBe(false);
      expect(breaker.getOpenedAt()).not.toBeNull();
      expect(breaker.getNextAttemptAt()).not.toBeNull();
    });

    it('throws CircuitBreakerOpenError when calling execute() on OPEN circuit', async () => {
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 1 });
      breaker.recordFailure(new Error('HTTP 500'));

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('transitions from OPEN to HALF_OPEN after cooldown expires', () => {
      const cooldownMs = 1000;
      const startTime = 10000;
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 1, cooldownMs });

      breaker.recordFailure(new Error('Crash'), startTime);
      expect(breaker.getState(startTime + 500)).toBe(CircuitState.OPEN);
      expect(breaker.canExecute(startTime + 500)).toBe(false);

      // After cooldown expires
      expect(breaker.getState(startTime + 1001)).toBe(CircuitState.HALF_OPEN);
      expect(breaker.canExecute(startTime + 1001)).toBe(true);
    });

    it('recovers from HALF_OPEN to CLOSED when trial execution succeeds', () => {
      const cooldownMs = 1000;
      const startTime = 10000;
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 1, cooldownMs });

      breaker.recordFailure(new Error('Crash'), startTime);
      expect(breaker.getState(startTime + 1001)).toBe(CircuitState.HALF_OPEN);

      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getConsecutiveFailures()).toBe(0);
      expect(breaker.canExecute()).toBe(true);
    });

    it('trips immediately from HALF_OPEN back to OPEN when trial execution fails', () => {
      const cooldownMs = 1000;
      const startTime = 10000;
      const breaker = new CircuitBreaker('test-source', { failureThreshold: 1, cooldownMs });

      breaker.recordFailure(new Error('Crash'), startTime);
      expect(breaker.getState(startTime + 1001)).toBe(CircuitState.HALF_OPEN);

      breaker.recordFailure(new Error('Still down'), startTime + 1002);
      expect(breaker.getState(startTime + 1002)).toBe(CircuitState.OPEN);
      expect(breaker.canExecute(startTime + 1002)).toBe(false);
    });
  });

  describe('HTTP 429 Rate Limiting & Retry-After Parser', () => {
    it('trips immediately to OPEN upon encountering HTTP 429 rate limit error', () => {
      const breaker = new CircuitBreaker('rate-limited-source', { failureThreshold: 5 });

      breaker.recordFailure(new Error('HTTP 429: Too Many Requests'));
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });

    it('parses numeric seconds from Retry-After header', () => {
      expect(parseRetryAfter('120')).toBe(120 * 1000);
      expect(parseRetryAfter('60')).toBe(60 * 1000);
      expect(parseRetryAfter('0')).toBe(0);
      expect(parseRetryAfter(null)).toBeNull();
      expect(parseRetryAfter('')).toBeNull();
      expect(parseRetryAfter('invalid')).toBeNull();
    });

    it('parses HTTP-date formatted Retry-After header relative to current time', () => {
      const now = new Date('2026-10-25T12:00:00.000Z');
      const targetHeader = 'Sun, 25 Oct 2026 12:05:00 GMT'; // 5 minutes later
      const delayMs = parseRetryAfter(targetHeader, now);

      expect(delayMs).toBe(5 * 60 * 1000);
    });

    it('honors Retry-After duration when tripping on HTTP 429', () => {
      const breaker = new CircuitBreaker('custom-retry-source', { cooldownMs: 10000 });
      const now = 20000;

      const rateLimitError = Object.assign(new Error('Rate limited (429)'), {
        retryAfter: '120', // 120 seconds = 120,000ms
      });

      breaker.recordFailure(rateLimitError, now);
      expect(breaker.getState(now)).toBe(CircuitState.OPEN);
      expect(breaker.getCurrentCooldownMs()).toBe(120000);
      expect(breaker.getNextAttemptAt()).toEqual(new Date(now + 120000));
    });
  });

  describe('Exponential Backoff Calculation', () => {
    it('calculates exponential backoff correctly with ceiling cap', () => {
      const base = 1000;
      const max = 16000;
      const factor = 2;

      expect(calculateExponentialBackoff(0, base, max, factor)).toBe(0);
      expect(calculateExponentialBackoff(1, base, max, factor)).toBe(1000); // 1000 * 2^0
      expect(calculateExponentialBackoff(2, base, max, factor)).toBe(2000); // 1000 * 2^1
      expect(calculateExponentialBackoff(3, base, max, factor)).toBe(4000); // 1000 * 2^2
      expect(calculateExponentialBackoff(4, base, max, factor)).toBe(8000); // 1000 * 2^3
      expect(calculateExponentialBackoff(5, base, max, factor)).toBe(16000); // 1000 * 2^4
      expect(calculateExponentialBackoff(6, base, max, factor)).toBe(16000); // capped at max
    });
  });

  describe('Integration with JobSourceManager (Acceptance Criteria & Test Specifications)', () => {
    it('simulates 3 consecutive 503 errors on Source X and verifies 4th call is skipped immediately without making HTTP calls', async () => {
      const mockFetchJobs = vi.fn().mockRejectedValue(new Error('HTTP 503: Service Unavailable'));

      const failingSource: JobSource = {
        type: JobSourceType.JOOBLE,
        fetchJobs: mockFetchJobs,
      };

      const manager = new JobSourceManager([failingSource], 1000, {
        failureThreshold: 3,
        cooldownMs: 60000,
      });

      // 1st run: fails
      await manager.fetchJobs();
      expect(mockFetchJobs).toHaveBeenCalledTimes(1);
      expect(manager.getCircuitBreaker(JobSourceType.JOOBLE)?.getState()).toBe(CircuitState.CLOSED);

      // 2nd run: fails
      await manager.fetchJobs();
      expect(mockFetchJobs).toHaveBeenCalledTimes(2);
      expect(manager.getCircuitBreaker(JobSourceType.JOOBLE)?.getState()).toBe(CircuitState.CLOSED);

      // 3rd run: fails and trips breaker to OPEN
      await manager.fetchJobs();
      expect(mockFetchJobs).toHaveBeenCalledTimes(3);
      expect(manager.getCircuitBreaker(JobSourceType.JOOBLE)?.getState()).toBe(CircuitState.OPEN);

      // 4th run: skipped immediately without calling fetchJobs!
      const startTime = Date.now();
      const jobs = await manager.fetchJobs();
      const elapsed = Date.now() - startTime;

      expect(jobs).toEqual([]);
      // Crucial verification: fetchJobs was NOT called on 4th run! Still 3!
      expect(mockFetchJobs).toHaveBeenCalledTimes(3);
      expect(elapsed).toBeLessThan(50); // Immediate 0ms skip guarantee

      const telemetry = manager.getLastTelemetry();
      const joobleTelemetry = telemetry.find((t) => t.source === JobSourceType.JOOBLE);
      expect(joobleTelemetry).toBeDefined();
      expect(joobleTelemetry?.status).toBe('circuit_open');
      expect(joobleTelemetry?.jobCount).toBe(0);
      expect(joobleTelemetry?.durationMs).toBe(0);
      expect(joobleTelemetry?.error).toContain('Circuit breaker is OPEN');
    });

    it('isolates broken source so healthy sources continue collecting even when one source breaker is OPEN', async () => {
      const healthyFetch = vi.fn().mockResolvedValue([dummyJob]);
      const healthySource: JobSource = {
        type: JobSourceType.REMOTIVE,
        fetchJobs: healthyFetch,
      };

      const failingFetch = vi.fn().mockRejectedValue(new Error('HTTP 500: Server Error'));
      const brokenSource: JobSource = {
        type: JobSourceType.TANQEEB,
        fetchJobs: failingFetch,
      };

      const manager = new JobSourceManager([healthySource, brokenSource], 1000, {
        failureThreshold: 2,
      });

      // Trip brokenSource
      await manager.fetchJobs();
      await manager.fetchJobs();
      expect(manager.getCircuitBreaker(JobSourceType.TANQEEB)?.getState()).toBe(CircuitState.OPEN);

      // Next run: healthySource succeeds, brokenSource is skipped
      const jobs = await manager.fetchJobs();
      expect(jobs).toEqual([dummyJob]);
      expect(healthyFetch).toHaveBeenCalledTimes(3);
      expect(failingFetch).toHaveBeenCalledTimes(2); // Skipped on 3rd run!
    });
  });
});

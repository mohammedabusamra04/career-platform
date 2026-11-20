import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import app from '../../src/app.js';
import {
  SourceHealthMonitor,
} from '../../src/modules/jobs/sources/source-health-monitor.js';
import { CircuitState, CircuitBreaker } from '../../src/modules/jobs/sources/circuit-breaker.js';
import { JobSourceManager } from '../../src/modules/jobs/sources/job-source.manager.js';
import type { JobSource } from '../../src/modules/jobs/sources/job-source.interface.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';
import { jobSourceManager } from '../../src/config/services.js';

describe('TASK-29.2: Consecutive Failure Detection & Source Health Telemetry (#90)', () => {
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

  const getHealthHandler = () => {
    const stack = (app as any).router?.stack || (app as any)._router?.stack || [];
    const healthRoute = stack.find(
      (layer: any) => layer.route && layer.route.path === '/health',
    );
    if (!healthRoute || !healthRoute.route) {
      throw new Error('Route /health not found on app router');
    }
    return healthRoute.route.stack[0].handle;
  };

  describe('SourceHealthMonitor Unit Tests', () => {
    let monitor: SourceHealthMonitor;

    beforeEach(() => {
      monitor = new SourceHealthMonitor(['remotive', 'jooble', 'tanqeeb']);
    });

    it('initializes sources as HEALTHY with 0 failures and 0 zero-yield runs', () => {
      const health = monitor.getSourceHealth('remotive');
      expect(health.status).toBe('HEALTHY');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.consecutiveZeroYieldRuns).toBe(0);
      expect(health.circuitBreakerState).toBe(CircuitState.CLOSED);
      expect(health.lastError).toBeNull();
    });

    it('remains HEALTHY when source yields jobs successfully', () => {
      monitor.recordRun('remotive', { success: true, jobCount: 15 });
      const health = monitor.getSourceHealth('remotive');

      expect(health.status).toBe('HEALTHY');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.consecutiveZeroYieldRuns).toBe(0);
      expect(health.lastJobCount).toBe(15);
      expect(health.lastSuccessAt).not.toBeNull();
    });

    it('marks source as DEGRADED upon single transient failure', () => {
      monitor.recordRun('jooble', {
        success: false,
        jobCount: 0,
        error: 'Network timeout',
      });

      const health = monitor.getSourceHealth('jooble');
      expect(health.status).toBe('DEGRADED');
      expect(health.consecutiveFailures).toBe(1);
      expect(health.lastError).toBe('Network timeout');
    });

    it('marks source as UNHEALTHY when consecutive failures >= 2 (Acceptance Criteria)', () => {
      // 1st failure -> DEGRADED
      monitor.recordRun('jooble', { success: false, jobCount: 0, error: 'HTTP 500' });
      expect(monitor.getSourceHealth('jooble').status).toBe('DEGRADED');

      // 2nd consecutive failure -> UNHEALTHY
      monitor.recordRun('jooble', { success: false, jobCount: 0, error: 'HTTP 500' });
      const health = monitor.getSourceHealth('jooble');

      expect(health.status).toBe('UNHEALTHY');
      expect(health.consecutiveFailures).toBe(2);
      expect(health.lastError).toBe('HTTP 500');
    });

    it('marks source as DEGRADED after 2 consecutive zero-yield runs (Acceptance Criteria)', () => {
      // 1st run: 0 jobs
      monitor.recordRun('tanqeeb', { success: true, jobCount: 0 });
      expect(monitor.getSourceHealth('tanqeeb').status).toBe('HEALTHY');
      expect(monitor.getSourceHealth('tanqeeb').consecutiveZeroYieldRuns).toBe(1);

      // 2nd run: 0 jobs
      monitor.recordRun('tanqeeb', { success: true, jobCount: 0 });
      const health = monitor.getSourceHealth('tanqeeb');

      expect(health.status).toBe('DEGRADED');
      expect(health.consecutiveZeroYieldRuns).toBe(2);
    });

    it('marks source as UNHEALTHY immediately when circuit breaker is OPEN', () => {
      const breaker = new CircuitBreaker('adzuna');
      breaker.trip();

      monitor.syncCircuitBreaker('adzuna', breaker);
      const health = monitor.getSourceHealth('adzuna');

      expect(health.status).toBe('UNHEALTHY');
      expect(health.circuitBreakerState).toBe(CircuitState.OPEN);
    });

    it('marks source as DEGRADED when circuit breaker is in HALF_OPEN trial mode', () => {
      const breaker = new CircuitBreaker('adzuna');
      breaker.transitionToHalfOpen();

      monitor.syncCircuitBreaker('adzuna', breaker);
      const health = monitor.getSourceHealth('adzuna');

      expect(health.status).toBe('DEGRADED');
      expect(health.circuitBreakerState).toBe(CircuitState.HALF_OPEN);
    });

    it('recovers to HEALTHY and resets failure and zero-yield counts after successful job run', () => {
      // Make unhealthy
      monitor.recordRun('remotive', { success: false, jobCount: 0, error: 'Crash 1' });
      monitor.recordRun('remotive', { success: false, jobCount: 0, error: 'Crash 2' });
      expect(monitor.getSourceHealth('remotive').status).toBe('UNHEALTHY');

      // Successful collection
      monitor.recordRun('remotive', { success: true, jobCount: 5 });
      const health = monitor.getSourceHealth('remotive');

      expect(health.status).toBe('HEALTHY');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.consecutiveZeroYieldRuns).toBe(0);
      expect(health.lastJobCount).toBe(5);
      expect(health.lastError).toBeNull();
    });

    it('returns Record<string, SourceHealthStatus> from getAllSourceHealth()', () => {
      const allHealth = monitor.getAllSourceHealth();
      expect(allHealth).toHaveProperty('remotive');
      expect(allHealth).toHaveProperty('jooble');
      expect(allHealth).toHaveProperty('tanqeeb');
      expect(allHealth.remotive.status).toBe('HEALTHY');
    });

    it('calculates overall health level accurately across all sources', () => {
      expect(monitor.getOverallHealth()).toBe('HEALTHY');

      // 1 source degraded -> overall DEGRADED
      monitor.recordRun('remotive', { success: false, jobCount: 0, error: 'glitch' });
      expect(monitor.getOverallHealth()).toBe('DEGRADED');

      // 1 source unhealthy -> overall UNHEALTHY
      monitor.recordRun('jooble', { success: false, jobCount: 0, error: 'down 1' });
      monitor.recordRun('jooble', { success: false, jobCount: 0, error: 'down 2' });
      expect(monitor.getOverallHealth()).toBe('UNHEALTHY');
    });
  });

  describe('JobSourceManager Integration with Health Monitor', () => {
    it('automatically records health status during collection runs', async () => {
      const workingSource: JobSource = {
        type: JobSourceType.REMOTIVE,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob]),
      };

      const emptySource: JobSource = {
        type: JobSourceType.ARBEITNOW,
        fetchJobs: vi.fn().mockResolvedValue([]),
      };

      const failingSource: JobSource = {
        type: JobSourceType.JOOBLE,
        fetchJobs: vi.fn().mockRejectedValue(new Error('HTTP 500: Server Error')),
      };

      const manager = new JobSourceManager([workingSource, emptySource, failingSource]);

      // Run 1
      await manager.fetchJobs();
      let healthMap = manager.getSourceHealthMap();
      expect(healthMap[JobSourceType.REMOTIVE].status).toBe('HEALTHY');
      expect(healthMap[JobSourceType.ARBEITNOW].consecutiveZeroYieldRuns).toBe(1);
      expect(healthMap[JobSourceType.JOOBLE].status).toBe('DEGRADED');

      // Run 2
      await manager.fetchJobs();
      healthMap = manager.getSourceHealthMap();
      expect(healthMap[JobSourceType.REMOTIVE].status).toBe('HEALTHY');
      // 2 consecutive zero yields -> DEGRADED
      expect(healthMap[JobSourceType.ARBEITNOW].status).toBe('DEGRADED');
      expect(healthMap[JobSourceType.ARBEITNOW].consecutiveZeroYieldRuns).toBe(2);
      // 2 consecutive failures -> UNHEALTHY
      expect(healthMap[JobSourceType.JOOBLE].status).toBe('UNHEALTHY');
      expect(healthMap[JobSourceType.JOOBLE].consecutiveFailures).toBe(2);

      expect(manager.getOverallHealth()).toBe('UNHEALTHY');
    });
  });

  describe('GET /health Telemetry & Degradation Reporting (Roadmap Test Specifications)', () => {
    beforeEach(() => {
      jobSourceManager.getHealthMonitor().reset();
    });

    it('reports status: ok and all sources HEALTHY when system operates normally', () => {
      const healthHandler = getHealthHandler();
      const mockRes = {
        success: vi.fn(),
      };

      healthHandler({} as Request, mockRes as unknown as Response);

      expect(mockRes.success).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ok',
            sources: expect.objectContaining({
              remotive: expect.objectContaining({
                status: 'HEALTHY',
                consecutiveFailures: 0,
              }),
            }),
          }),
        }),
      );
    });

    it('reports status: DEGRADED on GET /health when a source has 2 consecutive zero-yield runs', () => {
      const monitor = jobSourceManager.getHealthMonitor();
      monitor.recordRun(JobSourceType.BAEED, { success: true, jobCount: 0 });
      monitor.recordRun(JobSourceType.BAEED, { success: true, jobCount: 0 });

      const healthHandler = getHealthHandler();
      const mockRes = {
        success: vi.fn(),
      };

      healthHandler({} as Request, mockRes as unknown as Response);

      expect(mockRes.success).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DEGRADED',
            sources: expect.objectContaining({
              baeed: expect.objectContaining({
                status: 'DEGRADED',
                consecutiveZeroYieldRuns: 2,
              }),
            }),
          }),
        }),
      );
    });

    it('reports status: UNHEALTHY on GET /health when a source experiences >= 2 consecutive failures', () => {
      const monitor = jobSourceManager.getHealthMonitor();
      monitor.recordRun(JobSourceType.TANQEEB, { success: false, jobCount: 0, error: 'HTTP 500' });
      monitor.recordRun(JobSourceType.TANQEEB, { success: false, jobCount: 0, error: 'HTTP 500' });

      const healthHandler = getHealthHandler();
      const mockRes = {
        success: vi.fn(),
      };

      healthHandler({} as Request, mockRes as unknown as Response);

      expect(mockRes.success).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'UNHEALTHY',
            sources: expect.objectContaining({
              tanqeeb: expect.objectContaining({
                status: 'UNHEALTHY',
                consecutiveFailures: 2,
                lastError: 'HTTP 500',
              }),
            }),
          }),
        }),
      );
    });
  });
});

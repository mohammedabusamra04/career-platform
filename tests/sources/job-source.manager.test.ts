import { describe, it, expect, vi, beforeEach } from 'vitest';
import ms from 'ms';
import {
  JobSourceManager,
  DEFAULT_SOURCE_TIMEOUT_MS,
} from '../../src/modules/jobs/sources/job-source.manager.js';
import type { JobSource } from '../../src/modules/jobs/sources/job-source.interface.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('JobSourceManager - Standardized Job Source Contract & Error Isolation (TASK-25.1)', () => {
  const dummyJob1: Job = {
    title: 'Senior Backend Engineer',
    company: 'Tech Corp',
    source: JobSourceType.REMOTIVE,
    applicationUrl: 'https://example.com/job1',
    url: 'https://example.com/job1',
    skills: ['Node.js', 'PostgreSQL'],
    publicationDate: new Date('2026-10-25T10:00:00Z'),
    scrapedAt: new Date(),
  };

  const dummyJob2: Job = {
    title: 'Frontend Developer',
    company: 'UI Studios',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com/job2',
    url: 'https://example.com/job2',
    skills: ['React', 'TypeScript'],
    publicationDate: new Date('2026-10-26T12:00:00Z'),
    scrapedAt: new Date(),
  };

  const dummyJob3: Job = {
    title: 'DevOps Engineer',
    company: 'Cloud Ops',
    source: JobSourceType.WE_WORK_REMOTELY,
    applicationUrl: 'https://example.com/job3',
    url: 'https://example.com/job3',
    skills: ['Kubernetes', 'AWS'],
    publicationDate: new Date('2026-10-27T14:00:00Z'),
    scrapedAt: new Date(),
  };

  it('defines default source timeout of 10s using ms', () => {
    expect(DEFAULT_SOURCE_TIMEOUT_MS).toBe(ms('10s'));
  });

  describe('3-Source Error Isolation (Promise.allSettled)', () => {
    it('isolates HTTP 500 failure from Source 2 while safely collecting from Source 1 and Source 3', async () => {
      const source1: JobSource = {
        type: JobSourceType.REMOTIVE,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob1]),
      };

      const source2: JobSource = {
        type: JobSourceType.JOOBLE,
        fetchJobs: vi.fn().mockRejectedValue(new Error('HTTP 500: Internal Server Error')),
      };

      const source3: JobSource = {
        type: JobSourceType.WE_WORK_REMOTELY,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob3]),
      };

      const manager = new JobSourceManager([source1, source2, source3]);
      const jobs = await manager.fetchJobs();

      expect(jobs).toHaveLength(2);
      expect(jobs).toEqual([dummyJob1, dummyJob3]);
      expect(manager.getLastFailedSources()).toEqual([JobSourceType.JOOBLE]);

      const telemetry = manager.getLastTelemetry();
      expect(telemetry).toHaveLength(3);

      const source2Telemetry = telemetry.find((t) => t.source === JobSourceType.JOOBLE);
      expect(source2Telemetry).toBeDefined();
      expect(source2Telemetry?.status).toBe('rejected');
      expect(source2Telemetry?.error).toContain('HTTP 500: Internal Server Error');
      expect(source2Telemetry?.jobCount).toBe(0);

      const source1Telemetry = telemetry.find((t) => t.source === JobSourceType.REMOTIVE);
      expect(source1Telemetry?.status).toBe('fulfilled');
      expect(source1Telemetry?.jobCount).toBe(1);
    });
  });

  describe('Global Fetch without Query (Zero-Subscriber Collection)', () => {
    it('executes global collection when no query parameter is provided', async () => {
      const mockSource: JobSource = {
        type: JobSourceType.ARBEITNOW,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob2]),
      };

      const manager = new JobSourceManager([mockSource]);
      const jobs = await manager.fetchJobs();

      expect(jobs).toEqual([dummyJob2]);
      expect(mockSource.fetchJobs).toHaveBeenCalledWith(undefined);
    });

    it('passes search query when query parameter is provided for backward compatibility', async () => {
      const mockSource: JobSource = {
        type: JobSourceType.ARBEITNOW,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob2]),
      };

      const query = { jobTitle: 'Frontend' };
      const manager = new JobSourceManager([mockSource]);
      const jobs = await manager.fetchJobs(query);

      expect(jobs).toEqual([dummyJob2]);
      expect(mockSource.fetchJobs).toHaveBeenCalledWith(query);
    });
  });

  describe('Timeout Handling (10s Abort Guarantee)', () => {
    it('times out hanging source and isolates failure without blocking other sources', async () => {
      const fastSource: JobSource = {
        type: JobSourceType.REMOTIVE,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob1]),
      };

      const hangingSource: JobSource = {
        type: JobSourceType.ADZUNA,
        fetchJobs: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([dummyJob2]), 200)),
        ),
      };

      // Set timeout to 50ms for test execution speed
      const manager = new JobSourceManager([fastSource, hangingSource], 50);
      const jobs = await manager.fetchJobs();

      expect(jobs).toEqual([dummyJob1]);
      expect(manager.getLastFailedSources()).toEqual([JobSourceType.ADZUNA]);

      const adzunaTelemetry = manager.getLastTelemetry().find((t) => t.source === JobSourceType.ADZUNA);
      expect(adzunaTelemetry?.status).toBe('timeout');
      expect(adzunaTelemetry?.error).toContain('Request timed out after 50ms');
    });
  });

  describe('Detailed Collection Execution Summary', () => {
    it('returns structured execution summary including telemetry and aggregated counts', async () => {
      const workingSource: JobSource = {
        type: JobSourceType.REMOTIVE,
        fetchJobs: vi.fn().mockResolvedValue([dummyJob1]),
      };

      const failingSource: JobSource = {
        type: JobSourceType.TANQEEB,
        fetchJobs: vi.fn().mockRejectedValue(new Error('Connection reset by peer')),
      };

      const manager = new JobSourceManager([workingSource, failingSource]);
      const summary = await manager.fetchJobsDetailed();

      expect(summary.attempted).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.jobs).toHaveLength(1);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.telemetry).toHaveLength(2);
    });
  });
});

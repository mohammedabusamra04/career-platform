import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobCollectionService } from '../../src/modules/jobs/job.collection.service.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';
import { Specialization } from '@prisma/client';
import { DeterministicJobClassifier } from '../../src/modules/jobs/classifier/job.classifier.js';

describe('JobCollectionService - Decoupled Collection Pipeline Engine (TASK-26.1 & TASK-26.2)', () => {
  let mockSourceManager: any;
  let mockJobRepository: any;
  let mockDeduplicationService: any;
  let mockFingerprintService: any;
  let mockClassifier: any;
  let mockAdvisoryLock: any;
  let service: JobCollectionService;

  const sampleJob: Job = {
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com/job/1',
    url: 'https://example.com/job/1',
    skills: ['Node.js', 'PostgreSQL'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  beforeEach(() => {
    mockSourceManager = {
      fetchJobs: vi.fn().mockResolvedValue([sampleJob]),
      fetchJobsDetailed: vi.fn().mockResolvedValue({
        attempted: 3,
        succeeded: 2,
        failed: 1,
        jobs: [sampleJob],
        telemetry: [],
        durationMs: 120,
      }),
      getLastTelemetry: vi.fn().mockReturnValue([]),
    };

    mockJobRepository = {
      upsertJob: vi.fn().mockResolvedValue({ id: 'uuid-1', ...sampleJob }),
      upsertJobWithResult: vi.fn().mockResolvedValue({
        job: { id: 'uuid-1', ...sampleJob },
        isNew: true,
      }),
    };

    mockDeduplicationService = {
      deduplicate: vi.fn().mockResolvedValue({
        uniqueJobs: [sampleJob],
        duplicateJobs: [],
      }),
    };

    mockFingerprintService = {
      generate: vi.fn().mockReturnValue('l1-hash-123'),
      generateSemanticFingerprint: vi.fn().mockReturnValue('l2-hash-123'),
    };

    mockClassifier = {
      classify: vi.fn().mockReturnValue({
        primarySpecialization: Specialization.BACKEND,
        secondarySpecialization: null,
        remoteScope: 'WORLDWIDE',
        experienceLevel: 'SENIOR',
        workType: 'FULL_TIME',
        isExcluded: false,
      }),
    };

    mockAdvisoryLock = {
      tryAcquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      withLock: vi.fn(),
    };

    service = new JobCollectionService(
      mockSourceManager,
      mockJobRepository,
      mockDeduplicationService,
      mockFingerprintService,
      mockClassifier,
      mockAdvisoryLock,
    );
  });

  describe('executeCollectionCycle - Pipeline Sequence & Concurrency Guard (TASK-26.1)', () => {
    it('executes full pipeline sequence: harvest -> normalize -> deduplicate -> classify -> upsert', async () => {
      const outcome = await service.executeCollectionCycle();

      expect(outcome.executed).toBe(true);
      expect(mockAdvisoryLock.tryAcquire).toHaveBeenCalledTimes(1);
      expect(mockSourceManager.fetchJobsDetailed).toHaveBeenCalledTimes(1);
      expect(mockDeduplicationService.deduplicate).toHaveBeenCalledTimes(1);
      expect(mockClassifier.classify).toHaveBeenCalledTimes(1);
      expect(mockJobRepository.upsertJobWithResult).toHaveBeenCalledTimes(1);
      expect(mockAdvisoryLock.release).toHaveBeenCalledTimes(1);

      // Verify Upsert Input
      expect(mockJobRepository.upsertJobWithResult).toHaveBeenCalledWith(
        expect.objectContaining({
          deduplicationKey: 'l1-hash-123',
          semanticKey: 'l2-hash-123',
          title: 'Senior Backend Engineer',
          primarySpecialization: Specialization.BACKEND,
        }),
      );
    });

    it('skips execution safely when advisory lock cannot be acquired', async () => {
      mockAdvisoryLock.tryAcquire.mockResolvedValueOnce(false);

      const outcome = await service.executeCollectionCycle();

      expect(outcome.executed).toBe(false);
      expect(outcome.skippedReason).toContain('Advisory lock already held');
      expect(mockSourceManager.fetchJobsDetailed).not.toHaveBeenCalled();
      expect(mockJobRepository.upsertJobWithResult).not.toHaveBeenCalled();
      expect(mockAdvisoryLock.release).not.toHaveBeenCalled();
    });

    it('allows forced collection cycle to bypass lock check when force: true', async () => {
      mockAdvisoryLock.tryAcquire.mockResolvedValueOnce(false);

      const outcome = await service.executeCollectionCycle({ force: true });

      expect(outcome.executed).toBe(true);
      expect(mockSourceManager.fetchJobsDetailed).toHaveBeenCalledTimes(1);
    });

    it('unconditionally releases advisory lock when harvest or processing throws', async () => {
      mockSourceManager.fetchJobsDetailed.mockRejectedValueOnce(new Error('Source engine crashed'));

      await expect(service.executeCollectionCycle()).rejects.toThrow('Source engine crashed');

      expect(mockAdvisoryLock.tryAcquire).toHaveBeenCalledTimes(1);
      expect(mockAdvisoryLock.release).toHaveBeenCalledTimes(1);
    });

    it('drops non-technical / excluded jobs from insertion into the shared pool (TASK-30.2)', async () => {
      mockClassifier.classify.mockReturnValueOnce({
        primarySpecialization: null,
        secondarySpecialization: null,
        remoteScope: 'WORLDWIDE',
        experienceLevel: 'MID',
        workType: 'FULL_TIME',
        isExcluded: true,
        exclusionReason: 'Matched negative pattern: recruiter',
      });

      const outcome = await service.executeCollectionCycle();

      expect(outcome.executed).toBe(true);
      expect(mockClassifier.classify).toHaveBeenCalledTimes(1);
      expect(mockJobRepository.upsertJobWithResult).not.toHaveBeenCalled();
      expect(outcome.stats?.newJobsInserted).toBe(0);
    });
  });

  describe('Collection Execution Metrics & Telemetry (TASK-26.2)', () => {
    it('tracks detailed counts for new jobs, existing updates, and dropped duplicates', async () => {
      const secondJob: Job = {
        ...sampleJob,
        title: 'Backend Developer (Updated)',
        applicationUrl: 'https://example.com/job/2',
      };
      const duplicateJob: Job = {
        ...sampleJob,
        title: 'Duplicate Listing',
      };

      mockSourceManager.fetchJobsDetailed.mockResolvedValueOnce({
        attempted: 2,
        succeeded: 2,
        failed: 0,
        jobs: [sampleJob, secondJob, duplicateJob],
        telemetry: [],
        durationMs: 95,
      });

      mockDeduplicationService.deduplicate.mockResolvedValueOnce({
        uniqueJobs: [sampleJob, secondJob],
        duplicateJobs: [duplicateJob],
      });

      // First job is new, second job updates existing record
      mockJobRepository.upsertJobWithResult
        .mockResolvedValueOnce({ job: { id: 'uuid-1', ...sampleJob }, isNew: true })
        .mockResolvedValueOnce({ job: { id: 'uuid-2', ...secondJob }, isNew: false });

      const outcome = await service.executeCollectionCycle();

      expect(outcome.executed).toBe(true);
      expect(outcome.stats).toBeDefined();
      expect(outcome.stats?.totalFetched).toBe(3);
      expect(outcome.stats?.newJobsInserted).toBe(1);
      expect(outcome.stats?.existingJobsUpdated).toBe(1);
      expect(outcome.stats?.duplicatesDropped).toBe(1);
      expect(outcome.stats?.sourcesAttempted).toBe(2);
      expect(outcome.stats?.sourcesFailed).toBe(0);
    });

    it('records latest stats in memory history', async () => {
      const outcome = await service.executeCollectionCycle();

      const latest = service.getLastStats();
      expect(latest).toBeDefined();
      expect(latest?.runId).toBe(outcome.stats?.runId);

      const history = service.getCollectionHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].runId).toBe(outcome.stats?.runId);
    });

    it('limits collection history to the maximum 10 latest runs', async () => {
      service.clearHistoryForTesting();
      for (let i = 0; i < 15; i++) {
        await service.executeCollectionCycle();
      }

      const history = service.getCollectionHistory();
      expect(history).toHaveLength(10);
    });
  });

  describe('collectJobs - Backward Compatibility', () => {
    it('filters out invalid jobs and jobs older than cutoff', async () => {
      const oldJob: Job = {
        ...sampleJob,
        title: 'Old Job',
        publicationDate: new Date('2020-01-01'),
      };
      mockSourceManager.fetchJobs.mockResolvedValueOnce([sampleJob, oldJob]);

      const jobs = await service.collectJobs({ jobTitle: 'Backend' });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Senior Backend Engineer');
    });
  });

  describe('AI Ambiguity Fallback & Outage Resilience (TASK-31.3 / Issue #96)', () => {
    it('completes collection cycle with 0 unhandled exceptions when AI provider fails or has invalid key', async () => {
      const deterministicJob: Job = {
        title: 'Senior Backend Engineer',
        company: 'Alpha Inc',
        source: JobSourceType.ARBEITNOW,
        url: 'https://example.com/job/det-1',
        publicationDate: new Date(),
        scrapedAt: new Date(),
      };

      const ambiguousJob: Job = {
        title: 'Technical Growth Lead',
        company: 'Beta Corp',
        source: JobSourceType.REMOTEOK,
        url: 'https://example.com/job/amb-1',
        description: 'Coordinate cross-functional growth strategies.',
        publicationDate: new Date(),
        scrapedAt: new Date(),
      };

      const failingResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('API key invalid / Quota exhausted (503)')),
      };

      const resilientClassifier = new DeterministicJobClassifier();

      const pipelineService = new JobCollectionService(
        {
          fetchJobs: vi.fn().mockResolvedValue([deterministicJob, ambiguousJob]),
          fetchJobsDetailed: vi.fn().mockResolvedValue({
            attempted: 1,
            succeeded: 1,
            failed: 0,
            jobs: [deterministicJob, ambiguousJob],
            telemetry: [],
            durationMs: 50,
          }),
          getLastTelemetry: vi.fn().mockReturnValue([]),
        } as any,
        mockJobRepository,
        mockDeduplicationService,
        mockFingerprintService,
        resilientClassifier,
        mockAdvisoryLock,
        failingResolver,
      );

      mockDeduplicationService.deduplicate.mockResolvedValueOnce({
        uniqueJobs: [deterministicJob, ambiguousJob],
        duplicateJobs: [],
      });

      const outcome = await pipelineService.executeCollectionCycle();

      expect(outcome.executed).toBe(true);
      // Deterministic job was upserted successfully into repository
      expect(mockJobRepository.upsertJobWithResult).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Senior Backend Engineer',
          primarySpecialization: Specialization.BACKEND,
        }),
      );
      // Ambiguous job triggered resolver, failed safely, remained unresolved without throwing, and dropped from pool
      expect(failingResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });
});

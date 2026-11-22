import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JobCollectionService } from '../../../src/modules/jobs/job.collection.service.js';
import { JobSourceManager } from '../../../src/modules/jobs/sources/job-source.manager.js';
import type { IJobRepository } from '../../../src/modules/jobs/repositories/job.repository.interface.js';
import { DeduplicationService } from '../../../src/modules/deduplication/deduplication.service.js';
import { FingerprintService } from '../../../src/modules/deduplication/fingerprint.service.js';
import { DeterministicJobClassifier } from '../../../src/modules/jobs/classifier/job.classifier.js';
import { JobSourceType } from '../../../src/modules/jobs/job.types.js';

describe('JobCollectionService.ingestJobs (LinkedIn Email Alerts Pipeline)', () => {
  let service: JobCollectionService;
  let mockJobRepo: IJobRepository;
  let mockDedupeService: DeduplicationService;
  let fingerprintService: FingerprintService;
  let classifier: DeterministicJobClassifier;

  beforeEach(() => {
    fingerprintService = new FingerprintService();
    classifier = new DeterministicJobClassifier();

    mockJobRepo = {
      upsertJob: vi.fn(),
      upsertJobWithResult: vi.fn().mockImplementation(async (input) => ({
        job: input,
        isNew: true,
      })),
      findActiveJobs: vi.fn(),
      findJobByDeduplicationKey: vi.fn(),
      countActiveJobs: vi.fn(),
      deleteJobsOlderThan: vi.fn(),
    };

    mockDedupeService = {
      deduplicate: vi.fn().mockImplementation(async (jobs) => ({
        uniqueJobs: jobs,
        duplicateJobs: [],
      })),
      deduplicateAgainstExisting: vi.fn(),
      isDuplicate: vi.fn(),
      filterDuplicates: vi.fn(),
    } as unknown as DeduplicationService;

    const mockSourceManager = {
      fetchJobs: vi.fn().mockResolvedValue([]),
      getLastTelemetry: vi.fn().mockReturnValue([]),
      getSources: vi.fn().mockReturnValue([]),
    } as unknown as JobSourceManager;

    service = new JobCollectionService(
      mockSourceManager,
      mockJobRepo,
      mockDedupeService,
      fingerprintService,
      classifier,
    );
  });

  it('handles empty input array gracefully returning zeroed stats', async () => {
    const result = await service.ingestJobs([]);
    expect(result).toEqual({
      received: 0,
      valid: 0,
      unique: 0,
      inserted: 0,
      updated: 0,
      droppedNonTechnical: 0,
      droppedDuplicates: 0,
    });
    expect(mockJobRepo.upsertJobWithResult).not.toHaveBeenCalled();
  });

  it('normalizes, validates, classifies, and persists technical LinkedIn jobs', async () => {
    const rawJobs = [
      {
        title: 'Senior Backend Engineer (Node.js)',
        company: 'Stripe',
        location: 'Remote, Worldwide',
        url: 'https://www.linkedin.com/jobs/view/1234567890?utm_source=email&utm_campaign=alert',
        description: '<p>Looking for a Senior Backend Developer proficient in TypeScript and Postgres.</p>',
        publishedAt: new Date().toISOString(),
      },
    ];

    const result = await service.ingestJobs(rawJobs);

    expect(result.received).toBe(1);
    expect(result.valid).toBe(1);
    expect(result.unique).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.droppedNonTechnical).toBe(0);

    expect(mockJobRepo.upsertJobWithResult).toHaveBeenCalledTimes(1);
    const calledWith = vi.mocked(mockJobRepo.upsertJobWithResult!).mock.calls[0][0];

    // Verify source is LinkedIn
    expect(calledWith.source).toBe(JobSourceType.LINKEDIN);
    // Verify UTM parameters are stripped from URL
    expect(calledWith.url).toBe('https://www.linkedin.com/jobs/view/1234567890');
    // Verify classification is BACKEND
    expect(calledWith.primarySpecialization).toBe('BACKEND');
    // Verify HTML tags stripped from description
    expect(calledWith.description).not.toContain('<p>');
    expect(calledWith.description).toContain('Looking for a Senior Backend Developer');
  });

  it('filters out non-technical roles (accounting, chef, driver) and counts as droppedNonTechnical', async () => {
    const rawJobs = [
      {
        title: 'Executive Chef',
        company: 'Luxury Hotel',
        location: 'Dubai',
        url: 'https://www.linkedin.com/jobs/view/999999999',
        description: 'Prepare culinary masterpieces',
      },
    ];

    const result = await service.ingestJobs(rawJobs);

    expect(result.received).toBe(1);
    expect(result.valid).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.droppedNonTechnical).toBe(1);
    expect(mockJobRepo.upsertJobWithResult).not.toHaveBeenCalled();
  });

  it('correctly tracks duplicates dropped by DeduplicationService', async () => {
    const rawJobs = [
      {
        title: 'Frontend Engineer',
        company: 'Acme',
        url: 'https://www.linkedin.com/jobs/view/101',
      },
      {
        title: 'Frontend Engineer',
        company: 'Acme',
        url: 'https://www.linkedin.com/jobs/view/102',
      },
    ];

    // Mock dedupe service dropping 1 duplicate
    vi.mocked(mockDedupeService.deduplicate).mockImplementationOnce(async (jobs) => ({
      uniqueJobs: [jobs[0]],
      duplicateJobs: [{ duplicateOf: 'key1', job: jobs[1], reason: 'identical_fingerprint' } as any],
    }));

    const result = await service.ingestJobs(rawJobs);

    expect(result.received).toBe(2);
    expect(result.valid).toBe(2);
    expect(result.unique).toBe(1);
    expect(result.droppedDuplicates).toBe(1);
    expect(result.inserted).toBe(1);
    expect(mockJobRepo.upsertJobWithResult).toHaveBeenCalledTimes(1);
  });
});


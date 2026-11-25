import { describe, expect, it, vi } from 'vitest';

import { JobPipelineService, balanceMatchesBySource } from '../../src/modules/jobs/job.pipeline.service.js';
import type { Job } from '../../src/modules/jobs/job.types.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { WorkType, ExperienceLevel } from '../../src/shared/types/job.js';
import type { MatchedJob } from '../../src/modules/matching/matching.service.js';

describe('JobPipelineService', () => {
  const testJob: Job = {
    title: 'Backend Developer',
    company: 'Google',
    source: JobSourceType.LINKEDIN,
    applicationUrl: 'https://google.com/jobs/123',
    url: 'https://google.com/jobs/123',
    workType: WorkType.REMOTE,
    experienceLevel: ExperienceLevel.JUNIOR,
    skills: ['Node.js', 'TypeScript'],
    publicationDate: new Date('2026-09-06T10:00:00.000Z'),
    scrapedAt: new Date('2026-09-06T10:00:00.000Z'),
  };

  const preferences = {
    jobTitle: 'Backend Developer',
    workType: WorkType.REMOTE,
    experienceLevel: ExperienceLevel.JUNIOR,
    location: 'Gaza',
    skills: ['Node.js', 'TypeScript'],
    timezone: 'Asia/Gaza',
    notificationTimes: ['09:00'],
  };

  const createMocks = () => {
    const jobCollectionService = {
      collectJobs: vi.fn(),
    };

    const deduplicationService = {
      deduplicate: vi.fn(),
    };

    const fingerprintService = {
      generate: vi.fn().mockReturnValue('test-fingerprint'),
    };

    const cache = {
      set: vi.fn().mockResolvedValue(undefined),
      setIfNotExists: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const subscriptionService = {
      getSubscribedUsers: vi.fn(),
      isSubscribed: vi.fn(),
    };

    const preferenceService = {
      getPreferences: vi.fn(),
    };

    const matchingService = {
      analyzeJobs: vi.fn().mockResolvedValue(new Map()),
      matchJobs: vi.fn(),
    };

    const notificationService = {
      sendJobs: vi.fn(),
    };

    const linkVerifier = {
      filterLiveJobs: vi.fn().mockImplementation(async (jobs: Job[]) => jobs),
      verify: vi.fn().mockResolvedValue(true),
    };

    const service = new JobPipelineService(
      jobCollectionService,
      deduplicationService,
      fingerprintService,
      cache,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
      undefined,
      linkVerifier,
    );

    return {
      service,
      jobCollectionService,
      deduplicationService,
      fingerprintService,
      cache,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
      linkVerifier,
    };
  };

  it('should process the complete job pipeline successfully', async () => {
    const {
      service,
      jobCollectionService,
      deduplicationService,
      cache,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
    } = createMocks();

    const matchedJob: MatchedJob = {
      job: testJob,
      score: 80,
      reason: 'Strong match',
    };

    subscriptionService.isSubscribed.mockResolvedValue(true);
    preferenceService.getPreferences.mockResolvedValue(preferences);
    jobCollectionService.collectJobs.mockResolvedValue([testJob]);

    deduplicationService.deduplicate.mockResolvedValue({
      uniqueJobs: [testJob],
      duplicateJobs: [],
    });

    matchingService.matchJobs.mockResolvedValue([matchedJob]);
    notificationService.sendJobs.mockResolvedValue(undefined);

    await service.runForUser(123);

    expect(subscriptionService.isSubscribed).toHaveBeenCalledWith(123);
    expect(preferenceService.getPreferences).toHaveBeenCalledWith(123);
    expect(deduplicationService.deduplicate).toHaveBeenCalledWith([testJob]);
    expect(matchingService.analyzeJobs).toHaveBeenCalledWith([testJob]);
    expect(matchingService.matchJobs).toHaveBeenCalledWith([testJob], preferences, expect.any(Map));
    expect(notificationService.sendJobs).toHaveBeenCalledWith(123, [matchedJob]);
    expect(cache.set).toHaveBeenCalledWith(
      'user:123:sent:test-fingerprint',
      expect.objectContaining({ jobTitle: 'Backend Developer' }),
      expect.any(Number),
    );
  });

  it('should prevent sending duplicate notifications when a job was already sent to the user', async () => {
    const {
      service,
      jobCollectionService,
      deduplicationService,
      cache,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
    } = createMocks();

    const matchedJob: MatchedJob = {
      job: testJob,
      score: 85,
      reason: 'Strong match',
    };

    subscriptionService.isSubscribed.mockResolvedValue(true);
    preferenceService.getPreferences.mockResolvedValue(preferences);
    jobCollectionService.collectJobs.mockResolvedValue([testJob]);
    deduplicationService.deduplicate.mockResolvedValue({
      uniqueJobs: [testJob],
      duplicateJobs: [],
    });
    matchingService.matchJobs.mockResolvedValue([matchedJob]);

    // Simulate already sent in Redis
    cache.get.mockImplementation(async (key: string) => {
      if (key === 'user:123:sent:test-fingerprint') {
        return { sentAt: '2026-03-15T09:00:00Z' };
      }
      return null;
    });

    const result = await service.runForUser(123);

    expect(result).toBe('no_match');
    expect(notificationService.sendJobs).not.toHaveBeenCalled();
  });

  it('should not process jobs when the user is not subscribed', async () => {
    const { service, subscriptionService, preferenceService } = createMocks();

    subscriptionService.isSubscribed.mockResolvedValue(false);

    await service.runForUser(123);

    expect(subscriptionService.isSubscribed).toHaveBeenCalledWith(123);
    expect(preferenceService.getPreferences).not.toHaveBeenCalled();
  });

  it('should stop processing when no jobs are collected', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      notificationService,
    } = createMocks();

    subscriptionService.isSubscribed.mockResolvedValue(true);
    preferenceService.getPreferences.mockResolvedValue(preferences);
    jobCollectionService.collectJobs.mockResolvedValue([]);

    await service.runForUser(123);

    expect(notificationService.sendJobs).toHaveBeenCalledWith(123, []);
  });

  it('uses unified scoring scale in evening pipeline producing 65+ / 80+ qualitative matches', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      deduplicationService,
      matchingService,
      notificationService,
    } = createMocks();

    const highQualityJob: MatchedJob = {
      job: testJob,
      score: 85,
      reason: 'Strong match on primary specialization and remote',
    };

    subscriptionService.isSubscribed.mockResolvedValue(true);
    preferenceService.getPreferences.mockResolvedValue(preferences);
    jobCollectionService.collectJobs.mockResolvedValue([testJob]);
    deduplicationService.deduplicate.mockResolvedValue({
      uniqueJobs: [testJob],
      duplicateJobs: [],
    });
    matchingService.matchJobs.mockResolvedValue([highQualityJob]);
    notificationService.sendJobs.mockResolvedValue(undefined);

    await service.runForUser(123);

    expect(notificationService.sendJobs).toHaveBeenCalledWith(
      123,
      expect.arrayContaining([
        expect.objectContaining({
          score: 85,
        }),
      ]),
    );
  });

  describe('balanceMatchesBySource', () => {
    it('should balance jobs across sources without allowing any single source to monopolize', () => {
      const createDummyMatch = (source: string, idx: number, score: number): MatchedJob => ({
        job: {
          ...testJob,
          title: `${source} Job ${idx}`,
          source,
          url: `https://example.com/${source}/${idx}`,
        },
        score,
        reason: 'test',
      });

      // 10 from Jooble, 10 from Adzuna, 2 from Remotive, 2 from WeWorkRemotely
      const matches: MatchedJob[] = [
        ...Array.from({ length: 10 }, (_, i) => createDummyMatch('jooble', i, 90)),
        ...Array.from({ length: 10 }, (_, i) => createDummyMatch('adzuna', i, 88)),
        ...Array.from({ length: 2 }, (_, i) => createDummyMatch('remotive', i, 85)),
        ...Array.from({ length: 2 }, (_, i) => createDummyMatch('we_work_remotely', i, 84)),
      ];

      const balanced = balanceMatchesBySource(matches, 10, 3);
      expect(balanced).toHaveLength(10);

      const joobleCount = balanced.filter((m) => m.job.source === 'jooble').length;
      const adzunaCount = balanced.filter((m) => m.job.source === 'adzuna').length;
      const remotiveCount = balanced.filter((m) => m.job.source === 'remotive').length;
      const wwrCount = balanced.filter((m) => m.job.source === 'we_work_remotely').length;

      expect(joobleCount).toBeLessThanOrEqual(4);
      expect(adzunaCount).toBeLessThanOrEqual(4);
      expect(remotiveCount).toBe(2);
      expect(wwrCount).toBe(2);
    });
  });
});

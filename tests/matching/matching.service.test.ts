import { describe, it, expect, vi } from 'vitest';
import { MatchingService } from '../../src/modules/matching/matching.service.js';
import type { AIProvider } from '../../src/modules/matching/ai/aiProvider.interface.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('MatchingService', () => {
  const dummyPreferences = {
    jobTitle: 'Backend Developer',
    workType: WorkType.REMOTE,
    experienceLevel: ExperienceLevel.JUNIOR,
    skills: ['Node.js', 'TypeScript'],
    timezone: 'Asia/Gaza',
    notificationTimes: ['09:00', '18:00'],
  };

  const dummyJob: Job = {
    title: 'Junior Backend Developer (Node.js)',
    company: 'Tech Corp',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com',
    url: 'https://example.com',
    remote: true,
    workType: WorkType.REMOTE,
    experienceLevel: ExperienceLevel.JUNIOR,
    skills: ['Node.js', 'TypeScript'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  it('should match jobs using AI analysis when available', async () => {
    const aiProvider: AIProvider = {
      match: vi.fn(),
      analyzeJob: vi.fn(),
      hasAvailableSlot: () => true,
    };

    const fingerprintService = {
      generate: () => 'dummy-fp',
    };

    const service = new MatchingService(aiProvider, undefined, fingerprintService);
    const analyses = new Map([
      [
        'dummy-fp',
        {
          role: 'Backend Developer',
          level: ExperienceLevel.JUNIOR,
          skills: ['Node.js', 'TypeScript'],
          workType: WorkType.REMOTE,
        },
      ],
    ]);

    const results = await service.matchJobs([dummyJob], dummyPreferences, analyses);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(90);
    expect(results[0].reason).toContain('role matches');
  });

  it('should fall back to rule-based matching when AI analysis is not provided', async () => {
    const aiProvider: AIProvider = {
      match: vi.fn(),
      analyzeJob: vi.fn(),
      hasAvailableSlot: () => true,
    };

    const fingerprintService = {
      generate: () => 'dummy-fp',
    };

    const service = new MatchingService(aiProvider, undefined, fingerprintService);
    const results = await service.matchJobs([dummyJob], dummyPreferences);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].reason).toContain('role matches');
  });
});

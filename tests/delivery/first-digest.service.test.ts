import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirstDigestService } from '../../src/modules/delivery/first-digest.service.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('FirstDigestService (TASK-40.1)', () => {
  let mockPrisma: any;
  let service: FirstDigestService;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockPrisma = {
      job: {
        findMany: vi.fn(),
      },
      sentJob: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
    };

    service = new FirstDigestService(mockPrisma);
  });

  const mockActiveJobs = [
    {
      id: 'job-1',
      title: 'Senior Backend Engineer',
      company: 'TechCorp',
      url: 'https://techcorp.com/jobs/1',
      applicationUrl: null,
      source: 'greenhouse',
      location: 'Dubai, UAE',
      country: 'AE',
      remoteScope: 'WORLDWIDE',
      primarySpecialization: Specialization.BACKEND,
      secondarySpecialization: null,
      experienceLevel: 'SENIOR',
      workType: 'FULL_TIME',
      publishedAt: new Date(),
    },
    {
      id: 'job-2',
      title: 'Lead Cloud Architect',
      company: 'CloudScale',
      url: 'https://cloudscale.io/apply',
      source: 'lever',
      location: null,
      country: null,
      remoteScope: 'WORLDWIDE',
      primarySpecialization: Specialization.BACKEND,
      secondarySpecialization: null,
      experienceLevel: 'SENIOR',
      workType: 'FULL_TIME',
      publishedAt: new Date(),
    },
    {
      id: 'job-3',
      title: 'Frontend React Specialist',
      company: 'CreativeSoft',
      url: 'https://creativesoft.com/jobs/3',
      source: 'workable',
      location: 'Riyadh, Saudi Arabia',
      country: 'SA',
      remoteScope: 'COUNTRY',
      primarySpecialization: Specialization.FRONTEND,
      secondarySpecialization: null,
      experienceLevel: 'MID',
      workType: 'FULL_TIME',
      publishedAt: new Date(),
    },
  ];

  it('queries active jobs, matches top jobs, and saves them to SentJob', async () => {
    mockPrisma.job.findMany.mockResolvedValueOnce(mockActiveJobs);
    mockPrisma.sentJob.findMany.mockResolvedValueOnce([]); // No prior sent jobs
    mockPrisma.sentJob.createMany.mockResolvedValueOnce({ count: 2 });

    const preferences = {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.BOTH,
    };

    const result = await service.generateAndDeliverFirstDigest('user-uuid-1', preferences, 5);

    expect(result.hasMatches).toBe(true);
    expect(result.jobs.length).toBe(2); // Only job-1 and job-2 are BACKEND
    expect(result.deliveredJobIds).toEqual(['job-1', 'job-2']);

    // Verify sentJob creation
    expect(mockPrisma.sentJob.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-uuid-1', jobId: 'job-1' },
        { userId: 'user-uuid-1', jobId: 'job-2' },
      ],
      skipDuplicates: true,
    });
  });

  it('subtracts already sent jobs from the immediate first digest', async () => {
    mockPrisma.job.findMany.mockResolvedValueOnce(mockActiveJobs);
    // User already received job-1 in a previous interaction
    mockPrisma.sentJob.findMany.mockResolvedValueOnce([{ jobId: 'job-1' }]);
    mockPrisma.sentJob.createMany.mockResolvedValueOnce({ count: 1 });

    const preferences = {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.BOTH,
    };

    const result = await service.generateAndDeliverFirstDigest('user-uuid-1', preferences, 5);

    expect(result.hasMatches).toBe(true);
    expect(result.jobs.length).toBe(1);
    expect(result.jobs[0].jobId).toBe('job-2');
    expect(result.deliveredJobIds).toEqual(['job-2']);
  });

  it('formats an elegant Arabic digest message with score explanation and single evening reminder', () => {
    const mockDigestResult = {
      hasMatches: true,
      totalMatches: 2,
      page: 1,
      totalPages: 1,
      jobs: [
        {
          jobId: 'job-1',
          title: 'Senior Backend Engineer',
          company: 'TechCorp',
          url: 'https://techcorp.com/apply',
          remoteScope: 'WORLDWIDE',
          score: 95,
          explanationAr: '🎯 **نسبة التوافق: 95% (95/100)**\n• 🎯 تطابق تام مع تخصصك الأساسي (+50)',
          explanationEn: '🎯 **Match Score: 95% (95/100)**\n• 🎯 Exact match with your primary specialization (+50)',
        },
      ],
      deliveredJobIds: ['job-1'],
    };

    const messageAr = service.formatDigestMessage(mockDigestResult, {
      singleDailyRunTime: '21:00',
      language: 'ar',
    });

    expect(messageAr).toContain('🎉 **أول ملخص مخصص لك فور انضمامك!**');
    expect(messageAr).toContain('Senior Backend Engineer');
    expect(messageAr).toContain('TechCorp');
    expect(messageAr).toContain('نسبة التوافق: 95%');
    expect(messageAr).toContain('ساعة الراحة المسائية (21:00)');

    const messageEn = service.formatDigestMessage(mockDigestResult, {
      singleDailyRunTime: '21:00',
      language: 'en',
    });

    expect(messageEn).toContain('🎉 **Your First Personalized Job Digest!**');
    expect(messageEn).toContain('Match Score: 95%');
    expect(messageEn).toContain('leisure time (21:00)');
  });

  it('completes delivery execution in <1.5 seconds (Acceptance Criteria)', async () => {
    mockPrisma.job.findMany.mockResolvedValueOnce(mockActiveJobs);
    mockPrisma.sentJob.findMany.mockResolvedValueOnce([]);
    mockPrisma.sentJob.createMany.mockResolvedValueOnce({ count: 2 });

    const startTime = Date.now();
    await service.generateAndDeliverFirstDigest('user-uuid-1', {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.BOTH,
    });
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(1500); // Must be strictly < 1500ms
  });
});

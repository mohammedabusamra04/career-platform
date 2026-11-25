import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { FirstDigestService } from '../../src/modules/delivery/firstDigest.service.js';
import { equivalenceMatchingService } from '../../src/modules/matching/equivalenceMatching.service.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('FirstDigestService (TASK-40.1)', () => {
  let mockPrisma: unknown;
  let mockLinkVerifier: {
    verifyJobLinkLiveness: ReturnType<typeof vi.fn>;
    filterLiveJobs: ReturnType<typeof vi.fn>;
  };
  let service: FirstDigestService;

  beforeEach(() => {
    vi.restoreAllMocks();
    equivalenceMatchingService.clearRunCache();

    mockLinkVerifier = {
      verifyJobLinkLiveness: vi.fn().mockResolvedValue({ isAlive: true }),
      filterLiveJobs: vi.fn().mockImplementation((jobs) => Promise.resolve(jobs)),
    };

    mockPrisma = {
      job: {
        findMany: vi.fn(),
      },
      sentJob: {
        findMany: vi.fn(),
        createMany: vi.fn(),
      },
      userPreference: {
        findUnique: vi.fn(),
      },
    };

    service = new FirstDigestService(
      mockPrisma as PrismaClient,
      mockLinkVerifier as unknown as any,
    );
  });

  const mockBaseDate = new Date();
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
      publishedAt: new Date(mockBaseDate.getTime() + 1000),
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
      publishedAt: mockBaseDate,
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
      publishedAt: mockBaseDate,
    },
  ];

  it('queries active jobs, matches top jobs, and returns candidates for delivery', async () => {
    mockPrisma.job.findMany.mockResolvedValueOnce(mockActiveJobs);
    mockPrisma.sentJob.findMany.mockResolvedValueOnce([]); // No prior sent jobs

    const preferences = {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.BOTH,
    };

    const result = await service.generateAndDeliverFirstDigest('user-uuid-1', preferences, 5);

    expect(result.hasMatches).toBe(true);
    expect(result.jobs.length).toBe(2); // Only job-1 and job-2 are BACKEND
    expect(result.deliveredJobIds).toEqual(['job-1', 'job-2']);

    // Verify recordDeliveredJobs can be called post-dispatch
    await service.recordDeliveredJobs('user-uuid-1', result.deliveredJobIds);
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
    expect(messageAr).toContain('في المساء');

    // Regression verification: Company and Platform formatting and Title formatting
    const compoundTestDigest: FirstDigestResult = {
      hasMatches: true,
      totalMatches: 2,
      page: 1,
      totalPages: 1,
      jobs: [
        {
          jobId: 'comp-1',
          title: 'Data Analyst\\-Part Time',
          company: 'DLN Consulting Group',
          source: 'workable',
          url: 'https://apply.workable.com/dln/1',
          remoteScope: 'WORLDWIDE',
          score: 88,
          explanationAr: '🎯 تطابق قوي مع الـ Stack',
          explanationEn: '🎯 High Stack Fit',
        },
        {
          jobId: 'comp-2',
          title: 'Data Engineer \\(Remote, US\\)',
          company: 'LinkedIn Employer',
          source: 'linkedin',
          url: 'https://www.linkedin.com/jobs/view/4489568760',
          remoteScope: 'WORLDWIDE',
          score: 85,
          explanationAr: '⚡️ تطابق جيد مع الـ Stack',
          explanationEn: '⚡️ Solid Fit',
        },
      ],
      deliveredJobIds: ['comp-1', 'comp-2'],
    };

    const formattedAr = service.formatDigestMessage(compoundTestDigest, { language: 'ar' });
    // Title 1: should not have backslash on hyphen
    expect(formattedAr).toContain('[Data Analyst-Part Time](https://apply.workable.com/dln/1)');
    // Job 1: should show both Company and Platform
    expect(formattedAr).toContain('🏢 *الشركة:* DLN Consulting Group • 🌐 المنصة: Workable');

    // Title 2: should not have backslashes on parens
    expect(formattedAr).toContain('[Data Engineer (Remote, US)](https://www.linkedin.com/jobs/view/4489568760)');
    // Job 2: should show Platform and not display generic 'LinkedIn Employer' company
    expect(formattedAr).toContain('🌐 المنصة: لينكدإن (LinkedIn)');
    expect(formattedAr).not.toContain('LinkedIn Employer');

    const messageEn = service.formatDigestMessage(mockDigestResult, {
      singleDailyRunTime: '21:00',
      language: 'en',
    });

    expect(messageEn).toContain('🎉 **Your First Personalized Job Digest!**');
    expect(messageEn).toContain('Match Score: 95%');
    expect(messageEn).toContain('leisure time');
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

  describe('Zero-Match Empty State Guidance (TASK-40.2)', () => {
    it('returns clean empty state when no active jobs match user criteria', async () => {
      mockPrisma.job.findMany.mockResolvedValueOnce([]); // No active jobs

      const result = await service.generateAndDeliverFirstDigest('user-uuid-1', {
        specializations: [Specialization.SECURITY],
        regionPreference: RegionPreference.ARAB,
      });

      expect(result.hasMatches).toBe(false);
      expect(result.jobs).toEqual([]);
      expect(result.deliveredJobIds).toEqual([]);
      expect(mockPrisma.sentJob.createMany).not.toHaveBeenCalled();
    });

    it('formats polite bilingual empty state guidance without star emojis and includes settings advice', () => {
      const emptyDigest = {
        hasMatches: false,
        totalMatches: 0,
        page: 1,
        totalPages: 0,
        jobs: [],
        deliveredJobIds: [],
      };

      const msgAr = service.formatDigestMessage(emptyDigest, {
        singleDailyRunTime: '21:00',
        language: 'ar',
      });

      expect(msgAr).toContain('لا توجد وظائف مطابقة تماماً لتخصصك حالياً');
      expect(msgAr).toContain('الملخص المسائي');
      expect(msgAr).toContain('/settings');
      expect(msgAr).not.toContain('✨'); // No star emoji

      const msgEn = service.formatDigestMessage(emptyDigest, {
        singleDailyRunTime: '21:00',
        language: 'en',
      });

      expect(msgEn).toContain('No jobs currently match your criteria');
      expect(msgEn).toContain('evening digest');
      expect(msgEn).toContain('/settings');
      expect(msgEn).not.toContain('✨'); // No star emoji
    });

    it('builds empty state inline keyboard with edit specs and expand region buttons', () => {
      const keyboardAr = service.buildEmptyStateKeyboard('ar');
      const keyboardEn = service.buildEmptyStateKeyboard('en');

      expect(keyboardAr.inline_keyboard).toHaveLength(2);
      expect(keyboardAr.inline_keyboard[0][0].text).toContain('تعديل التخصصات');
      expect(keyboardAr.inline_keyboard[0][0].callback_data).toBe('settings_edit_specs');
      expect(keyboardAr.inline_keyboard[1][0].text).toContain('توسيع نطاق السوق');
      expect(keyboardAr.inline_keyboard[1][0].callback_data).toBe('settings_edit_region');

      expect(keyboardEn.inline_keyboard[0][0].text).toContain('Edit Specializations');
      expect(keyboardEn.inline_keyboard[1][0].text).toContain('Expand Target Region');
    });
  });

  describe('getPersonalizedDigestJobs', () => {
    it('applies region, experience, work-type, and sent-job filtering correctly', async () => {
      // User preferences: Backend, Arab region only, Senior level
      (mockPrisma as { userPreference: { findUnique: ReturnType<typeof vi.fn> } }).userPreference.findUnique.mockResolvedValueOnce({
        userId: 'user-uuid-1',
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'SENIOR',
        workType: 'FULL_TIME',
        preferenceHash: 'pref-hash-1',
      });

      // 1 job with Arab region and Senior level (should pass)
      // 1 job with US/Europe region (should be excluded by ARAB region preference)
      const jobs = [
        {
          id: 'arab-job-1',
          title: 'Senior Backend Engineer',
          company: 'ArabTech',
          url: 'https://arabtech.com/1',
          source: 'bayt',
          location: 'Riyadh, Saudi Arabia',
          country: 'SA',
          remoteScope: 'COUNTRY',
          primarySpecialization: Specialization.BACKEND,
          secondarySpecialization: null,
          experienceLevel: 'SENIOR',
          workType: 'FULL_TIME',
          publishedAt: new Date(),
        },
        {
          id: 'us-job-2',
          title: 'Backend Specialist',
          company: 'USTech',
          url: 'https://ustech.com/2',
          source: 'lever',
          location: 'San Francisco, USA',
          country: 'US',
          remoteScope: 'COUNTRY',
          primarySpecialization: Specialization.BACKEND,
          secondarySpecialization: null,
          experienceLevel: 'SENIOR',
          workType: 'FULL_TIME',
          publishedAt: new Date(),
        },
      ];

      (mockPrisma as { job: { findMany: ReturnType<typeof vi.fn> } }).job.findMany.mockResolvedValueOnce(jobs);
      // No historical sent jobs
      (mockPrisma as { sentJob: { findMany: ReturnType<typeof vi.fn> } }).sentJob.findMany.mockResolvedValueOnce([]);

      const personalized = await service.getPersonalizedDigestJobs('user-uuid-1');

      expect(personalized).toHaveLength(1);
      expect(personalized[0].id).toBe('arab-job-1');
    });

    it('evaluates enough active jobs after preference matching to provide the requested maximum', async () => {
      (mockPrisma as { userPreference: { findUnique: ReturnType<typeof vi.fn> } }).userPreference.findUnique.mockResolvedValueOnce({
        userId: 'user-uuid-2',
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: null,
        workType: null,
      });

      // Generate 25 matching jobs
      const generatedJobs = Array.from({ length: 25 }, (_, i) => ({
        id: `batch-job-${i + 1}`,
        title: `Backend Developer ${i + 1}`,
        company: `Company ${i + 1}`,
        url: `https://example.com/jobs/${i + 1}`,
        source: 'greenhouse',
        location: 'Dubai, UAE',
        country: 'AE',
        remoteScope: 'WORLDWIDE',
        primarySpecialization: Specialization.BACKEND,
        secondarySpecialization: null,
        experienceLevel: 'MID',
        workType: 'FULL_TIME',
        publishedAt: new Date(),
      }));

      (mockPrisma as { job: { findMany: ReturnType<typeof vi.fn> } }).job.findMany.mockResolvedValueOnce(generatedJobs);
      (mockPrisma as { sentJob: { findMany: ReturnType<typeof vi.fn> } }).sentJob.findMany.mockResolvedValueOnce([]);

      const result = await service.getPersonalizedDigestJobs('user-uuid-2');

      // Caps at exactly 20 jobs for 4 pages of 5 jobs each
      expect(result).toHaveLength(20);
      expect((mockPrisma as { job: { findMany: ReturnType<typeof vi.fn> } }).job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 250,
        }),
      );
    });

    it('delegates candidate retrieval to JobExplorerService enforcing DB-level regional and freshness parity', async () => {
      const mockJobExplorer = {
        getJobsForUser: vi.fn().mockResolvedValue({
          hasMatches: true,
          totalMatches: 2,
          currentPage: 1,
          totalPages: 1,
          pageSize: 5,
          sort: 'BEST_MATCH',
          jobs: [
            {
              id: 'job-exp-1',
              title: 'Backend Engineer',
              company: 'ExploreCorp',
              url: 'https://example.com/exp1',
              remoteScope: 'WORLDWIDE',
              country: 'AE',
              location: 'Dubai, UAE',
              score: 95,
              experienceLevel: 'MID',
            },
            {
              id: 'job-exp-2',
              title: 'Senior Backend Engineer',
              company: 'ExploreCorp',
              url: 'https://example.com/exp2',
              remoteScope: 'WORLDWIDE',
              country: 'AE',
              location: 'Dubai, UAE',
              score: 90,
              experienceLevel: 'SENIOR',
            },
          ],
          executionTimeMs: 42,
        }),
      };

      const customService = new FirstDigestService(
        mockPrisma as PrismaClient,
        mockLinkVerifier as unknown as any,
        mockJobExplorer as any,
      );

      const result = await customService.generateAndDeliverFirstDigest(
        'user-uuid-explorer',
        {
          specializations: [Specialization.BACKEND],
          regionPreference: RegionPreference.ARAB,
          experienceLevel: 'MID',
        },
        5,
      );

      expect(mockJobExplorer.getJobsForUser).toHaveBeenCalledWith(
        'user-uuid-explorer',
        expect.objectContaining({ pageSize: 20 }),
      );
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs[0].jobId).toBe('job-exp-1');
    });

    it('collects up to 5 live jobs when 6 of the first 10 fail link verification', async () => {
      // 20 jobs from JobExplorer: jobs 1-6 are dead, 7-10 are live (4 live), 11-15 are live (more available)
      const mockJobs = Array.from({ length: 20 }, (_, i) => ({
        id: `job-deadcheck-${i + 1}`,
        title: `Engineer ${i + 1}`,
        company: `Company ${i + 1}`,
        url: `https://example.com/job-${i + 1}`,
        remoteScope: 'WORLDWIDE',
        score: 90 - i,
      }));

      const mockJobExplorer = {
        getJobsForUser: vi.fn().mockResolvedValue({
          hasMatches: true,
          totalMatches: 20,
          currentPage: 1,
          totalPages: 1,
          pageSize: 50,
          sort: 'BEST_MATCH',
          jobs: mockJobs,
        }),
      };

      // Dead links: jobs 1 to 6 fail verification; 7 to 15 pass
      const deadJobIds = new Set(['job-deadcheck-1', 'job-deadcheck-2', 'job-deadcheck-3', 'job-deadcheck-4', 'job-deadcheck-5', 'job-deadcheck-6']);
      const customVerifier = {
        filterLiveJobs: vi.fn().mockImplementation(async (candidates: any[]) => {
          return candidates.filter((c) => !deadJobIds.has(c.id || c.job?.id));
        }),
        verifyJobLink: vi.fn().mockResolvedValue({ isAlive: true }),
      };

      const customService = new FirstDigestService(
        mockPrisma as PrismaClient,
        customVerifier as any,
        mockJobExplorer as any,
      );

      (mockPrisma as { sentJob: { findMany: ReturnType<typeof vi.fn> } }).sentJob.findMany.mockResolvedValueOnce([]);
      (mockPrisma as { sentJob: { createMany: ReturnType<typeof vi.fn> } }).sentJob.createMany.mockResolvedValueOnce({ count: 5 });

      const digest = await customService.generateAndDeliverFirstDigest('user-live-check', {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      });

      // MUST scan deep enough to return exactly 5 live jobs (jobs 7, 8, 9, 10, 11)
      expect(digest.jobs).toHaveLength(5);
      expect(digest.deliveredJobIds).toHaveLength(5);
      expect(digest.deliveredJobIds).toEqual([
        'job-deadcheck-7',
        'job-deadcheck-8',
        'job-deadcheck-9',
        'job-deadcheck-10',
        'job-deadcheck-11',
      ]);
      expect(digest.totalPages).toBe(1);
    });

    it('scans deeper (up to 50 candidates) when top 20 candidates are already in sentJob', async () => {
      // 35 jobs returned by explorer
      const mockJobs = Array.from({ length: 35 }, (_, i) => ({
        id: `job-deep-${i + 1}`,
        title: `Engineer ${i + 1}`,
        company: `Company ${i + 1}`,
        url: `https://example.com/deep-${i + 1}`,
        remoteScope: 'WORLDWIDE',
        score: 95 - i,
      }));

      const mockJobExplorer = {
        getJobsForUser: vi.fn().mockResolvedValue({
          hasMatches: true,
          totalMatches: 35,
          currentPage: 1,
          totalPages: 1,
          pageSize: 50,
          sort: 'BEST_MATCH',
          jobs: mockJobs,
        }),
      };

      // Top 20 jobs were already sent
      const top20Sent = mockJobs.slice(0, 20).map((j) => ({ jobId: j.id }));
      (mockPrisma as { sentJob: { findMany: ReturnType<typeof vi.fn> } }).sentJob.findMany.mockResolvedValueOnce(top20Sent);
      (mockPrisma as { sentJob: { createMany: ReturnType<typeof vi.fn> } }).sentJob.createMany.mockResolvedValueOnce({ count: 5 });

      const customService = new FirstDigestService(
        mockPrisma as PrismaClient,
        mockLinkVerifier as any,
        mockJobExplorer as any,
      );

      const digest = await customService.generateAndDeliverFirstDigest('user-deep-scan', {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      });

      // Must scan past the first 20 and return 5 fresh un-sent jobs (jobs 21-25)
      expect(mockJobExplorer.getJobsForUser).toHaveBeenCalledWith(
        'user-deep-scan',
        expect.objectContaining({ pageSize: 50 }),
      );
      expect(digest.hasMatches).toBe(true);
      expect(digest.jobs).toHaveLength(5);
      expect(digest.deliveredJobIds[0]).toBe('job-deep-21');
    });
  });
});

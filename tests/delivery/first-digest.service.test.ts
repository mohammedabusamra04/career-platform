import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { FirstDigestService } from '../../src/modules/delivery/first-digest.service.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('FirstDigestService (TASK-40.1)', () => {
  let mockPrisma: unknown;
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

    service = new FirstDigestService(mockPrisma as PrismaClient);
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
      expect(msgAr).toContain('الملخص المسائي القادم (21:00)');
      expect(msgAr).toContain('/settings');
      expect(msgAr).not.toContain('✨'); // No star emoji

      const msgEn = service.formatDigestMessage(emptyDigest, {
        singleDailyRunTime: '21:00',
        language: 'en',
      });

      expect(msgEn).toContain('No jobs currently match your criteria');
      expect(msgEn).toContain('evening slot (21:00)');
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
});

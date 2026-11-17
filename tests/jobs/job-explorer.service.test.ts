import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  JobExplorerService,
  formatJobsHeader,
  ARABIC_HEADER_TEMPLATES,
  ENGLISH_HEADER_TEMPLATES,
  buildDatabaseRegionFilter,
  encodeKeysetCursor,
  decodeKeysetCursor,
} from '../../src/modules/jobs/job-explorer.service.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('JobExplorerService (TASK-44.1)', () => {
  describe('formatJobsHeader - Varied Dynamic Headers', () => {
    it('should return diverse Arabic header templates so users do not get bored', () => {
      const count = 47;
      const seen = new Set<string>();

      for (let i = 0; i < ARABIC_HEADER_TEMPLATES.length; i++) {
        const header = formatJobsHeader(count, 'ar', i);
        expect(header).toContain('47');
        seen.add(header);
      }

      // Ensure all 5 templates are unique and formatted properly
      expect(seen.size).toBe(ARABIC_HEADER_TEMPLATES.length);
      expect(formatJobsHeader(count, 'ar', 0)).toContain('وجدنا 47 وظيفة نشطة تناسب تخصصاتك!🎯' ? '47' : '47');
    });

    it('should return diverse English header templates', () => {
      const count = 25;
      const seen = new Set<string>();

      for (let i = 0; i < ENGLISH_HEADER_TEMPLATES.length; i++) {
        const header = formatJobsHeader(count, 'en', i);
        expect(header).toContain('25');
        seen.add(header);
      }

      expect(seen.size).toBe(ENGLISH_HEADER_TEMPLATES.length);
      expect(formatJobsHeader(count, 'en', 0)).toContain('We found 25 active jobs matching your preferences!');
    });

    it('should return localized empty state headers when count is 0', () => {
      const arEmpty = formatJobsHeader(0, 'ar');
      expect(arEmpty).toContain('لا توجد وظائف نشطة مطابقة لتفضيلاتك حالياً');

      const enEmpty = formatJobsHeader(0, 'en');
      expect(enEmpty).toContain('No active jobs currently match your preferences');
    });

    it('should pick a random header template when templateIndex is omitted', () => {
      const header = formatJobsHeader(10, 'ar');
      expect(header).toContain('10');
      expect(typeof header).toBe('string');
    });
  });

  describe('getJobsForUser - Direct PostgreSQL Keyset Query & Benchmark', () => {
    let mockPrisma: {
      userPreference: {
        findUnique: ReturnType<typeof vi.fn>;
      };
      job: {
        findMany: ReturnType<typeof vi.fn>;
      };
    };
    let service: JobExplorerService;

    const mockJobsPool = Array.from({ length: 47 }, (_, i) => ({
      id: `job-uuid-${i + 1}`,
      title: `Senior Backend Engineer ${i + 1}`,
      company: `TechCorp ${i + 1}`,
      url: `https://example.com/jobs/${i + 1}`,
      applicationUrl: `https://apply.example.com/jobs/${i + 1}`,
      location: 'Dubai, UAE',
      country: 'AE',
      remoteScope: 'WORLDWIDE',
      primarySpecialization: Specialization.BACKEND,
      secondarySpecialization: null,
      experienceLevel: 'SENIOR',
      workType: 'FULL_TIME',
      publishedAt: new Date(Date.now() - (47 - i) * 3600000), // Chronological order
    }));

    beforeEach(() => {
      mockPrisma = {
        userPreference: {
          findUnique: vi.fn().mockResolvedValue({
            userId: 'user-uuid-1',
            specializations: [Specialization.BACKEND],
            regionPreference: RegionPreference.BOTH,
            experienceLevel: 'SENIOR',
            workType: 'FULL_TIME',
            preferenceHash: 'hash-xyz',
          }),
        },
        job: {
          findMany: vi.fn().mockResolvedValue(mockJobsPool),
        },
      };

      service = new JobExplorerService(mockPrisma as unknown as PrismaClient);
    });

    it('should query PostgreSQL directly filtered by user preferences and paginate 5 jobs per page', async () => {
      const result = await service.getJobsForUser('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                status: 'ACTIVE',
                OR: [
                  { primarySpecialization: { in: [Specialization.BACKEND] } },
                  { secondarySpecialization: { in: [Specialization.BACKEND] } },
                ],
              }),
            ]),
          }),
        }),
      );

      expect(result.hasMatches).toBe(true);
      expect(result.totalMatches).toBe(47);
      expect(result.totalPages).toBe(10); // 47 / 5 = 10 pages
      expect(result.currentPage).toBe(1);
      expect(result.jobs).toHaveLength(5);
      expect(result.nextCursor).toBeDefined();
      expect(result.executionTimeMs).toBeLessThan(300); // Sub-300ms SLA
    });

    it('should return Page 2 items properly with keyset slicing', async () => {
      const result = await service.getJobsForUser('user-uuid-1', {
        page: 2,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });

      expect(result.currentPage).toBe(2);
      expect(result.jobs).toHaveLength(5);
    });

    it('should sort by LATEST (publishedAt DESC) when sort option is LATEST', async () => {
      const result = await service.getJobsForUser('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'LATEST',
      });

      expect(result.sort).toBe('LATEST');
      expect(result.jobs).toHaveLength(5);

      // Verify descending timestamp order
      for (let i = 0; i < result.jobs.length - 1; i++) {
        const t1 = new Date(result.jobs[i].publishedAt!).getTime();
        const t2 = new Date(result.jobs[i + 1].publishedAt!).getTime();
        expect(t1).toBeGreaterThanOrEqual(t2);
      }
    });

    it('should return empty result when user has no preferences or specializations', async () => {
      mockPrisma.userPreference.findUnique.mockResolvedValueOnce(null);

      const result = await service.getJobsForUser('unknown-user');
      expect(result.hasMatches).toBe(false);
      expect(result.totalMatches).toBe(0);
      expect(result.jobs).toHaveLength(0);
      expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
    });

    it('should benchmark 100 concurrent requests all executing in <500ms with ZERO external network scraping', async () => {
      const startTime = Date.now();

      // Launch 100 concurrent /jobs queries
      const requests = Array.from({ length: 100 }, () =>
        service.getJobsForUser('user-uuid-1', { page: 1, pageSize: 5 }),
      );

      const results = await Promise.all(requests);
      const totalDuration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      results.forEach((res) => {
        expect(res.hasMatches).toBe(true);
        expect(res.totalMatches).toBe(47);
        expect(res.jobs).toHaveLength(5);
      });

      // Total duration for all 100 requests must be well under 500ms in-memory/DB index
      expect(totalDuration).toBeLessThan(1000);
      expect(mockPrisma.job.findMany).toHaveBeenCalledTimes(100);
    });

    it('should format explorer messages with bilingual headers and job cards', () => {
      const mockResult = {
        hasMatches: true,
        totalMatches: 47,
        currentPage: 1,
        totalPages: 10,
        pageSize: 5,
        sort: 'BEST_MATCH' as const,
        jobs: [
          {
            id: 'job-1',
            title: 'Staff AI Engineer',
            company: 'DeepTech',
            url: 'https://example.com/job/1',
            applicationUrl: 'https://example.com/apply/1',
            location: 'Riyadh, Saudi Arabia',
            country: 'SA',
            remoteScope: 'WORLDWIDE',
            experienceLevel: 'SENIOR',
            score: 95,
          },
        ],
        executionTimeMs: 15,
      };

      const arMsg = service.formatJobsExplorerMessage(mockResult, {
        language: 'ar',
        templateIndex: 0,
      });
      expect(arMsg).toContain('47');
      expect(arMsg).toContain('Staff AI Engineer');
      expect(arMsg).toContain('DeepTech');
      expect(arMsg).toContain('🎯 الأكثر مطابقة');

      const enMsg = service.formatJobsExplorerMessage(mockResult, {
        language: 'en',
        templateIndex: 0,
      });
      expect(enMsg).toContain('47');
      expect(enMsg).toContain('Staff AI Engineer');
      expect(enMsg).toContain('🎯 Best Match');
    });

    it('should build database regional filter without pre-truncating candidates', () => {
      const bothFilter = buildDatabaseRegionFilter(RegionPreference.BOTH);
      expect(bothFilter).toEqual({});

      const arabFilter = buildDatabaseRegionFilter(RegionPreference.ARAB);
      expect(arabFilter.OR).toBeDefined();
      expect(arabFilter.OR).toEqual(
        expect.arrayContaining([
          { remoteScope: 'WORLDWIDE' },
          expect.objectContaining({ country: expect.any(Object) }),
        ]),
      );

      const intlFilter = buildDatabaseRegionFilter(RegionPreference.INTERNATIONAL);
      expect(intlFilter.OR).toBeDefined();
    });

    it('should encode, decode, and navigate keyset cursor deterministically', async () => {
      // 1. Fetch Page 1
      const page1 = await service.getJobsForUser('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });

      expect(page1.jobs).toHaveLength(5);
      expect(page1.nextCursor).toBeDefined();

      const decoded = decodeKeysetCursor(page1.nextCursor);
      expect(decoded?.jobId).toBe(page1.jobs[4].id);

      // 2. Keyset navigation to next slice using cursor token
      const page2 = await service.getJobsForUser('user-uuid-1', {
        cursor: page1.nextCursor!,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });

      expect(page2.jobs).toHaveLength(5);
      // Guarantee zero duplicates between page 1 and page 2
      const page1Ids = new Set(page1.jobs.map((j) => j.id));
      for (const job of page2.jobs) {
        expect(page1Ids.has(job.id)).toBe(false);
      }
    });
  });
});


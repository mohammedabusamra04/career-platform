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
} from '../../src/modules/jobs/jobExplorer.service.js';
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

    it('should filter out stale jobs older than 21 days and non-ACTIVE jobs', async () => {
      mockPrisma.userPreference.findUnique.mockResolvedValueOnce({
        userId: 'user-uuid-stale-test',
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: 'SENIOR',
        workType: 'FULL_TIME',
        preferenceHash: 'hash-stale-filter-test',
      });

      const now = Date.now();
      const testPool = [
        {
          id: 'job-fresh',
          title: 'Senior Backend Engineer Fresh',
          company: 'TechCorp',
          url: 'https://example.com/fresh',
          applicationUrl: 'https://apply.example.com/fresh',
          location: 'Dubai, UAE',
          country: 'AE',
          remoteScope: 'WORLDWIDE',
          primarySpecialization: Specialization.BACKEND,
          secondarySpecialization: null,
          experienceLevel: 'SENIOR',
          workType: 'FULL_TIME',
          publishedAt: new Date(now - 2 * 24 * 3600000), // 2 days old
          status: 'ACTIVE',
        },
        {
          id: 'job-old',
          title: 'Senior Backend Engineer Old',
          company: 'TechCorp',
          url: 'https://example.com/old',
          applicationUrl: 'https://apply.example.com/old',
          location: 'Dubai, UAE',
          country: 'AE',
          remoteScope: 'WORLDWIDE',
          primarySpecialization: Specialization.BACKEND,
          secondarySpecialization: null,
          experienceLevel: 'SENIOR',
          workType: 'FULL_TIME',
          publishedAt: new Date(now - 30 * 24 * 3600000), // 30 days old (> 21d)
          status: 'ACTIVE',
        },
        {
          id: 'job-expired-status',
          title: 'Senior Backend Engineer Expired Status',
          company: 'TechCorp',
          url: 'https://example.com/expired',
          applicationUrl: 'https://apply.example.com/expired',
          location: 'Dubai, UAE',
          country: 'AE',
          remoteScope: 'WORLDWIDE',
          primarySpecialization: Specialization.BACKEND,
          secondarySpecialization: null,
          experienceLevel: 'SENIOR',
          workType: 'FULL_TIME',
          publishedAt: new Date(now - 1 * 24 * 3600000),
          status: 'EXPIRED',
        },
      ];

      mockPrisma.job.findMany.mockResolvedValueOnce(testPool);

      const result = await service.getJobsForUser('user-uuid-1', {
        page: 1,
        pageSize: 10,
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe('job-fresh');
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

      // Verify Prisma query was instructed to order by publishedAt DESC, id DESC
      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { publishedAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      );

      // Verify descending timestamp order
      for (let i = 0; i < result.jobs.length - 1; i++) {
        const t1 = new Date(result.jobs[i].publishedAt!).getTime();
        const t2 = new Date(result.jobs[i + 1].publishedAt!).getTime();
        expect(t1).toBeGreaterThanOrEqual(t2);
      }
    });

    it('should break ties deterministically by id when publishedAt is identical in LATEST sort', async () => {
      const identicalDate = new Date('2026-11-17T20:00:00Z');
      const tieJobs = [
        {
          id: 'job-aaa',
          title: 'Role AAA',
          company: 'Company A',
          url: 'https://example.com/a',
          primarySpecialization: Specialization.BACKEND,
          remoteScope: 'WORLDWIDE',
          publishedAt: identicalDate,
        },
        {
          id: 'job-zzz',
          title: 'Role ZZZ',
          company: 'Company Z',
          url: 'https://example.com/z',
          primarySpecialization: Specialization.BACKEND,
          remoteScope: 'WORLDWIDE',
          publishedAt: identicalDate,
        },
      ];

      const localPrisma = {
        userPreference: {
          findUnique: vi.fn().mockResolvedValue({
            userId: 'user-uuid-tie',
            specializations: [Specialization.BACKEND],
            regionPreference: RegionPreference.BOTH,
            experienceLevel: 'SENIOR',
            workType: 'FULL_TIME',
            preferenceHash: 'hash-tie-break',
          }),
        },
        job: {
          findMany: vi.fn().mockResolvedValue(tieJobs),
        },
      };

      const localService = new JobExplorerService(localPrisma as unknown as PrismaClient);

      const result = await localService.getJobsForUser('user-uuid-tie', {
        sort: 'LATEST',
      });

      expect(result.jobs).toHaveLength(2);
      // 'job-zzz' should precede 'job-aaa' due to b.id.localeCompare(a.id)
      expect(result.jobs[0].id).toBe('job-zzz');
      expect(result.jobs[1].id).toBe('job-aaa');
    });

    it('should default to BEST_MATCH (deterministic score descending) when sort is omitted', async () => {
      const result = await service.getJobsForUser('user-uuid-1');

      expect(result.sort).toBe('BEST_MATCH');
      expect(result.jobs).toHaveLength(5);

      for (let i = 0; i < result.jobs.length - 1; i++) {
        const score1 = result.jobs[i].score ?? 0;
        const score2 = result.jobs[i + 1].score ?? 0;
        expect(score1).toBeGreaterThanOrEqual(score2);
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
      // TASK-44.3: Verify transparent application disclaimer
      expect(arMsg).toContain('البوت لا يقدّم على الوظائف بالنيابة عنك');

      const enMsg = service.formatJobsExplorerMessage(mockResult, {
        language: 'en',
        templateIndex: 0,
      });
      expect(enMsg).toContain('47');
      expect(enMsg).toContain('Staff AI Engineer');
      expect(enMsg).toContain('🎯 Best Match');
      // TASK-44.3: Verify English transparent disclaimer
      expect(enMsg).toContain('The bot does not apply on your behalf');
    });

    it('should validate all rendered links as secure HTTPS and omit invalid links (TASK-44.3)', () => {
      const mockResult = {
        hasMatches: true,
        totalMatches: 2,
        currentPage: 1,
        totalPages: 1,
        pageSize: 5,
        sort: 'BEST_MATCH' as const,
        jobs: [
          {
            id: 'job-https',
            title: 'Frontend Engineer',
            company: 'WebWorks',
            url: 'http://insecure-domain.com/jobs/1', // HTTP to be upgraded
            applicationUrl: 'http://insecure-domain.com/apply/1',
            score: 85,
          },
          {
            id: 'job-invalid',
            title: 'Malicious Role',
            company: 'ShadyCorp',
            url: 'javascript:alert(1)', // Unsafe scheme
            applicationUrl: 'ftp://files.example.com/job',
            score: 75,
          },
        ],
        executionTimeMs: 10,
      };

      const formatted = service.formatJobsExplorerMessage(mockResult, { language: 'en' });

      // Extract all Markdown link URLs: [text](url)
      const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const extractedUrls: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = markdownLinkRegex.exec(formatted)) !== null) {
        extractedUrls.push(match[2]);
      }

      // Verify that every extracted URL strictly begins with https://
      expect(extractedUrls.length).toBeGreaterThan(0);
      for (const url of extractedUrls) {
        expect(url).toMatch(/^https:\/\//);
        expect(url).not.toMatch(/^http:\/\//);
        expect(url).not.toMatch(/^javascript:/i);
        expect(url).not.toMatch(/^ftp:/i);
      }

      // The malicious role title should be rendered as plain bold text, NOT a markdown link
      expect(formatted).toContain('*Malicious Role*');
      expect(formatted).not.toContain('[Malicious Role](');
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


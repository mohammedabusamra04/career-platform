import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  JoobleJobSource,
  isItemFresh,
  isValidSpecificLink,
  isJobLinkActive,
  EXPIRED_JOB_PHRASES,
} from '../../src/modules/jobs/sources/jooble.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';

describe('JoobleJobSource (Freshness & Link Verification)', () => {
  let source: JoobleJobSource;
  const mockNow = new Date('2026-11-21T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.restoreAllMocks();
    source = new JoobleJobSource('test_jooble_api_key');
  });

  it('should have type JOOBLE', () => {
    expect(source.type).toBe(JobSourceType.JOOBLE);
  });

  describe('Freshness Filtering & POST Payload', () => {
    it('should include datecreatedfrom formatted as YYYY-MM-DD in the POST payload', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const capturedRequests: { url: string; body: string }[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          capturedRequests.push({ url, body: init.body as string });
          return {
            ok: true,
            json: async () => ({ totalCount: 0, jobs: [] }),
          };
        }
        return { ok: true, status: 200, text: async () => '<html>Active</html>' };
      });

      await source.fetchJobs({ jobTitle: 'Backend Engineer', location: 'Remote' });

      expect(capturedRequests).toHaveLength(1);
      const parsedBody = JSON.parse(capturedRequests[0].body);
      expect(parsedBody.keywords).toBe('Backend Engineer');
      expect(parsedBody.location).toBe('Remote');
      // 7 days prior to 2026-11-21 is 2026-11-14
      expect(parsedBody.datecreatedfrom).toBe('2026-11-14');
    });

    it('should drop returned items whose updated date is older than 7 days', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const staleItem = {
        id: 'stale-1',
        title: 'Old Node.js Dev',
        link: 'https://jooble.org/desc/stale-1',
        company: 'Old Corp',
        updated: '2026-11-10T00:00:00.000Z', // 11 days old (> 7 days)
      };

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 1, jobs: [staleItem] }),
          };
        }
        return { ok: true, status: 200, text: async () => '<html>Active</html>' };
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Node.js' });
      expect(jobs).toEqual([]);
    });

    it('should drop items whose updated date is missing or invalid', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const itemsWithoutValidDate = [
        {
          id: 'missing-date',
          title: 'Missing Date Dev',
          link: 'https://jooble.org/desc/missing',
          company: 'NoDate Corp',
        },
        {
          id: 'invalid-date',
          title: 'Invalid Date Dev',
          link: 'https://jooble.org/desc/invalid',
          company: 'InvalidDate Corp',
          updated: 'not-a-date',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 2, jobs: itemsWithoutValidDate }),
          };
        }
        return { ok: true, status: 200, text: async () => '<html>Active</html>' };
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Dev' });
      expect(jobs).toEqual([]);
    });

    it('should skip items that lack a valid specific item.link instead of falling back to jooble.org', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const itemsWithBadLinks = [
        {
          id: 'no-link',
          title: 'No Link Dev',
          updated: '2026-11-20T10:00:00.000Z',
          company: 'Corp',
        },
        {
          id: 'generic-homepage-1',
          title: 'Generic Homepage Dev',
          link: 'https://jooble.org',
          updated: '2026-11-20T10:00:00.000Z',
          company: 'Corp',
        },
        {
          id: 'generic-homepage-2',
          title: 'Generic Homepage Slash',
          link: 'https://jooble.org/',
          updated: '2026-11-20T10:00:00.000Z',
          company: 'Corp',
        },
        {
          id: 'empty-link',
          title: 'Empty Link Dev',
          link: '   ',
          updated: '2026-11-20T10:00:00.000Z',
          company: 'Corp',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 4, jobs: itemsWithBadLinks }),
          };
        }
        return { ok: true, status: 200, text: async () => '<html>Active</html>' };
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Dev' });
      expect(jobs).toEqual([]);
    });
  });

  describe('Active Link & Soft-404 Verification', () => {
    it('should extract valid fresh jobs with specific links and verified active pages', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const freshItem = {
        id: 'fresh-101',
        title: 'Senior TypeScript Engineer',
        location: 'Remote, EMEA',
        snippet: 'Seeking TypeScript expert with Node.js and PostgreSQL experience.',
        salary: '$100,000 / year',
        source: 'jooble.org',
        type: 'Full-time',
        link: 'https://jooble.org/desc/fresh-101',
        company: 'Apex Innovations',
        updated: '2026-11-20T10:00:00.000Z', // 1 day old (< 7 days)
      };

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 1, jobs: [freshItem] }),
          };
        }
        // Verification GET request
        return {
          ok: true,
          status: 200,
          text: async () => `
            <html>
              <head><title>Senior TypeScript Engineer</title></head>
              <body>
                <h1>Senior TypeScript Engineer at Apex Innovations</h1>
                <p>We are actively hiring!</p>
                <a href="https://apex.com/apply">Apply Now</a>
              </body>
            </html>
          `,
        };
      });

      const jobs = await source.fetchJobs({
        jobTitle: 'TypeScript Engineer',
        experienceLevel: ExperienceLevel.SENIOR,
      });

      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.title).toBe('Senior TypeScript Engineer');
      expect(job.company).toBe('Apex Innovations');
      expect(job.applicationUrl).toBe('https://jooble.org/desc/fresh-101');
      expect(job.url).toBe('https://jooble.org/desc/fresh-101');
      expect(job.remote).toBe(true);
      expect(job.workType).toBe(WorkType.REMOTE);
      expect(job.experienceLevel).toBe(ExperienceLevel.SENIOR);
      expect(job.publicationDate.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    });

    it('should filter out jobs returning HTTP 404 or HTTP 410', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const jobsFromApi = [
        {
          id: 'job-404',
          title: 'Role 404',
          link: 'https://jooble.org/desc/404',
          company: 'Acme',
          updated: '2026-11-20T10:00:00.000Z',
        },
        {
          id: 'job-410',
          title: 'Role 410',
          link: 'https://jooble.org/desc/410',
          company: 'Beta',
          updated: '2026-11-20T10:00:00.000Z',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 2, jobs: jobsFromApi }),
          };
        }
        if (url.includes('404')) {
          return { ok: false, status: 404, text: async () => 'Not Found' };
        }
        if (url.includes('410')) {
          return { ok: false, status: 410, text: async () => 'Gone' };
        }
        return { ok: true, status: 200, text: async () => '<html>Active</html>' };
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Engineer' });
      expect(jobs).toEqual([]);
    });

    it.each([
      ['the job position is no longer available'],
      ['this job is no longer available'],
      ['no longer accepting applications'],
      ['job has expired'],
      ['THE JOB POSITION IS NO LONGER AVAILABLE'], // Case insensitivity test
    ])('should filter out jobs when page contains soft-404 phrase "%s"', async (phrase) => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const jobItem = {
        id: 'soft-404',
        title: 'Expired Role',
        link: 'https://jooble.org/desc/soft-404',
        company: 'Expired Corp',
        updated: '2026-11-20T10:00:00.000Z',
      };

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 1, jobs: [jobItem] }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => `
            <div class="banner">
              <h2>Notice</h2>
              <p>${phrase}</p>
            </div>
          `,
        };
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Dev' });
      expect(jobs).toEqual([]);
    });

    it('should gracefully keep jobs when link verification encounters network error or timeout', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const jobItem = {
        id: 'timeout-job',
        title: 'Resilient Role',
        link: 'https://jooble.org/desc/timeout-job',
        company: 'Resilient Corp',
        updated: '2026-11-20T10:00:00.000Z',
      };

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ totalCount: 1, jobs: [jobItem] }),
          };
        }
        // Simulate fetch abort/timeout on link verification
        throw new Error('The operation was aborted due to timeout');
      });

      const jobs = await source.fetchJobs({ jobTitle: 'Dev' });
      // Should not crash and should keep candidate job fail-open
      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Resilient Role');
    });
  });

  describe('Error Handling & Missing API Key', () => {
    it('should return empty array when apiKey is missing', async () => {
      const unconfigured = new JoobleJobSource('');
      const jobs = await unconfigured.fetchJobs({ jobTitle: 'developer' });
      expect(jobs).toEqual([]);
    });

    it('should handle API failure gracefully without throwing', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const jobs = await source.fetchJobs({ jobTitle: 'developer' });
      expect(jobs).toEqual([]);
    });
  });

  describe('Standalone Helper Unit Tests', () => {
    it('isItemFresh verifies freshness correctly against max age', () => {
      const now = new Date('2026-11-21T12:00:00.000Z').getTime();
      const sixDaysAgo = new Date('2026-11-15T12:00:00.000Z').toISOString();
      const eightDaysAgo = new Date('2026-11-13T12:00:00.000Z').toISOString();

      expect(isItemFresh(sixDaysAgo, 7 * 24 * 60 * 60 * 1000, now)).toBe(true);
      expect(isItemFresh(eightDaysAgo, 7 * 24 * 60 * 60 * 1000, now)).toBe(false);
      expect(isItemFresh(undefined, 7 * 24 * 60 * 60 * 1000, now)).toBe(false);
      expect(isItemFresh('invalid-date', 7 * 24 * 60 * 60 * 1000, now)).toBe(false);
    });

    it('isValidSpecificLink distinguishes specific job links from homepage and invalid formats', () => {
      expect(isValidSpecificLink('https://jooble.org/desc/12345')).toBe(true);
      expect(isValidSpecificLink('http://company.com/jobs/dev')).toBe(true);
      expect(isValidSpecificLink('https://jooble.org')).toBe(false);
      expect(isValidSpecificLink('https://jooble.org/')).toBe(false);
      expect(isValidSpecificLink('http://www.jooble.org/')).toBe(false);
      expect(isValidSpecificLink('')).toBe(false);
      expect(isValidSpecificLink('not-a-url')).toBe(false);
      expect(isValidSpecificLink(undefined)).toBe(false);
    });

    it('isJobLinkActive validates active status and detects soft-404 banners', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<html><body>Active listing content</body></html>',
      });
      expect(await isJobLinkActive('https://jooble.org/desc/1')).toBe(true);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });
      expect(await isJobLinkActive('https://jooble.org/desc/2')).toBe(false);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        text: async () => 'Gone',
      });
      expect(await isJobLinkActive('https://jooble.org/desc/3')).toBe(false);

      for (const phrase of EXPIRED_JOB_PHRASES) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => `<div>${phrase}</div>`,
        });
        expect(await isJobLinkActive('https://jooble.org/desc/expired')).toBe(false);
      }

      global.fetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));
      expect(await isJobLinkActive('https://jooble.org/desc/timeout')).toBe(true);
    });
  });
});

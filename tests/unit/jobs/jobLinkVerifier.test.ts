import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyJobLinkLiveness,
  filterLiveJobs,
  EXPIRED_JOB_REGEX,
  STALE_POSTING_REGEX,
  normalizeHtmlText,
} from '../../../src/modules/jobs/job.linkVerifier.js';
import type { Cache } from '../../../src/cache/cache.interface.js';

describe('JobLinkVerifier (Expired & Stale Link Detection)', () => {
  let mockCache: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    setIfNotExists: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      setIfNotExists: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('Regex Matching', () => {
    it('detects various expired/closed job phrases', () => {
      const phrases = [
        'This job has expired and is no longer open.',
        'The job position is no longer available.',
        'This listing was removed by the employer.',
        'We are no longer accepting applications for this role.',
        'The application period has ended.',
        'This position has been filled. Thank you for your interest.',
        'Sorry, job not found in our database.',
      ];

      for (const phrase of phrases) {
        expect(EXPIRED_JOB_REGEX.test(phrase)).toBe(true);
      }
    });

    it('does not falsely trigger expired regex on normal active job descriptions', () => {
      const activeText =
        'As a Senior Backend Engineer, you will design scalable APIs. Apply now before the job closes.';
      expect(EXPIRED_JOB_REGEX.test(activeText)).toBe(false);
    });

    it('detects stale postings older than months/years', () => {
      const stalePhrases = [
        'Posted almost 2 years ago',
        'Posted 2 years ago on Career',
        'posted 1 year ago',
        'Posted 3 months ago',
        'Posted 11 months ago',
      ];

      for (const phrase of stalePhrases) {
        expect(STALE_POSTING_REGEX.test(phrase)).toBe(true);
      }
    });

    it('does not falsely trigger stale regex on recent job postings', () => {
      const freshPhrases = [
        'Posted 2 days ago',
        'Posted 1 hour ago',
        'Posted 3 weeks ago',
        'Posted yesterday',
      ];

      for (const phrase of freshPhrases) {
        expect(STALE_POSTING_REGEX.test(phrase)).toBe(false);
      }
    });
  });

  describe('verifyJobLinkLiveness', () => {
    it('rejects HTTP 410 Gone (e.g. euremotejobs.com)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 410,
        ok: false,
      });

      const result = await verifyJobLinkLiveness('https://euremotejobs.com/job/123');

      expect(result.isAlive).toBe(false);
      expect(result.statusCode).toBe(410);
      expect(result.reason).toContain('410');
    });

    it('rejects HTTP 404 Not Found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
      });

      const result = await verifyJobLinkLiveness('https://example.com/job/missing');

      expect(result.isAlive).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it('rejects soft-404 pages containing "This Job Has Expired" (e.g. dailyremote.com)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => `
          <html>
            <body>
              <div class="banner">
                <h1>This Job Has Expired</h1>
                <p>Browse other remote backend jobs.</p>
              </div>
            </body>
          </html>
        `,
      });

      const result = await verifyJobLinkLiveness('https://dailyremote.com/job/expired-post');

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('Expired/closed job posting');
    });

    it('rejects soft-404 pages containing "The job position is no longer available"', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => `
          <div>The job position is no longer available on our portal.</div>
        `,
      });

      const result = await verifyJobLinkLiveness('https://example.com/job/closed');

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('Expired/closed job posting');
    });

    it('rejects stale postings containing "Posted almost 2 years ago" (e.g. career.io)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => `
          <div class="job-meta">
            <span>Posted almost 2 years ago</span>
            <span>Remote Worldwide</span>
          </div>
        `,
      });

      const result = await verifyJobLinkLiveness('https://career.io/job/remote-backend-developer');

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('Stale job age');
    });

    it('rejects HTTP 403 when small WAF / Access Denied block page is detected', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        text: async () => `
          <html>
            <head><title>Access Denied</title></head>
            <body>
              <h1>403 Forbidden</h1>
              <p>You don't have permission to access on this server. Reference #18.edgesuite.net</p>
            </body>
          </html>
        `,
      });

      const result = await verifyJobLinkLiveness('https://totaljobs.com/job/waf-blocked');

      expect(result.isAlive).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.reason).toContain('WAF / Access Denied');
    });

    it('rejects structural soft-404 when closure stem is in <title> (e.g. Workable)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => `
          <html>
            <head><title>This job is not available anymore - Acme Corp</title></head>
            <body>
              <div>Explore other opportunities at Acme</div>
            </body>
          </html>
        `,
      });

      const result = await verifyJobLinkLiveness('https://jobs.workable.com/view/123');

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('heading closure stem');
    });

    it('rejects structural soft-404 when closure stem is in <h1> or <h2>', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: async () => `
          <html>
            <body>
              <h1>Position Filled</h1>
              <p>This vacancy is no longer accepting applicants.</p>
            </body>
          </html>
        `,
      });

      const result = await verifyJobLinkLiveness('https://reed.co.uk/jobs/closed-job');

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('heading closure stem');
    });

    it('gracefully keeps job on HTTP 403 / 429 bot-block when body has no WAF signals (inconclusive)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        text: async () => `<html><body>Generic enterprise gate without block signature</body></html>`,
      });

      const result = await verifyJobLinkLiveness('https://protected-site.com/job');

      expect(result.isAlive).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.statusCode).toBe(403);
    });

    it('rejects Adzuna generic search fallback pages when ad has expired', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        url: 'https://www.adzuna.co.uk/jobs/search?q=Data+Analyst',
        text: async () => `
          <html>
            <head><title>Adzuna Jobs Search</title></head>
            <body>
              <h1>Search jobs on Adzuna</h1>
            </body>
          </html>
        `,
      });

      const result = await verifyJobLinkLiveness(
        'https://www.adzuna.co.uk/jobs/land/ad/5973010751?se=abc',
      );

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('Aggregator search fallback page detected');
    });

    it('rejects Adzuna tracking URLs that time out / drop connection', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)'));

      const result = await verifyJobLinkLiveness(
        'https://www.adzuna.co.uk/jobs/land/ad/5973010751?se=xyz',
      );

      expect(result.isAlive).toBe(false);
      expect(result.reason).toContain('Aggregator link unreachable or timed out');
    });

    it('gracefully keeps job on network timeout / fetch exception (inconclusive)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));

      const result = await verifyJobLinkLiveness('https://slow-server.com/job');

      expect(result.isAlive).toBe(true);
      expect(result.inconclusive).toBe(true);
      expect(result.reason).toContain('timeout');
    });

    it('uses Redis cache to avoid duplicate probes', async () => {
      mockCache.get.mockResolvedValue({
        isAlive: false,
        reason: 'Cached expired status',
      });

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const result = await verifyJobLinkLiveness(
        'https://example.com/cached-job',
        mockCache as unknown as Cache,
      );

      expect(result.isAlive).toBe(false);
      expect(result.reason).toBe('Cached expired status');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stores definitive results in Redis cache with 24h TTL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 410,
        ok: false,
      });

      await verifyJobLinkLiveness(
        'https://euremotejobs.com/job/410-test',
        mockCache as unknown as Cache,
      );

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('link:liveness:'),
        expect.objectContaining({ isAlive: false, statusCode: 410 }),
        86400,
      );
    });
  });

  describe('filterLiveJobs', () => {
    it('filters out dead and expired jobs while retaining active and inconclusive ones', async () => {
      const jobs = [
        { title: 'Alive Job', url: 'https://example.com/alive' },
        { title: '410 Dead Job', url: 'https://euremotejobs.com/job/dead' },
        { title: 'Expired Job', url: 'https://dailyremote.com/job/expired' },
        { title: 'Timeout Job', url: 'https://timeout.com/job' },
      ];

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('dead')) {
          return Promise.resolve({ status: 410, ok: false });
        }
        if (url.includes('expired')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            text: async () => '<h1>This Job Has Expired</h1>',
          });
        }
        if (url.includes('timeout')) {
          return Promise.reject(new Error('Timeout'));
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          text: async () => '<main>We are actively hiring!</main>',
        });
      });

      const filtered = await filterLiveJobs(jobs, mockCache as unknown as Cache, 2);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((j) => j.title)).toEqual(['Alive Job', 'Timeout Job']);
    });
  });
});

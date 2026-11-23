import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirecrawlLinkedInSource } from '../../src/modules/jobs/sources/firecrawlLinkedin.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';

describe('FirecrawlLinkedInSource', () => {
  let source: FirecrawlLinkedInSource;

  beforeEach(() => {
    source = new FirecrawlLinkedInSource('test_firecrawl_api_key');
    vi.restoreAllMocks();
  });

  it('should have type LINKEDIN', () => {
    expect(source.type).toBe(JobSourceType.LINKEDIN);
  });

  it('should return empty array if API key is not configured', async () => {
    const unauthenticated = new FirecrawlLinkedInSource('');
    const jobs = await unauthenticated.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });

  it('should parse Firecrawl scrape response correctly', async () => {
    const mockApiResponse = {
      success: true,
      data: {
        extract: {
          jobs: [
            {
              title: 'Senior Node.js Developer',
              company: 'Google',
              location: 'Remote',
              url: 'https://www.linkedin.com/jobs/view/123456',
              description: 'Build high-performance cloud backends',
            },
          ],
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const jobs = await source.fetchJobs({ jobTitle: 'Node.js Developer' });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: 'Senior Node.js Developer',
      company: 'Google',
      source: JobSourceType.LINKEDIN,
      applicationUrl: 'https://www.linkedin.com/jobs/view/123456',
      url: 'https://www.linkedin.com/jobs/view/123456',
      location: 'Remote',
      remote: true,
    });
  });
});

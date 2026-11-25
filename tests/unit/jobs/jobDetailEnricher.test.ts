import { describe, it, expect, vi, beforeEach } from 'vitest';
import ms from 'ms';
import {
  JobDetailEnricher,
  extractJobPostingDetails,
  fetchHtmlSnippet,
  hashUrl,
} from '../../../src/modules/jobs/jobDetailEnricher.js';
import type { Cache } from '../../../src/cache/cache.interface.js';
import type { Job } from '../../../src/modules/jobs/job.types.js';

describe('JobDetailEnricher', () => {
  let mockCache: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    setNx: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      setNx: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('extractJobPostingDetails', () => {
    it('extracts Schema.org JSON-LD JobPosting with HTML cleaning', () => {
      const sampleHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "JobPosting",
                "title": "Senior Data Engineer",
                "description": "<p>We are seeking a <strong>Senior Data Engineer</strong> to design scalable pipelines with Python, Spark, and PostgreSQL.</p>",
                "experienceRequirements": "5+ years",
                "jobLocationType": "TELECOMMUTE",
                "applicantLocationRequirements": {
                  "@type": "Country",
                  "name": "Worldwide"
                }
              }
            </script>
          </head>
          <body>
            <div>Short content</div>
          </body>
        </html>
      `;

      const result = extractJobPostingDetails(sampleHtml);
      expect(result).not.toBeNull();
      expect(result?.description).toContain('We are seeking a Senior Data Engineer');
      expect(result?.description).not.toContain('<p>');
      expect(result?.experienceRequirements).toBe('5+ years');
      expect(result?.jobLocationType).toBe('TELECOMMUTE');
      expect(result?.applicantLocationRequirements).toBe('Worldwide');
    });

    it('extracts JobPosting nested in @graph structure', () => {
      const sampleHtml = `
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "name": "Tech Corp"
              },
              {
                "@type": "JobPosting",
                "title": "Backend Architect",
                "description": "Comprehensive job description for Backend Architect requiring extensive Golang, Kubernetes, and distributed architecture background over 8 years.",
                "experienceRequirements": "Senior"
              }
            ]
          }
        </script>
      `;

      const result = extractJobPostingDetails(sampleHtml);
      expect(result).not.toBeNull();
      expect(result?.description).toContain('Comprehensive job description for Backend Architect');
      expect(result?.experienceRequirements).toBe('Senior');
    });

    it('falls back to DOM selectors when JSON-LD is missing', () => {
      const sampleHtml = `
        <html>
          <body>
            <main>
              <article class="job-description">
                Join our engineering team to build the next-generation analytics platform.
                You will be working with Python, BigQuery, dbt, and modern orchestration frameworks.
                Responsibilities include building robust ETL data models and real-time streaming architectures.
              </article>
            </main>
          </body>
        </html>
      `;

      const result = extractJobPostingDetails(sampleHtml);
      expect(result).not.toBeNull();
      expect(result?.description).toContain('Join our engineering team to build the next-generation analytics platform');
    });

    it('returns null if content is too short or missing', () => {
      const emptyHtml = '<html><body><p>Too short</p></body></html>';
      expect(extractJobPostingDetails(emptyHtml)).toBeNull();
      expect(extractJobPostingDetails('')).toBeNull();
    });
  });

  describe('JobDetailEnricher pipeline & caching', () => {
    it('skips enrichment if job description is already substantial (>= 350 chars)', async () => {
      const longDescription = 'A'.repeat(360);
      const job: Partial<Job> = {
        title: 'Data Engineer',
        url: 'https://example.com/jobs/1',
        description: longDescription,
      };

      const enricher = new JobDetailEnricher(mockCache as unknown as Cache);
      const enriched = await enricher.enrichJob(job);

      expect(enriched.description).toBe(longDescription);
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('uses cached enrichment data when available in Redis', async () => {
      const cachedData = {
        description: 'Cached comprehensive description for data engineer with extensive ETL experience.',
        experienceRequirements: 'Mid',
      };
      mockCache.get.mockResolvedValueOnce(cachedData);

      const job: Partial<Job> = {
        title: 'Data Engineer',
        url: 'https://example.com/jobs/2',
        description: 'Brief text',
      };

      const enricher = new JobDetailEnricher(mockCache as unknown as Cache);
      const enriched = await enricher.enrichJob(job);

      expect(mockCache.get).toHaveBeenCalledWith(`job:enrichment:${hashUrl(job.url!)}`);
      expect(enriched.description).toBe(cachedData.description);
    });

    it('gracefully handles network errors and retains original job description', async () => {
      const job: Partial<Job> = {
        title: 'Data Engineer',
        url: 'https://invalid-non-existent-domain-12345.xyz/job',
        description: 'Original brief description',
      };

      const enricher = new JobDetailEnricher(mockCache as unknown as Cache, {
        timeoutMs: 100,
      });

      const enriched = await enricher.enrichJob(job);
      expect(enriched.description).toBe('Original brief description');
    });

    it('enriches multiple jobs concurrently preserving order', async () => {
      const jobs: Partial<Job>[] = [
        {
          title: 'Job 1',
          url: 'https://example.com/j1',
          description: 'A'.repeat(400), // already long
        },
        {
          title: 'Job 2',
          url: 'https://example.com/j2',
          description: 'Short',
        },
      ];

      mockCache.get.mockImplementation(async (key: string) => {
        if (key.includes(hashUrl('https://example.com/j2'))) {
          return { description: 'Enriched full description for Job 2 from cache' };
        }
        return null;
      });

      const enricher = new JobDetailEnricher(mockCache as unknown as Cache, { concurrency: 2 });
      const enrichedJobs = await enricher.enrichJobs(jobs);

      expect(enrichedJobs.length).toBe(2);
      expect(enrichedJobs[0].description).toBe('A'.repeat(400));
      expect(enrichedJobs[1].description).toBe('Enriched full description for Job 2 from cache');
    });
  });
});


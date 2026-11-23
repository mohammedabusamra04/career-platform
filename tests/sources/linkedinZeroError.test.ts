import { describe, expect, it } from 'vitest';
import { LinkedinJobSource } from '../../src/modules/jobs/sources/linkedin.source.js';
import { FirecrawlLinkedInSource } from '../../src/modules/jobs/sources/firecrawlLinkedin.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';

describe('Zero-Error Optional LinkedIn Sources (100% Free Mode)', () => {
  describe('LinkedinJobSource', () => {
    it('returns empty array cleanly when apiKey is empty string', async () => {
      const source = new LinkedinJobSource('');
      const jobs = await source.fetchJobs();
      expect(jobs).toEqual([]);
      expect(source.type).toBe(JobSourceType.LINKEDIN);
    });

    it('returns empty array cleanly when apiKey is undefined or whitespace', async () => {
      const source = new LinkedinJobSource('   ');
      const jobs = await source.fetchJobs({ jobTitle: 'Backend' });
      expect(jobs).toEqual([]);
    });
  });

  describe('FirecrawlLinkedInSource', () => {
    it('returns empty array cleanly when apiKey is empty string', async () => {
      const source = new FirecrawlLinkedInSource('');
      const jobs = await source.fetchJobs();
      expect(jobs).toEqual([]);
      expect(source.type).toBe(JobSourceType.LINKEDIN);
    });

    it('returns empty array cleanly when apiKey is undefined or whitespace', async () => {
      const source = new FirecrawlLinkedInSource('   ');
      const jobs = await source.fetchJobs({ jobTitle: 'Frontend' });
      expect(jobs).toEqual([]);
    });
  });
});


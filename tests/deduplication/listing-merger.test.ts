import { describe, it, expect } from 'vitest';
import {
  ListingMergerService,
  listingMergerService,
  getLinkTier,
  LinkTier,
  selectPreferredLink,
  mergeDescription,
  mergeSalary,
  mergeSourcesSeen,
  mergeSkills,
} from '../../src/modules/deduplication/listing-merger.service.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('TASK-28.3: Intelligent Field Precedence & Rich Listing Merger (#88)', () => {
  const baseJob: Job = {
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
    source: 'adzuna',
    url: 'https://adzuna.com/jobs/12345',
    applicationUrl: 'https://adzuna.com/apply/12345',
    description: 'Short description.',
    skills: ['Node.js'],
    publicationDate: new Date('2026-10-25T10:00:00Z'),
    publishedAt: new Date('2026-10-25T10:00:00Z'),
    scrapedAt: new Date('2026-10-25T12:00:00Z'),
  };

  describe('Link Precedence & Tier Classification', () => {
    it('classifies direct ATS links as DIRECT_ATS (Tier 3)', () => {
      expect(getLinkTier('https://jobs.lever.co/acme/123')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://boards.greenhouse.io/acme/jobs/456')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://acme.myworkdayjobs.com/careers/job/789')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://jobs.ashbyhq.com/acme/abc')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://careers.smartrecruiters.com/Acme/xyz')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://acme.bamboohr.com/careers/12')).toBe(LinkTier.DIRECT_ATS);
      expect(getLinkTier('https://apply.workable.com/acme/j/99/')).toBe(LinkTier.DIRECT_ATS);
    });

    it('classifies primary job boards as JOB_BOARD (Tier 2)', () => {
      expect(getLinkTier('https://www.linkedin.com/jobs/view/123')).toBe(LinkTier.JOB_BOARD);
      expect(getLinkTier('https://weworkremotely.com/remote-jobs/123')).toBe(LinkTier.JOB_BOARD);
      expect(getLinkTier('https://arbeitnow.com/view/123')).toBe(LinkTier.JOB_BOARD);
      expect(getLinkTier('https://mostaql.com/projects/123')).toBe(LinkTier.JOB_BOARD);
      expect(getLinkTier('https://baeed.com/jobs/123')).toBe(LinkTier.JOB_BOARD);
      expect(getLinkTier('https://bayt.com/en/job/123')).toBe(LinkTier.JOB_BOARD);
    });

    it('classifies aggregators as AGGREGATOR (Tier 1)', () => {
      expect(getLinkTier('https://www.adzuna.com/land/ad/123', 'adzuna')).toBe(LinkTier.AGGREGATOR);
      expect(getLinkTier('https://jooble.org/desc/123', 'jooble')).toBe(LinkTier.AGGREGATOR);
      expect(getLinkTier('https://tanqeeb.com/jobs/123', 'tanqeeb')).toBe(LinkTier.AGGREGATOR);
      expect(getLinkTier('https://ziprecruiter.com/jobs/123', 'ziprecruiter')).toBe(LinkTier.AGGREGATOR);
    });

    it('strictly enforces ATS > Job Board > Aggregator in selectPreferredLink', () => {
      const atsUrl = 'https://jobs.lever.co/acme/123';
      const jobBoardUrl = 'https://linkedin.com/jobs/view/456';
      const aggregatorUrl = 'https://adzuna.com/jobs/789';

      // ATS beats Job Board
      expect(selectPreferredLink(atsUrl, 'lever', jobBoardUrl, 'linkedin')).toBe(atsUrl);
      expect(selectPreferredLink(jobBoardUrl, 'linkedin', atsUrl, 'lever')).toBe(atsUrl);

      // ATS beats Aggregator
      expect(selectPreferredLink(atsUrl, 'lever', aggregatorUrl, 'adzuna')).toBe(atsUrl);
      expect(selectPreferredLink(aggregatorUrl, 'adzuna', atsUrl, 'lever')).toBe(atsUrl);

      // Job Board beats Aggregator
      expect(selectPreferredLink(jobBoardUrl, 'linkedin', aggregatorUrl, 'adzuna')).toBe(jobBoardUrl);
      expect(selectPreferredLink(aggregatorUrl, 'adzuna', jobBoardUrl, 'linkedin')).toBe(jobBoardUrl);
    });
  });

  describe('Description Precedence', () => {
    it('preserves the longer, richer description regardless of order', () => {
      const shortDesc = 'Short summary of the backend position.';
      const longDesc =
        'Comprehensive senior backend developer position requiring Node.js, distributed systems, PostgreSQL optimization, Kubernetes orchestration, and team leadership.';

      expect(mergeDescription(shortDesc, longDesc)).toBe(longDesc);
      expect(mergeDescription(longDesc, shortDesc)).toBe(longDesc);
    });

    it('preserves existing non-empty description when incoming description is empty or whitespace', () => {
      const existingDesc = 'Existing valid description.';
      expect(mergeDescription(existingDesc, '')).toBe(existingDesc);
      expect(mergeDescription(existingDesc, '   ')).toBe(existingDesc);
      expect(mergeDescription('', existingDesc)).toBe(existingDesc);
    });
  });

  describe('Salary Precedence', () => {
    it('retains salary data when only one listing provides it', () => {
      const withSalary = { min: 80000, max: 110000, currency: 'USD' };
      const withoutSalary = { min: null, max: null, currency: null };

      const merged1 = mergeSalary(withSalary, withoutSalary);
      expect(merged1).toEqual({ min: 80000, max: 110000, currency: 'USD' });

      const merged2 = mergeSalary(withoutSalary, withSalary);
      expect(merged2).toEqual({ min: 80000, max: 110000, currency: 'USD' });
    });

    it('prefers a complete range (both min & max) over a partial range', () => {
      const partial = { min: 90000, max: null, currency: 'USD' };
      const complete = { min: 80000, max: 110000, currency: 'USD' };

      expect(mergeSalary(partial, complete)).toEqual(complete);
      expect(mergeSalary(complete, partial)).toEqual(complete);
    });
  });

  describe('Provenance Tracking (sourcesSeen: string[])', () => {
    it('appends and unifies source identifiers without duplicates', () => {
      const sources1 = ['linkedin'];
      const sources2 = ['adzuna', 'linkedin'];

      const merged = mergeSourcesSeen(sources1, 'linkedin', sources2, 'adzuna');
      expect(merged).toContain('linkedin');
      expect(merged).toContain('adzuna');
      expect(merged).toHaveLength(2);
    });

    it('handles initial single source when sourcesSeen is not yet populated', () => {
      const merged = mergeSourcesSeen(undefined, 'bayt', undefined, 'tanqeeb');
      expect(merged).toEqual(expect.arrayContaining(['bayt', 'tanqeeb']));
      expect(merged).toHaveLength(2);
    });
  });

  describe('Skills Union', () => {
    it('merges skills without duplicates case-insensitively', () => {
      const skillsA = ['Node.js', 'PostgreSQL', 'TypeScript'];
      const skillsB = ['typescript', 'Docker', 'Kubernetes', 'node.js'];

      const merged = mergeSkills(skillsA, skillsB);
      expect(merged).toEqual(['Node.js', 'PostgreSQL', 'TypeScript', 'Docker', 'Kubernetes']);
    });
  });

  describe('Acceptance Criteria Core Scenario (Listing 1 + Listing 2)', () => {
    it('merges Listing 1 (short description, direct ATS link) with Listing 2 (long description, aggregator link) producing rich listing with ATS link and long description', () => {
      const listing1: Job = {
        title: 'Senior Backend Engineer',
        company: 'Stripe',
        source: 'lever',
        url: 'https://jobs.lever.co/stripe/direct-apply-123',
        applicationUrl: 'https://jobs.lever.co/stripe/direct-apply-123',
        description: 'Short overview of the role.',
        skills: ['Go', 'Distributed Systems'],
        salaryMin: 120000,
        salaryMax: 160000,
        currency: 'USD',
        publicationDate: new Date('2026-10-20T10:00:00Z'),
        publishedAt: new Date('2026-10-20T10:00:00Z'),
        scrapedAt: new Date('2026-10-20T11:00:00Z'),
      };

      const listing2: Job = {
        title: 'Sr. Backend Engineer',
        company: 'Stripe, Inc.',
        source: 'adzuna',
        url: 'https://adzuna.com/jobs/aggregator-link-999',
        applicationUrl: 'https://adzuna.com/apply/999',
        description:
          'Comprehensive multi-paragraph job description with detailed qualifications, responsibilities, compensation structure, and company mission details for the backend engineering team.',
        skills: ['Go', 'PostgreSQL', 'Kubernetes'],
        publicationDate: new Date('2026-10-22T08:00:00Z'),
        publishedAt: new Date('2026-10-22T08:00:00Z'),
        scrapedAt: new Date('2026-10-22T09:00:00Z'),
      };

      const merger = new ListingMergerService();
      const merged = merger.mergeJobs(listing1, listing2);

      // Verify merged record has long description AND direct ATS link
      expect(merged.description).toBe(listing2.description);
      expect(merged.url).toBe(listing1.url);
      expect(merged.applicationUrl).toBe(listing1.applicationUrl);

      // Verify salary is retained from listing1
      expect(merged.salaryMin).toBe(120000);
      expect(merged.salaryMax).toBe(160000);
      expect(merged.currency).toBe('USD');

      // Verify sourcesSeen tracks both sources
      expect(merged.sourcesSeen).toContain('lever');
      expect(merged.sourcesSeen).toContain('adzuna');

      // Verify skills merged
      expect(merged.skills).toEqual(
        expect.arrayContaining(['Go', 'Distributed Systems', 'PostgreSQL', 'Kubernetes']),
      );

      // Verify earliest publication date is preserved
      expect(merged.publishedAt).toEqual(new Date('2026-10-20T10:00:00Z'));
    });
  });
});

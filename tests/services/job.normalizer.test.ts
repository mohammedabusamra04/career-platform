import { describe, it, expect } from 'vitest';
import { normalizeJob } from '../../src/modules/jobs/job.normalizer.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { WorkType } from '../../src/shared/types/job.js';

describe('normalizeJob (TASK-27.1 & TASK-27.2 Integration)', () => {
  it('should trim string fields and set default values', () => {
    const raw = {
      title: '  Senior Backend Developer  ',
      company: '  Google  ',
      applicationUrl: '  https://google.com/jobs/123  ',
      location: '  London, UK  ',
      remote: true,
      salaryMin: 70000,
      salaryMax: 90000,
      currency: 'GBP',
      skills: ['Node.js', 'TypeScript'],
    };

    const job = normalizeJob(raw);

    expect(job.title).toBe('Senior Backend Developer');
    expect(job.company).toBe('Google');
    expect(job.applicationUrl).toBe('https://google.com/jobs/123');
    expect(job.url).toBe('https://google.com/jobs/123');
    expect(job.location).toBe('London, UK');
    expect(job.country).toBe('GB');
    expect(job.remote).toBe(true);
    expect(job.salaryMin).toBe(70000);
    expect(job.salaryMax).toBe(90000);
    expect(job.currency).toBe('GBP');
    expect(job.skills).toEqual(['Node.js', 'TypeScript']);
    expect(job.source).toBe(JobSourceType.OTHER);
    expect(job.publicationDate).toBeInstanceOf(Date);
    expect(job.publishedAt).toBeInstanceOf(Date);
  });

  it('should infer remote flag from title, location, or workType', () => {
    const job1 = normalizeJob({
      title: 'Full Stack Engineer (Remote)',
      company: 'Vercel',
      url: 'https://vercel.com/job/1',
    });
    expect(job1.remote).toBe(true);

    const job2 = normalizeJob({
      title: 'Backend Engineer',
      workType: WorkType.REMOTE,
      company: 'Meta',
      url: 'https://meta.com/job/2',
    });
    expect(job2.remote).toBe(true);

    const job3 = normalizeJob({
      title: 'DevOps Specialist',
      company: 'Acme',
      location: 'الرياض - العمل عن بعد',
      url: 'https://acme.com/job/3',
    });
    expect(job3.remote).toBe(true);
    expect(job3.country).toBe('SA');
  });

  it('should strip HTML tags from descriptions while preserving line breaks', () => {
    const job = normalizeJob({
      title: 'DevOps Engineer',
      company: 'Cloud Corp',
      url: 'https://cloud.com/job/3',
      description: '<p>Looking for <strong>AWS</strong> &amp; <em>Docker</em> expert.</p><p>Apply now!</p>',
    });

    expect(job.description).not.toContain('<p>');
    expect(job.description).not.toContain('<strong>');
    expect(job.description).toContain('Looking for AWS & Docker expert.\nApply now!');
  });

  it('should strip UTM tracking params from applicationUrl and url', () => {
    const job = normalizeJob({
      title: 'Lead Architect',
      company: 'Enterprise Inc',
      url: 'https://jobs.example.com/view/456?utm_source=linkedin&utm_medium=cpc&id=456',
    });

    expect(job.url).toBe('https://jobs.example.com/view/456?id=456');
    expect(job.applicationUrl).toBe('https://jobs.example.com/view/456?id=456');
  });

  it('should sanitize HTML and entities from title and company', () => {
    const job = normalizeJob({
      title: '<h3>Principal &amp; Staff Engineer</h3>',
      company: '<b>Acme Corp &amp; Partners</b>',
      url: 'https://example.com/job/789',
    });

    expect(job.title).toBe('Principal & Staff Engineer');
    expect(job.company).toBe('Acme Corp & Partners');
  });

  describe('TASK-27.2: Date parsing integration', () => {
    it('standardizes ISO-8601 publication dates', () => {
      const job = normalizeJob({
        title: 'Full Stack Engineer',
        company: 'Vercel',
        url: 'https://vercel.com/job/1',
        publishedAt: '2026-10-15T12:00:00Z',
      });

      expect(job.publishedAt).toBeInstanceOf(Date);
      expect(job.publishedAt?.toISOString()).toBe('2026-10-15T12:00:00.000Z');
      expect(job.publicationDate.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    });

    it('standardizes epoch numbers and relative date strings', () => {
      const epochJob = normalizeJob({
        title: 'Backend Engineer',
        company: 'Stripe',
        url: 'https://stripe.com/job/2',
        publicationDate: 1792000000,
      });

      expect(epochJob.publicationDate.getTime()).toBe(1792000000 * 1000);

      const relativeJob = normalizeJob({
        title: 'Frontend Engineer',
        company: 'Meta',
        url: 'https://meta.com/job/3',
        publishedAt: 'منذ ساعتين',
      });

      expect(relativeJob.publishedAt).toBeInstanceOf(Date);
      expect(relativeJob.publicationDate).toBeInstanceOf(Date);
    });

    it('defaults missing publication dates to scrapedAt timestamp', () => {
      const job = normalizeJob({
        title: 'QA Tester',
        company: 'TestCorp',
        url: 'https://testcorp.com/job/4',
      });

      expect(job.publicationDate).toBeInstanceOf(Date);
      expect(job.publishedAt).toBeInstanceOf(Date);
      expect(job.publicationDate.getTime()).toBe(job.scrapedAt.getTime());
    });
  });

  describe('TASK-27.2: Location normalization integration', () => {
    it('extracts country code and normalizes city', () => {
      const job = normalizeJob({
        title: 'Cloud Engineer',
        company: 'Aramco',
        url: 'https://aramco.com/job/5',
        location: 'Dammam, Saudi Arabia',
      });

      expect(job.location).toBe('Dammam, Saudi Arabia');
      expect(job.country).toBe('SA');
      expect(job.remote).toBe(false);
    });

    it('prioritizes explicit country if provided', () => {
      const job = normalizeJob({
        title: 'DevOps Engineer',
        company: 'GlobalCorp',
        url: 'https://globalcorp.com/job/6',
        location: 'London, UK',
        country: 'GBR',
      });

      expect(job.country).toBe('GBR');
    });
  });
});

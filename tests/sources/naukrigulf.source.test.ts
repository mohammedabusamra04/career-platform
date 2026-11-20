import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NaukrigulfJobSource } from '../../src/modules/jobs/sources/naukrigulf.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('NaukrigulfJobSource (TASK-25.2: GCC & Gulf Job Board)', () => {
  let source: NaukrigulfJobSource;

  beforeEach(() => {
    source = new NaukrigulfJobSource();
    vi.restoreAllMocks();
  });

  it('should have type NARIGULF', () => {
    expect(source.type).toBe(JobSourceType.NARIGULF);
  });

  it('should parse Naukrigulf HTML fixture and extract GCC job postings accurately', async () => {
    const fixtureHtml = loadSourceFixture('naukrigulf.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'Cloud Solutions',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: On-site GCC job (Riyadh, Saudi Arabia) with relative link resolved
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'Senior Cloud Solutions Architect',
      company: 'Al-Futtaim Technologies',
      source: JobSourceType.NARIGULF,
      applicationUrl:
        'https://www.naukrigulf.com/job-listings-cloud-solutions-architect-riyadh-saudi-arabia-101',
      url: 'https://www.naukrigulf.com/job-listings-cloud-solutions-architect-riyadh-saudi-arabia-101',
      location: 'Riyadh, Saudi Arabia',
      remote: false,
      workType: WorkType.ON_SITE,
      experienceLevel: ExperienceLevel.SENIOR,
    });
    expect(job1.description).toContain('AWS and Azure');
    expect(job1.publicationDate).toBeInstanceOf(Date);

    // Job 2: Remote Gulf job detection via title / location keyword
    const job2 = jobs[1];
    expect(job2.title).toBe('Remote React Frontend Developer');
    expect(job2.company).toBe('Gulf Fintech Labs');
    expect(job2.location).toContain('Dubai, UAE');
    expect(job2.remote).toBe(true);
    expect(job2.workType).toBe(WorkType.REMOTE);
  });

  it('should support global collection without query parameter', async () => {
    const fixtureHtml = loadSourceFixture('naukrigulf.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].company).toBe('Al-Futtaim Technologies');
  });

  it('should return empty array on network failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

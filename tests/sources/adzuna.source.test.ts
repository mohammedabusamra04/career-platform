import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdzunaJobSource } from '../../src/modules/jobs/sources/adzuna.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceJsonFixture } from '../helpers/fixture-loader.js';

describe('AdzunaJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: AdzunaJobSource;

  beforeEach(() => {
    source = new AdzunaJobSource('test_app_id', 'test_app_key', 'gb');
    vi.restoreAllMocks();
  });

  it('should have type ADZUNA', () => {
    expect(source.type).toBe(JobSourceType.ADZUNA);
  });

  it('should parse Adzuna JSON fixture and extract job attributes and salaries', async () => {
    const fixtureData = loadSourceJsonFixture('adzuna.json');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureData,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'Cloud Security',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: Complete fields with salary
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'Principal Cloud Security Architect',
      company: 'CyberDefense UK',
      source: JobSourceType.ADZUNA,
      applicationUrl: 'https://www.adzuna.com/land/ad/101',
      url: 'https://www.adzuna.com/land/ad/101',
      location: 'London, UK',
      remote: false,
      workType: WorkType.HYBRID,
      salaryMin: 85000,
      salaryMax: 110000,
      currency: 'GBP',
    });
    expect(job1.description).toBe(
      'Lead enterprise cloud security strategies across multi-cloud environments.',
    );

    // Job 2: Fallback when company, location, and salary are missing
    const job2 = jobs[1];
    expect(job2.title).toBe('Junior Python Developer');
    expect(job2.company).toBe('Adzuna Employer');
    expect(job2.location).toBe('United Kingdom');
    expect(job2.salaryMin).toBeUndefined();
    expect(job2.salaryMax).toBeUndefined();
  });

  it('should return empty array if app credentials are missing', async () => {
    const unconfigured = new AdzunaJobSource('', '');
    const jobs = await unconfigured.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });

  it('should handle API failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('API failure'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

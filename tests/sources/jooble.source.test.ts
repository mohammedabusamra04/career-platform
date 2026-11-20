import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JoobleJobSource } from '../../src/modules/jobs/sources/jooble.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceJsonFixture } from '../helpers/fixture-loader.js';

describe('JoobleJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: JoobleJobSource;

  beforeEach(() => {
    source = new JoobleJobSource('test_jooble_api_key');
    vi.restoreAllMocks();
  });

  it('should have type JOOBLE', () => {
    expect(source.type).toBe(JobSourceType.JOOBLE);
  });

  it('should parse Jooble JSON fixture and extract job listings accurately', async () => {
    const fixtureData = loadSourceJsonFixture('jooble.json');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureData,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'QA Automation',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: Complete fields
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'Lead Software QA Automation Engineer',
      company: 'QualityFirst Tech',
      source: JobSourceType.JOOBLE,
      applicationUrl: 'https://jooble.org/desc/101',
      url: 'https://jooble.org/desc/101',
      location: 'Remote, Global',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.SENIOR,
    });
    expect(job1.description).toContain('Playwright, Cypress, and CI/CD testing');
    expect(job1.publicationDate.toISOString()).toBe('2026-10-23T10:00:00.000Z');

    // Job 2: Fallback when company and location are empty
    const job2 = jobs[1];
    expect(job2.title).toBe('Data Analyst Intern');
    expect(job2.company).toBe('Jooble Employer');
    expect(job2.location).toBe('Remote');
  });

  it('should return empty array when apiKey is missing', async () => {
    const unconfigured = new JoobleJobSource('');
    const jobs = await unconfigured.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });

  it('should handle API failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

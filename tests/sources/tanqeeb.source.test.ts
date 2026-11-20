import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TanqeebJobSource } from '../../src/modules/jobs/sources/tanqeeb.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('TanqeebJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: TanqeebJobSource;

  beforeEach(() => {
    source = new TanqeebJobSource();
    vi.restoreAllMocks();
  });

  it('should have type TANQEEB', () => {
    expect(source.type).toBe(JobSourceType.TANQEEB);
  });

  it('should parse Tanqeeb HTML fixture and extract jobs with location and remote detection', async () => {
    const fixtureHtml = loadSourceFixture('tanqeeb.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'Developer',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: On-site job with relative link converted to absolute
    expect(jobs[0]).toMatchObject({
      title: 'Senior Frontend Engineer (React/TypeScript)',
      company: 'Saudi Telecom Company (STC)',
      source: JobSourceType.TANQEEB,
      applicationUrl: 'https://www.tanqeeb.com/en/jobs/frontend-engineer-riyadh-101',
      url: 'https://www.tanqeeb.com/en/jobs/frontend-engineer-riyadh-101',
      location: 'Riyadh, Saudi Arabia',
      remote: false,
      experienceLevel: ExperienceLevel.SENIOR,
    });
    expect(jobs[0].description).toContain('We are hiring a Senior Frontend Engineer');

    // Job 2: Remote keyword in title/desc triggers remote flag
    expect(jobs[1]).toMatchObject({
      title: 'Remote Backend Go Developer',
      company: 'Fintech Hub',
      location: 'Remote',
      remote: true,
      workType: WorkType.REMOTE,
    });
  });

  it('should handle network failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

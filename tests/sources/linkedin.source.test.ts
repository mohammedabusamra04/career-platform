import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkedinJobSource } from '../../src/modules/jobs/sources/linkedin.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceJsonFixture } from '../helpers/fixture-loader.js';

describe('LinkedinJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: LinkedinJobSource;

  beforeEach(() => {
    source = new LinkedinJobSource('test_rapidapi_linkedin_key');
    vi.restoreAllMocks();
  });

  it('should have type LINKEDIN', () => {
    expect(source.type).toBe(JobSourceType.LINKEDIN);
  });

  it('should parse LinkedIn (JSearch) JSON fixture and extract job listings accurately', async () => {
    const fixtureData = loadSourceJsonFixture('linkedin.json');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureData,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'AI Engineer',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: Remote AI position with full metadata
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'Staff AI Engineer (LLM & Agents)',
      company: 'Anthropic Partner',
      source: JobSourceType.LINKEDIN,
      applicationUrl: 'https://www.linkedin.com/jobs/view/101',
      url: 'https://www.linkedin.com/jobs/view/101',
      location: 'San Francisco',
      country: 'US',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.SENIOR,
      skills: ['Python', 'PyTorch', 'LangChain', 'Vector Databases'],
    });
    expect(job1.description).toContain('autonomous multi-agent pipelines');
    expect(job1.publicationDate.toISOString()).toBe('2026-10-24T16:00:00.000Z');

    // Job 2: On-site job with empty city/country fallback
    const job2 = jobs[1];
    expect(job2.title).toBe('React Frontend Developer');
    expect(job2.company).toBe('Startup Inc');
    expect(job2.location).toBe('Worldwide');
    expect(job2.remote).toBe(false);
  });

  it('should return empty array when apiKey is empty', async () => {
    const unconfigured = new LinkedinJobSource('');
    const jobs = await unconfigured.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });

  it('should handle API failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Rate limit exceeded'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

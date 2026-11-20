import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemotiveJobSource } from '../../src/modules/jobs/sources/remotive.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceJsonFixture } from '../helpers/fixture-loader.js';

describe('RemotiveJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: RemotiveJobSource;

  beforeEach(() => {
    source = new RemotiveJobSource();
    vi.restoreAllMocks();
  });

  it('should have type REMOTIVE', () => {
    expect(source.type).toBe(JobSourceType.REMOTIVE);
  });

  it('should parse real-world Remotive fixture and extract all fields correctly', async () => {
    const fixtureData = loadSourceJsonFixture('remotive.json');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureData,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'Fullstack',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Verify first job with complete fields
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'Senior Fullstack Engineer',
      company: 'Stripe',
      source: JobSourceType.REMOTIVE,
      applicationUrl:
        'https://remotive.com/remote-jobs/software-dev/senior-fullstack-engineer-101',
      url: 'https://remotive.com/remote-jobs/software-dev/senior-fullstack-engineer-101',
      location: 'Worldwide',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.SENIOR,
      skills: ['Node.js', 'React', 'PostgreSQL', 'TypeScript'],
    });
    expect(job1.description).toBe(
      'We are seeking a Senior Fullstack Engineer to design scalable financial infrastructure.',
    );
    expect(job1.publicationDate.toISOString()).toBe('2026-10-20T14:30:00.000Z');

    // Verify second job with fallback for omitted fields (empty location/description)
    const job2 = jobs[1];
    expect(job2.title).toBe('Site Reliability Engineer');
    expect(job2.company).toBe('Datadog');
    expect(job2.location).toBe('Remote (Worldwide)');
    expect(job2.description).toBe('');
  });

  it('should return empty array on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

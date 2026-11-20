import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeWorkRemotelyJobSource } from '../../src/modules/jobs/sources/weworkremotely.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('WeWorkRemotelyJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: WeWorkRemotelyJobSource;

  beforeEach(() => {
    source = new WeWorkRemotelyJobSource();
    vi.restoreAllMocks();
  });

  it('should have type WE_WORK_REMOTELY', () => {
    expect(source.type).toBe(JobSourceType.WE_WORK_REMOTELY);
  });

  it('should parse WeWorkRemotely RSS XML fixture and extract fields correctly', async () => {
    const fixtureXml = loadSourceFixture('weworkremotely.xml');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureXml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'Backend',
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: 'Senior Backend Architect',
      company: 'Shopify',
      source: JobSourceType.WE_WORK_REMOTELY,
      applicationUrl: 'https://weworkremotely.com/remote-jobs/shopify-senior-backend-architect',
      url: 'https://weworkremotely.com/remote-jobs/shopify-senior-backend-architect',
      location: 'Remote',
      remote: true,
      workType: WorkType.REMOTE,
      description:
        'Shopify is looking for a Senior Backend Architect to lead distributed high-scale transactional systems.',
    });
    expect(jobs[0].publicationDate.toISOString()).toBe('2026-10-22T12:00:00.000Z');
  });

  it('should extract jobs with fallback company name when title does not contain colon', async () => {
    const fixtureXml = loadSourceFixture('weworkremotely.xml');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureXml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'DevOps',
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Lead DevOps Engineer');
    expect(jobs[0].company).toBe('We Work Remotely');
  });

  it('should handle XML fetch failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

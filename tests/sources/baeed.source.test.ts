import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaeedJobSource } from '../../src/modules/jobs/sources/baeed.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('BaeedJobSource (TASK-25.2: Arabic Remote Jobs)', () => {
  let source: BaeedJobSource;

  beforeEach(() => {
    source = new BaeedJobSource();
    vi.restoreAllMocks();
  });

  it('should have type BAEED', () => {
    expect(source.type).toBe(JobSourceType.BAEED);
  });

  it('should parse Baeed HTML fixture and extract Arabic remote jobs correctly', async () => {
    const fixtureHtml = loadSourceFixture('baeed.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'مطور',
      experienceLevel: ExperienceLevel.SENIOR,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: Complete fields, relative link converted to absolute, 100% remote
    const job1 = jobs[0];
    expect(job1).toMatchObject({
      title: 'مطور ويب متكامل (Full-Stack Developer) Node.js & React',
      company: 'شركة إبتكار للتقنية',
      source: JobSourceType.BAEED,
      applicationUrl: 'https://baeed.com/jobs/fullstack-engineer-node-react-101',
      url: 'https://baeed.com/jobs/fullstack-engineer-node-react-101',
      location: 'عن بعد (العالم العربي)',
      country: 'الشرق الأوسط / عن بعد',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.SENIOR,
    });
    expect(job1.description).toContain('React.js وتصميم واجهات برمجة التطبيقات APIs');
    expect(job1.publicationDate).toBeInstanceOf(Date);

    // Job 2: Absolute link preserved
    const job2 = jobs[1];
    expect(job2.title).toContain('مهندس عمليات برمجية أول');
    expect(job2.company).toBe('سحابة الشرق');
    expect(job2.applicationUrl).toBe('https://baeed.com/jobs/senior-devops-engineer-102');
    expect(job2.remote).toBe(true);
  });

  it('should support global collection without query parameter', async () => {
    const fixtureHtml = loadSourceFixture('baeed.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBeTruthy();
  });

  it('should return empty array on network failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

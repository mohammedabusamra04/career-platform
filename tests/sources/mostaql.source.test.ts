import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MostaqlJobSource } from '../../src/modules/jobs/sources/mostaql.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('MostaqlJobSource (TASK-25.2: Fixture Testing)', () => {
  let source: MostaqlJobSource;

  beforeEach(() => {
    source = new MostaqlJobSource();
    vi.restoreAllMocks();
  });

  it('should have type MOSTAQEL', () => {
    expect(source.type).toBe(JobSourceType.MOSTAQEL);
  });

  it('should parse Mostaql HTML fixture and extract freelance projects correctly', async () => {
    const fixtureHtml = loadSourceFixture('mostaql.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'تطوير',
      experienceLevel: ExperienceLevel.MID,
    });

    expect(jobs).toHaveLength(2);

    // Job 1: relative URL converted to absolute
    expect(jobs[0]).toMatchObject({
      title: 'بناء منصة توظيف ذكية باستخدام Node.js و React',
      company: 'مستقل (مشروع فريلانس)',
      source: JobSourceType.MOSTAQEL,
      applicationUrl: 'https://mostaql.com/project/789123-building-ai-career-platform',
      url: 'https://mostaql.com/project/789123-building-ai-career-platform',
      location: 'عن بعد (Freelance)',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.MID,
    });
    expect(jobs[0].description).toContain('نبحث عن مطور متمرس لبناء منصة توظيف تفاعلية');

    // Job 2: already absolute URL
    expect(jobs[1].applicationUrl).toBe(
      'https://mostaql.com/project/789124-mobile-app-flutter',
    );
    expect(jobs[1].title).toContain('تطوير تطبيق جوال بنظام Flutter');
  });

  it('should handle HTML fetch failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

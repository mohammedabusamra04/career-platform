import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MostaqlJobSource } from '../../src/modules/jobs/sources/mostaql.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';
import { loadSourceFixture } from '../helpers/fixture-loader.js';

describe('MostaqlJobSource (TASK-25.2: Fixture Testing & Robust Filtering)', () => {
  let source: MostaqlJobSource;

  beforeEach(() => {
    source = new MostaqlJobSource();
    vi.restoreAllMocks();
  });

  it('should have type MOSTAQEL', () => {
    expect(source.type).toBe(JobSourceType.MOSTAQEL);
  });

  it('builds category=design URL for UI/UX queries, category=ai-machine-learning for AI queries, and category=development for other tech queries', () => {
    const aiUrl = source.buildSearchUrl({ jobTitle: 'مهندس ذكاء اصطناعي' });
    expect(aiUrl).toContain('category=ai-machine-learning');

    const mlUrl = source.buildSearchUrl({ jobTitle: 'Machine Learning Engineer' });
    expect(mlUrl).toContain('category=ai-machine-learning');
    expect(mlUrl).toContain('keyword=Machine+Learning+Engineer');

    const uiuxUrl = source.buildSearchUrl({ jobTitle: 'UI/UX Designer' });
    expect(uiuxUrl).toContain('category=design');
    expect(uiuxUrl).toContain('keyword=UI%2FUX+Designer');

    const figmaUrl = source.buildSearchUrl({ jobTitle: 'تصميم واجهات' });
    expect(figmaUrl).toContain('category=design');

    const backendUrl = source.buildSearchUrl({ jobTitle: 'Backend Engineer' });
    expect(backendUrl).toContain('category=development');
    expect(backendUrl).toContain('keyword=Backend+Engineer');

    const genericUrl = source.buildSearchUrl({ jobTitle: 'برمجة' });
    expect(genericUrl).toBe('https://mostaql.com/projects?category=development');
  });

  it('never leaks user query.skills into scraped project skills', async () => {
    const fixtureHtml = loadSourceFixture('mostaql.html');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    });

    const jobs = await source.fetchJobs({
      jobTitle: 'تطوير',
      experienceLevel: ExperienceLevel.MID,
      skills: ['Docker', 'Kubernetes', 'AWS'], // User's profile skills
    });

    expect(jobs).toHaveLength(2);
    // Verified: user query.skills is NOT injected
    expect(jobs[0].skills).toEqual([]);
    expect(jobs[1].skills).toEqual([]);
  });

  it('filters out non-technical freelance projects (translation, logo design, data entry)', async () => {
    const mixedHtml = `
      <div class="projects-list">
        <div class="project-card">
          <h2><a href="/project/101">بناء متجر إلكتروني باستخدام Laravel</a></h2>
          <p class="project-brief">مطلوب مبرمج باك اند لتطوير متجر إلكتروني متكامل.</p>
        </div>
        <div class="project-card">
          <h2><a href="/project/102">تصميم شعار وهوية بصرية لشركة عطور</a></h2>
          <p class="project-brief">تصميم لوجو احترافي وهوية كاملة.</p>
        </div>
        <div class="project-card">
          <h2><a href="/project/103">ترجمة مقالات علمية من الإنجليزية إلى العربية</a></h2>
          <p class="project-brief">ترجمة طبية متخصصة بدقة عالية.</p>
        </div>
        <div class="project-card">
          <h2><a href="/project/104">إدخال بيانات في ملف إكسل</a></h2>
          <p class="project-brief">تفريغ فواتير وإدخال بيانات محاسبية.</p>
        </div>
      </div>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mixedHtml,
    });

    const jobs = await source.fetchJobs({ jobTitle: 'تطوير' });

    // Only the Laravel web project should pass
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('بناء متجر إلكتروني باستخدام Laravel');
  });

  it('filters out closed or completed projects', async () => {
    const statusHtml = `
      <div class="projects-list">
        <div class="project-card">
          <h2><a href="/project/201">تطوير تطبيق فلاتر</a></h2>
          <p class="project-brief">تطبيق يعمل على أندرويد و iOS</p>
          <span class="project__status">مرحلة تلقي العروض</span>
        </div>
        <div class="project-card">
          <h2><a href="/project/202">تطوير واجهة React</a></h2>
          <p class="project-brief">مشروع تم إغلاقه</p>
          <span class="project__status">مغلق</span>
        </div>
        <div class="project-card">
          <h2><a href="/project/203">برمجة بوت ذكاء اصطناعي</a></h2>
          <p class="project-brief">مشروع منتهي</p>
          <span class="project__status">مكتمل</span>
        </div>
      </div>
    `;

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/projects?')) {
        return { ok: true, text: async () => statusHtml };
      }
      return {
        ok: true,
        text: async () =>
          `<div id="project-details">تفاصيل تطبيق فلاتر</div><div class="project-status">مرحلة تلقي العروض</div>`,
      };
    });

    const jobs = await source.fetchJobs({ jobTitle: 'تطوير' });

    // Only the open project should pass
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('تطوير تطبيق فلاتر');
  });

  it('enriches candidate projects by fetching project page and extracting real skill tags', async () => {
    const listHtml = `
      <div class="projects-list">
        <div class="project-card">
          <h2><a href="/project/301-custom-portal">بناء بوابة دفع إلكترونية</a></h2>
          <p class="project-brief">موجز أولي من البطاقة.</p>
        </div>
      </div>
    `;

    const detailHtml = `
      <div id="project-details">
        <p>الوصف الكامل للمشروع: نبحث عن مهندس متمرس لربط بوابات دفع متعددة وتأمين المعاملات المالية.</p>
      </div>
      <div class="skills">
        <a href="/skills/nodejs">Node.js</a>
        <a href="/skills/stripe">Stripe</a>
        <a href="/skills/postgresql">PostgreSQL</a>
      </div>
      <div class="project-status">مرحلة تلقي العروض</div>
    `;

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/projects?')) {
        return { ok: true, text: async () => listHtml };
      }
      return { ok: true, text: async () => detailHtml };
    });

    const jobs = await source.fetchJobs({ jobTitle: 'تطوير' });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('بناء بوابة دفع إلكترونية');
    expect(jobs[0].description).toContain('الوصف الكامل للمشروع');
    expect(jobs[0].skills).toEqual(['Node.js', 'Stripe', 'PostgreSQL']);
  });

  it('should handle HTML fetch failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
    const jobs = await source.fetchJobs({ jobTitle: 'developer' });
    expect(jobs).toEqual([]);
  });
});

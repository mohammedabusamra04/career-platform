import * as cheerio from 'cheerio';

import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

/**
 * Scrapes Mostaql freelance projects.
 * Selectors adapted from Daily_Jobs_Bot tools/mostaqlJobs.js.
 */
export class MostaqlJobSource implements JobSource {
  public readonly type = JobSourceType.MOSTAQEL;
  public readonly displayName = { ar: 'مستقل (Mostaql)', en: 'Mostaql' };

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'برمجة' };
    const searchKeyword = effectiveQuery.jobTitle.trim();
    const url = `https://mostaql.com/projects?filter[query]=${encodeURIComponent(searchKeyword)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return this.parseProjects(html, effectiveQuery);
    } catch (err: unknown) {
      logger.warn(`[MostaqlJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseProjects(html: string, query: JobSearchQuery): Job[] {
    const $ = cheerio.load(html);
    const jobs: Job[] = [];

    $('.project-card, .project-row, li.media').each((_, el) => {
      if (jobs.length >= 15) {
        return;
      }

      const titleEl = $(el).find('h2 a, .project-title a, a.o-card__title, h2.card--title a').first();
      const title = titleEl.text().trim();
      let link = titleEl.attr('href');
      if (link && !link.startsWith('http')) {
        link = `https://mostaql.com${link}`;
      }

      const description =
        $(el)
          .find('.project-brief, .project__brief, .o-card__description, .card--desc, p')
          .first()
          .text()
          .trim()
          .slice(0, 400) || title;

      if (!title || !link) {
        return;
      }

      jobs.push({
        title,
        company: 'مستقل (مشروع فريلانس)',
        source: JobSourceType.MOSTAQEL,
        applicationUrl: link,
        url: link,
        location: 'عن بعد (Freelance)',
        country: 'الشرق الأوسط / عن بعد',
        remote: true,
        workType: WorkType.REMOTE,
        experienceLevel: query.experienceLevel || ExperienceLevel.MID,
        description,
        skills: query.skills || [],
        publicationDate: new Date(),
        publishedAt: new Date(),
        scrapedAt: new Date(),
      });
    });

    return jobs;
  }
}

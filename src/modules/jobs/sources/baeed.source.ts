import * as cheerio from 'cheerio';
import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import { BaseJobSource } from './base.source.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

/**
 * Scrapes Baeed.com (Hsoub's dedicated Arabic remote jobs platform).
 * All postings on Baeed are 100% remote positions tailored for the Arab world.
 */
export class BaeedJobSource extends BaseJobSource {
  public readonly type = JobSourceType.BAEED;
  public readonly displayName = { ar: 'بعيد (Baeed)', en: 'Baeed' };
  private readonly baseUrl = 'https://baeed.com';

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const keyword = query?.jobTitle?.trim() || '';
    const url = keyword
      ? `${this.baseUrl}/jobs?q=${encodeURIComponent(keyword)}`
      : `${this.baseUrl}/jobs`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return this.parseJobs(html, query);
    } catch (err: unknown) {
      logger.warn(`[BaeedJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseJobs(html: string, query?: JobSearchQuery): Job[] {
    const $ = cheerio.load(html);
    const jobs: Job[] = [];

    $('.job-item, .job-card, article.job, li.job-item').each((_, el) => {
      if (jobs.length >= 15) {
        return;
      }

      const titleEl = $(el)
        .find('h2 a, h3 a, a.job-link, a[href*="/jobs/"]')
        .first();
      const title = titleEl.text().trim();
      let link = titleEl.attr('href');

      if (!title || !link) {
        return;
      }

      if (!link.startsWith('http')) {
        link = `${this.baseUrl}${link.startsWith('/') ? '' : '/'}${link}`;
      }

      const company =
        $(el)
          .find('.company-name a, .company-name, .company-title, a[href*="/companies/"], span[class*="company"]')
          .first()
          .text()
          .trim() || 'شركة في بعيد';

      const description =
        $(el)
          .find('.job-snippet, .description, p, .job-desc')
          .first()
          .text()
          .trim() || `${title} - وظيفة عن بعد عبر منصة بعيد`;

      jobs.push({
        title,
        company,
        source: JobSourceType.BAEED,
        applicationUrl: link,
        url: link,
        location: 'عن بعد (الوطن العربي)',
        country: undefined,
        remote: true,
        workType: WorkType.REMOTE,
        experienceLevel: ExperienceLevel.UNKNOWN,
        description,
        skills: query?.skills || [],
        publicationDate: new Date(),
        publishedAt: new Date(),
        scrapedAt: new Date(),
      });
    });

    return jobs;
  }
}

import * as cheerio from 'cheerio';
import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import { BaseJobSource } from './base.source.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

/**
 * Scrapes Naukrigulf.com (primary job search portal in the GCC / Gulf region).
 * Covers Saudi Arabia, UAE, Qatar, Kuwait, Bahrain, and Oman.
 */
export class NaukrigulfJobSource extends BaseJobSource {
  public readonly type = JobSourceType.NARIGULF;
  public readonly displayName = { ar: 'نوكري جلف (Naukrigulf)', en: 'Naukrigulf' };
  private readonly baseUrl = 'https://www.naukrigulf.com';

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const keyword = query?.jobTitle?.trim() || '';
    const url = keyword
      ? `${this.baseUrl}/${encodeURIComponent(keyword)}-jobs`
      : `${this.baseUrl}/jobs-in-gulf`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return this.parseJobs(html, query);
    } catch (err: unknown) {
      logger.warn(`[NaukrigulfJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseJobs(html: string, query?: JobSearchQuery): Job[] {
    const $ = cheerio.load(html);
    const jobs: Job[] = [];

    $('article.ng-job-tuple, .job-tuple').each((_, el) => {
      if (jobs.length >= 15) {
        return;
      }

      const titleEl = $(el)
        .find('a.title, a.job-title-link, h2.title a, h2 a, a[href*="job-listings"]')
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
          .find('.company-name, .org-name, a[class*="company"], span[class*="company"]')
          .first()
          .text()
          .trim() || 'Gulf Employer';

      const location =
        $(el)
          .find('.location, .loc, span[class*="loc"], .exp-loc')
          .first()
          .text()
          .trim() ||
        query?.location ||
        'Gulf Region / Middle East';

      const description =
        $(el)
          .find('.job-desc, .desc, p, .snippet')
          .first()
          .text()
          .trim() || `${title} at ${company} in ${location}`;

      const isRemote =
        query?.workType === WorkType.REMOTE ||
        /remote|عن بعد/i.test(`${title} ${location} ${description}`);

      jobs.push({
        title,
        company,
        source: JobSourceType.NARIGULF,
        applicationUrl: link,
        url: link,
        location,
        country: undefined,
        remote: isRemote,
        workType: isRemote ? WorkType.REMOTE : query?.workType || WorkType.ON_SITE,
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

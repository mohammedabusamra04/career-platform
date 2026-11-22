import * as cheerio from 'cheerio';

import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

/**
 * Scrapes Bayt.com job listings.
 * Selectors adapted from Daily_Jobs_Bot tools/baytJobs.js.
 */
export class BaytJobSource implements JobSource {
  public readonly type = JobSourceType.BAYT;

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Developer' };
    const url = `https://www.bayt.com/en/jobs/?q=${encodeURIComponent(effectiveQuery.jobTitle.trim())}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return this.parseJobs(html, effectiveQuery);
    } catch (err: unknown) {
      logger.warn(`[BaytJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseJobs(html: string, query: JobSearchQuery): Job[] {
    const $ = cheerio.load(html);
    const jobs: Job[] = [];

    $('li[data-js-job], .has-pointer-d').each((_, el) => {
      if (jobs.length >= 15) {
        return;
      }

      const titleEl = $(el).find('h2 a, a[data-js-aid="jobID"]').first();
      const title = titleEl.text().trim();
      let link = titleEl.attr('href');
      if (link && !link.startsWith('http')) {
        link = `https://www.bayt.com${link}`;
      }

      const company =
        $(el).find('.t-nowrap.p10l a, b.t-nowrap, b[class*="company"]').first().text().trim() ||
        'Bayt Employer';

      const location =
        $(el).find('.t-mute.t-small, span.t-mute').first().text().trim() ||
        query.location ||
        'Middle East';

      if (!title || !link) {
        return;
      }

      const isRemote =
        query.workType === WorkType.REMOTE || /remote|عن بعد/i.test(`${title} ${location}`);

      jobs.push({
        title,
        company,
        source: JobSourceType.BAYT,
        applicationUrl: link,
        url: link,
        location,
        country: location,
        remote: isRemote,
        workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.ON_SITE,
        experienceLevel: query.experienceLevel || ExperienceLevel.MID,
        description: `${title} at ${company} in ${location}`,
        skills: query.skills || [],
        publicationDate: new Date(),
        publishedAt: new Date(),
        scrapedAt: new Date(),
      });
    });

    return jobs;
  }
}

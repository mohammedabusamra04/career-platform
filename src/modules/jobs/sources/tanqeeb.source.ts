import * as cheerio from 'cheerio';

import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import { BaseJobSource } from './base.source.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

/**
 * Scrapes Tanqeeb (MENA/Arabic job search engine).
 */
export class TanqeebJobSource extends BaseJobSource {
  public readonly type = JobSourceType.TANQEEB;
  public readonly displayName = { ar: 'تنقيب (Tanqeeb)', en: 'Tanqeeb' };

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Developer' };
    const searchTerm = effectiveQuery.jobTitle.trim();
    const url = `https://www.tanqeeb.com/en/jobs/search?keywords=${encodeURIComponent(searchTerm)}`;

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
      return this.parseJobs(html, effectiveQuery);
    } catch (err: unknown) {
      logger.warn(`[TanqeebJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseJobs(html: string, query: JobSearchQuery): Job[] {
    const $ = cheerio.load(html);
    const jobs: Job[] = [];
    const seenUrls = new Set<string>();

    $('.card-list-item, .job-listing, .card-item, article').each((_, el) => {
      if (jobs.length >= 15) {
        return;
      }

      const titleEl = $(el)
        .find('.search-job-title a, h2 a, .card-title a, a[href*=".html"], a[href*="/jobs/"], a[href*="/job/"]')
        .first();
      const title = titleEl.text().trim();
      let link = titleEl.attr('href');

      if (!title || !link) {
        return;
      }

      // Filter out non-job navigation links, category pages, search filters, and share URLs
      const isNavOrCategory = /job_list|with-salaries|search\?|create_job|create_widget|change_lang|order_by|sharer|\/s\/jobs\//i.test(link);
      const isNavTitle = /^(manage my jobs|reset filter|jobs with salaries|add job|العربية|most recent|relevance)$/i.test(title);
      if (isNavOrCategory || isNavTitle) {
        return;
      }

      if (!link.startsWith('http')) {
        link = `https://www.tanqeeb.com${link.startsWith('/') ? '' : '/'}${link}`;
      }

      if (seenUrls.has(link)) {
        return;
      }
      seenUrls.add(link);

      const company =
        $(el)
          .find('.search-job-company-name, .card-company, .company, span[class*="company"], .t-company')
          .first()
          .text()
          .trim() || 'Tanqeeb Employer';

      const location =
        $(el)
          .find('.search-job-workplace-location, .card-location, .location, span[class*="location"], .t-location')
          .first()
          .text()
          .trim() ||
        query.location ||
        'Middle East';

      const description =
        $(el).find('.job-card-description-source, .card-desc, p, .snippet').first().text().trim() ||
        `${title} at ${company} in ${location}`;

      const isRemote =
        query.workType === WorkType.REMOTE ||
        /remote|عن بعد/i.test(`${title} ${location} ${description}`);

      jobs.push({
        title,
        company,
        source: JobSourceType.TANQEEB,
        applicationUrl: link,
        url: link,
        location,
        country: location,
        remote: isRemote,
        workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.ON_SITE,
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

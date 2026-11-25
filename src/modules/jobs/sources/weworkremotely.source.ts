import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import { BaseJobSource } from './base.source.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

export class WeWorkRemotelyJobSource extends BaseJobSource {
  public readonly type = JobSourceType.WE_WORK_REMOTELY;
  public readonly displayName = { ar: 'وي وورك ريموتلي (We Work Remotely)', en: 'We Work Remotely' };
  private readonly feedUrl =
    'https://weworkremotely.com/categories/remote-programming-jobs.rss';

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    try {
      const response = await fetch(this.feedUrl, {
        headers: {
          'User-Agent': 'AICareerPlatform/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const xml = await response.text();
      return this.parseRss(xml, query);
    } catch (err: unknown) {
      logger.warn(`[WeWorkRemotelyJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private parseRss(xml: string, query?: JobSearchQuery): Job[] {
    const items: Job[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    const keywords = [query?.jobTitle, ...(query?.skills || [])]
      .filter((k): k is string => Boolean(k))
      .map((k) => k.toLowerCase());

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];

      const rawTitle = this.extractTag(itemContent, 'title');
      const link = this.extractTag(itemContent, 'link');
      const pubDateStr = this.extractTag(itemContent, 'pubDate');
      const rawDescription = this.extractTag(itemContent, 'description');

      if (!rawTitle || !link) {
        continue;
      }

      // Title usually formatted as "Company: Job Title"
      let company = 'We Work Remotely';
      let title = rawTitle;
      if (rawTitle.includes(':')) {
        const parts = rawTitle.split(':');
        company = parts[0].trim();
        title = parts.slice(1).join(':').trim();
      }

      const cleanDescription = rawDescription
        .replace(/<[^>]*>?/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const combinedText = `${title} ${cleanDescription}`.toLowerCase();
      const matchesKeyword =
        keywords.length === 0 || keywords.some((k) => combinedText.includes(k));

      if (!matchesKeyword) {
        continue;
      }

      const pubDate = new Date(pubDateStr);
      const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;

      items.push({
        title,
        company,
        source: JobSourceType.WE_WORK_REMOTELY,
        applicationUrl: link,
        url: link,
        location: 'Remote',
        remote: true,
        workType: WorkType.REMOTE,
        experienceLevel: ExperienceLevel.UNKNOWN,
        description: cleanDescription,
        skills: query?.skills || [],
        publicationDate: validPubDate,
        publishedAt: validPubDate,
        scrapedAt: new Date(),
      });
    }

    return items;
  }

  private extractTag(content: string, tag: string): string {
    const cdataRegex = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
    const cdataMatch = cdataRegex.exec(content);
    if (cdataMatch) {
      return cdataMatch[1].trim();
    }

    const standardRegex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const standardMatch = standardRegex.exec(content);
    if (standardMatch) {
      return standardMatch[1].trim();
    }

    return '';
  }
}

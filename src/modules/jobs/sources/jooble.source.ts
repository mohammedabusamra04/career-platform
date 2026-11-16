import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface JoobleJobItem {
  id?: string | number;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
}

interface JoobleApiResponse {
  totalCount?: number;
  jobs?: JoobleJobItem[];
}

export class JoobleJobSource implements JobSource {
  public readonly type = JobSourceType.JOOBLE;

  constructor(private readonly apiKey: string) {}

  async fetchJobs(query: JobSearchQuery): Promise<Job[]> {
    if (!this.apiKey) {
      return [];
    }

    const url = `https://jooble.org/api/${this.apiKey}`;
    const payload = {
      keywords: query.jobTitle.trim(),
      location: query.location || 'Remote',
      page: 1,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AICareerPlatform/1.0',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as JoobleApiResponse;

      if (!data || !Array.isArray(data.jobs)) {
        return [];
      }

      return data.jobs.map((item) => this.mapToJob(item, query));
    } catch (err: unknown) {
      logger.warn(`[JoobleJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: JoobleJobItem, query: JobSearchQuery): Job {
    const cleanTitle = (item.title || query.jobTitle)
      .replace(/<[^>]*>?/gm, '')
      .trim();

    const cleanSnippet = (item.snippet || '')
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const location = item.location || 'Remote';
    const isRemote =
      /remote|عن بعد|telecommute/i.test(`${cleanTitle} ${location} ${cleanSnippet}`);

    const pubDate = item.updated ? new Date(item.updated) : new Date();
    const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
    const applicationUrl = item.link || 'https://jooble.org';

    return {
      title: cleanTitle,
      company: item.company || item.source || 'Jooble Employer',
      source: JobSourceType.JOOBLE,
      applicationUrl,
      url: applicationUrl,
      location,
      country: location,
      remote: isRemote,
      workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.HYBRID,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: cleanSnippet || `${cleanTitle} at ${item.company || 'Employer'}`,
      skills: query.skills || [],
      publicationDate: validPubDate,
      publishedAt: validPubDate,
      scrapedAt: new Date(),
    };
  }
}

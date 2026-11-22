import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface ArbeitnowJobItem {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number | string;
}

interface ArbeitnowApiResponse {
  data?: ArbeitnowJobItem[];
  links?: {
    next?: string;
  };
}

export class ArbeitnowJobSource implements JobSource {
  public readonly type = JobSourceType.ARBEITNOW;
  public readonly displayName = { ar: 'أربايتناو (Arbeitnow)', en: 'Arbeitnow' };
  private readonly apiUrl = 'https://www.arbeitnow.com/api/job-board-api';

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Developer' };
    try {
      const response = await fetch(this.apiUrl, {
        headers: {
          'User-Agent': 'AICareerPlatform/1.0 (JobAgent)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as ArbeitnowApiResponse;

      if (!data || !Array.isArray(data.data)) {
        return [];
      }

      const keywords = [effectiveQuery.jobTitle, ...(effectiveQuery.skills || [])]
        .filter(Boolean)
        .map((k) => (k as string).toLowerCase().trim());

      const filtered = data.data.filter((item) => {
        if (!item.title || !item.url) {
          return false;
        }

        if (keywords.length === 0) {
          return true;
        }

        const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
        const combined = `${item.title} ${item.company_name || ''} ${tagsText} ${item.location || ''}`.toLowerCase();

        return keywords.some((k) => combined.includes(k));
      });

      return filtered.slice(0, 20).map((item) => this.mapToJob(item, effectiveQuery));
    } catch (err: unknown) {
      logger.warn(`[ArbeitnowJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: ArbeitnowJobItem, query: JobSearchQuery): Job {
    const cleanDescription = (item.description || '')
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let pubDate = new Date();
    if (item.created_at) {
      if (typeof item.created_at === 'number') {
        pubDate = new Date(item.created_at * 1000);
      } else {
        pubDate = new Date(item.created_at);
      }
    }
    const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
    const isRemote = Boolean(item.remote);
    const jobUrl = item.url || 'https://www.arbeitnow.com';

    return {
      title: item.title || query.jobTitle,
      company: item.company_name || 'Arbeitnow Employer',
      source: JobSourceType.ARBEITNOW,
      applicationUrl: jobUrl,
      url: jobUrl,
      location: item.location || (isRemote ? 'Remote (Worldwide)' : 'Europe'),
      country: item.location || (isRemote ? 'Remote' : 'Europe'),
      remote: isRemote,
      workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.HYBRID,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: cleanDescription || `${item.title} at ${item.company_name}`,
      skills: Array.isArray(item.tags) ? item.tags : query.skills || [],
      publicationDate: validPubDate,
      publishedAt: validPubDate,
      scrapedAt: new Date(),
    };
  }
}

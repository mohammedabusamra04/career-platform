import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface AdzunaJobItem {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
  company?: {
    display_name?: string;
  };
  location?: {
    display_name?: string;
    area?: string[];
  };
  contract_time?: string;
  contract_type?: string;
}

interface AdzunaApiResponse {
  results?: AdzunaJobItem[];
  count?: number;
}

export class AdzunaJobSource implements JobSource {
  public readonly type = JobSourceType.ADZUNA;

  constructor(
    private readonly appId: string,
    private readonly appKey: string,
    private readonly country = 'gb',
  ) {}

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    if (!this.appId || !this.appKey) {
      return [];
    }

    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Software Engineer' };
    const searchTerm = effectiveQuery.jobTitle.trim();
    const url = `https://api.adzuna.com/v1/api/jobs/${this.country}/search/1?app_id=${encodeURIComponent(
      this.appId,
    )}&app_key=${encodeURIComponent(
      this.appKey,
    )}&what=${encodeURIComponent(searchTerm)}&content-type=application/json&results_per_page=20&max_days_old=3`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AICareerPlatform/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as AdzunaApiResponse;

      if (!data || !Array.isArray(data.results)) {
        return [];
      }

      return data.results.map((item) => this.mapToJob(item, effectiveQuery));
    } catch (err: unknown) {
      logger.warn(`[AdzunaJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: AdzunaJobItem, query: JobSearchQuery): Job {
    const cleanTitle = (item.title || query.jobTitle)
      .replace(/<[^>]*>?/gm, '')
      .trim();

    const cleanDescription = (item.description || '')
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const locationName = item.location?.display_name || 'United Kingdom';
    const isRemote =
      /remote|work from home|telecommute/i.test(`${cleanTitle} ${cleanDescription} ${locationName}`);

    const pubDate = item.created ? new Date(item.created) : new Date();
    const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
    const applicationUrl = item.redirect_url || 'https://www.adzuna.com';

    return {
      title: cleanTitle,
      company: item.company?.display_name || 'Adzuna Employer',
      source: JobSourceType.ADZUNA,
      applicationUrl,
      url: applicationUrl,
      location: locationName,
      country: item.location?.area?.[0] || 'United Kingdom',
      remote: isRemote,
      workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.HYBRID,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: cleanDescription || `${cleanTitle} in ${locationName}`,
      skills: query.skills || [],
      publicationDate: validPubDate,
      publishedAt: validPubDate,
      salaryMin: typeof item.salary_min === 'number' ? item.salary_min : undefined,
      salaryMax: typeof item.salary_max === 'number' ? item.salary_max : undefined,
      currency: 'GBP',
      scrapedAt: new Date(),
    };
  }
}

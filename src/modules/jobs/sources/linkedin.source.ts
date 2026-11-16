import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface JSearchJobItem {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_city?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
  job_required_skills?: string[];
}

interface JSearchApiResponse {
  status?: string;
  data?: JSearchJobItem[] | {
    jobs?: JSearchJobItem[];
  };
}

export class LinkedinJobSource implements JobSource {
  public readonly type = JobSourceType.LINKEDIN;

  constructor(private readonly apiKey: string) {}

  async fetchJobs(query: JobSearchQuery): Promise<Job[]> {
    if (!this.apiKey) {
      return [];
    }

    const searchQuery = [query.jobTitle, query.location || 'Remote']
      .filter(Boolean)
      .join(' in ');

    const url = `https://jsearch.p.rapidapi.com/search-v2?query=${encodeURIComponent(
      searchQuery,
    )}`;

    try {
      const response = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as JSearchApiResponse;

      const jobsList: JSearchJobItem[] = Array.isArray(data.data)
        ? data.data
        : data.data && typeof data.data === 'object' && Array.isArray(data.data.jobs)
          ? data.data.jobs
          : [];

      return jobsList.map((item) => this.mapToJob(item, query));
    } catch (err: unknown) {
      logger.warn(`[LinkedInJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: JSearchJobItem, query: JobSearchQuery): Job {
    const pubDate = item.job_posted_at_datetime_utc
      ? new Date(item.job_posted_at_datetime_utc)
      : new Date();
    const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
    const applicationUrl =
      item.job_apply_link || item.job_google_link || 'https://www.linkedin.com/jobs';

    return {
      title: item.job_title || query.jobTitle,
      company: item.employer_name || 'LinkedIn Employer',
      source: JobSourceType.LINKEDIN,
      applicationUrl,
      url: applicationUrl,
      location: item.job_city || (item.job_is_remote ? 'Remote' : 'Worldwide'),
      country: item.job_country || undefined,
      remote: Boolean(item.job_is_remote),
      workType: item.job_is_remote ? WorkType.REMOTE : query.workType || WorkType.ON_SITE,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: item.job_description || item.job_title || '',
      skills: Array.isArray(item.job_required_skills) ? item.job_required_skills : query.skills || [],
      publicationDate: validPubDate,
      publishedAt: validPubDate,
      scrapedAt: new Date(),
    };
  }
}

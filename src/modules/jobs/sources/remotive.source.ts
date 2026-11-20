import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface RemotiveJobItem {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date: string;
  candidate_required_location?: string;
  description?: string;
}

interface RemotiveApiResponse {
  jobs: RemotiveJobItem[];
}

export class RemotiveJobSource implements JobSource {
  public readonly type = JobSourceType.REMOTIVE;

  async fetchJobs(query: JobSearchQuery): Promise<Job[]> {
    const searchTerm = query.jobTitle.trim();
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchTerm)}`;

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

      const data = (await response.json()) as RemotiveApiResponse;

      if (!data || !Array.isArray(data.jobs)) {
        return [];
      }

      return data.jobs.map((item) => this.mapToJob(item, query));
    } catch (err: unknown) {
      logger.warn(`[RemotiveJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: RemotiveJobItem, query: JobSearchQuery): Job {
    const cleanDescription = (item.description || '')
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const pubDate = new Date(item.publication_date);
    const validPubDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
    const applicationUrl = item.url || 'https://remotive.com';

    return {
      title: item.title,
      company: item.company_name || 'Remote Company',
      source: JobSourceType.REMOTIVE,
      applicationUrl,
      url: applicationUrl,
      location: item.candidate_required_location || 'Remote (Worldwide)',
      country: item.candidate_required_location || undefined,
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: cleanDescription,
      skills: Array.isArray(item.tags) ? item.tags : [],
      publicationDate: validPubDate,
      publishedAt: validPubDate,
      scrapedAt: new Date(),
    };
  }
}

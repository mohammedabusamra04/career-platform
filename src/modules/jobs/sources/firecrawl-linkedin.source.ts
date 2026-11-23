import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import { BaseJobSource } from './base.source.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

interface FirecrawlJobItem {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    extract?: {
      jobs?: FirecrawlJobItem[];
    };
    markdown?: string;
  };
  error?: string;
}

export class FirecrawlLinkedInSource extends BaseJobSource {
  public readonly type = JobSourceType.LINKEDIN;
  public readonly displayName = { ar: 'لينكدإن (LinkedIn)', en: 'LinkedIn' };

  constructor(private readonly apiKey?: string) {
    super();
  }

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    if (!this.apiKey || !this.apiKey.trim()) {
      return [];
    }

    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Developer', location: 'Remote' };
    const searchTerm = encodeURIComponent(effectiveQuery.jobTitle.trim());
    const locationTerm = encodeURIComponent(effectiveQuery.location || 'Worldwide');
    const linkedinUrl = `https://www.linkedin.com/jobs/search?keywords=${searchTerm}&location=${locationTerm}&f_TPR=r86400&position=1&pageNum=0`;

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: linkedinUrl,
          formats: ['extract'],
          extract: {
            schema: {
              type: 'object',
              properties: {
                jobs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      company: { type: 'string' },
                      location: { type: 'string' },
                      url: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['title', 'company'],
                  },
                },
              },
            },
            prompt:
              'Extract job postings from LinkedIn jobs search results with title, company, location, URL, and a short description.',
          },
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        return [];
      }

      const result = (await response.json()) as FirecrawlScrapeResponse;
      if (!result.success || !result.data?.extract?.jobs) {
        return [];
      }

      const extractedJobs = result.data.extract.jobs;
      return extractedJobs
        .filter((item) => Boolean(item.title && item.company))
        .map((item) => this.mapToJob(item, effectiveQuery));
    } catch (err: unknown) {
      logger.warn(`[FirecrawlLinkedInSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  private mapToJob(item: FirecrawlJobItem, query: JobSearchQuery): Job {
    const title = item.title?.trim() || query.jobTitle;
    const company = item.company?.trim() || 'LinkedIn Employer';
    const location = item.location?.trim() || query.location || 'Worldwide';
    const link = item.url && item.url.startsWith('http') ? item.url : 'https://www.linkedin.com/jobs';

    const isRemote =
      query.workType === WorkType.REMOTE || /remote|عن بعد/i.test(`${title} ${location}`);

    return {
      title,
      company,
      source: JobSourceType.LINKEDIN,
      applicationUrl: link,
      url: link,
      location,
      country: location,
      remote: isRemote,
      workType: isRemote ? WorkType.REMOTE : query.workType || WorkType.HYBRID,
      experienceLevel: query.experienceLevel || ExperienceLevel.MID,
      description: item.description?.trim() || `${title} at ${company} in ${location}`,
      skills: query.skills || [],
      publicationDate: new Date(),
      publishedAt: new Date(),
      scrapedAt: new Date(),
    };
  }
}

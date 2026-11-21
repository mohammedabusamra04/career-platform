import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import logger from '../../../shared/utils/logger.js';

export interface JoobleJobItem {
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

export interface JoobleApiResponse {
  totalCount?: number;
  jobs?: JoobleJobItem[];
}

export const EXPIRED_JOB_PHRASES = [
  'the job position is no longer available',
  'this job is no longer available',
  'no longer accepting applications',
  'job has expired',
] as const;

export const DEFAULT_MAX_AGE_DAYS = 7;
export const DEFAULT_MAX_AGE_MS = DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_LINK_TIMEOUT_MS = 3500;
export const DEFAULT_CONCURRENCY = 5;

/**
 * Validates whether an item's updated date is within the allowed freshness window.
 */
export function isItemFresh(
  updated?: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  now: number = Date.now(),
): boolean {
  if (!updated || typeof updated !== 'string') {
    return false;
  }
  const date = new Date(updated);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  const age = now - time;
  return age <= maxAgeMs;
}

/**
 * Validates that an item link is a valid, specific URL and not just the generic Jooble homepage.
 */
export function isValidSpecificLink(link?: string): boolean {
  if (!link || typeof link !== 'string') {
    return false;
  }
  const trimmed = link.trim();
  if (!trimmed) {
    return false;
  }
  if (/^https?:\/\/(?:www\.)?jooble\.org\/?$/i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates that an item's URL parameters (e.g. jobAge) do not exceed the allowed maximum age.
 */
export function isJobAgeFresh(
  url?: string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): boolean {
  if (!url || typeof url !== 'string') return true;
  try {
    const parsed = new URL(url);
    const ageParam = parsed.searchParams.get('jobAge');
    if (ageParam !== null) {
      const ageDays = parseInt(ageParam, 10);
      if (!Number.isNaN(ageDays) && ageDays > maxAgeDays) {
        return false;
      }
    }
  } catch {
    return true;
  }
  return true;
}

/**
 * Checks whether an application URL is active and not an HTTP 404/410 or soft-404 expired page.
 * Network/rate-limit errors or timeouts fail gracefully (returns true) so the pipeline and circuit breaker
 * are not tripped unnecessarily.
 */
export async function isJobLinkActive(
  url: string,
  timeoutMs: number = DEFAULT_LINK_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });

    if (response.status === 404 || response.status === 410) {
      logger.info(`[JoobleJobSource] Filtering dead link (HTTP ${response.status}): ${url}`);
      return false;
    }

    if (!response.ok) {
      logger.debug(`[JoobleJobSource] Non-fatal HTTP status ${response.status} when verifying ${url}`);
      return true;
    }

    const html = typeof response.text === 'function' ? await response.text() : '';
    const lowerHtml = html.toLowerCase();

    for (const phrase of EXPIRED_JOB_PHRASES) {
      if (lowerHtml.includes(phrase)) {
        logger.info(
          `[JoobleJobSource] Filtering soft-404 expired job ("${phrase}"): ${url}`,
        );
        return false;
      }
    }

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`[JoobleJobSource] Link check failed gracefully for ${url}: ${message}`);
    return true;
  }
}

/**
 * Runs an async predicate across items with bounded concurrency.
 */
export async function filterConcurrent<T>(
  items: T[],
  concurrency: number,
  predicate: (item: T) => Promise<boolean>,
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }
  const results: boolean[] = new Array(items.length);
  let index = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = await predicate(items[i]);
        } catch {
          results[i] = true;
        }
      }
    },
  );

  await Promise.all(workers);
  return items.filter((_, i) => results[i]);
}

export interface JoobleJobSourceOptions {
  maxAgeDays?: number; // default: 7 (set to 0 to disable age filtering)
  verifyLinks?: boolean; // default: true
  linkTimeoutMs?: number; // default: 3500
  concurrency?: number; // default: 5
}

export class JoobleJobSource implements JobSource {
  public readonly type = JobSourceType.JOOBLE;
  private readonly maxAgeDays: number;
  private readonly verifyLinks: boolean;
  private readonly linkTimeoutMs: number;
  private readonly concurrency: number;

  constructor(
    private readonly apiKey: string,
    options: JoobleJobSourceOptions = {},
  ) {
    this.maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    this.verifyLinks = options.verifyLinks ?? true;
    this.linkTimeoutMs = options.linkTimeoutMs ?? DEFAULT_LINK_TIMEOUT_MS;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    if (!this.apiKey) {
      return [];
    }

    const effectiveQuery: JobSearchQuery = query ?? { jobTitle: 'Developer', location: 'Remote' };
    const url = `https://jooble.org/api/${this.apiKey}`;
    const now = Date.now();
    const dateFrom = new Date(now - this.maxAgeDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const payload: Record<string, unknown> = {
      keywords: effectiveQuery.jobTitle.trim(),
      location: effectiveQuery.location || 'Remote',
      page: 1,
    };

    if (this.maxAgeDays > 0) {
      payload.datecreatedfrom = dateFrom;
    }

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

      const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000;

      // 1. Freshness filtering & valid specific link requirement
      const freshItems = data.jobs.filter((item) => {
        if (this.maxAgeDays > 0 && !isItemFresh(item.updated, maxAgeMs, now)) {
          return false;
        }
        if (!isValidSpecificLink(item.link)) {
          return false;
        }
        if (this.maxAgeDays > 0 && !isJobAgeFresh(item.link, this.maxAgeDays)) {
          return false;
        }
        return true;
      });

      const candidateJobs = freshItems.map((item) => this.mapToJob(item, effectiveQuery));

      // 2. Active Link & Soft-404 Verification with bounded concurrency
      if (!this.verifyLinks || candidateJobs.length === 0) {
        return candidateJobs;
      }

      return await filterConcurrent(
        candidateJobs,
        this.concurrency,
        async (job) => isJobLinkActive(job.applicationUrl, this.linkTimeoutMs),
      );
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
    const applicationUrl = item.link!.trim();

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

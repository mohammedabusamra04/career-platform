import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import ms from 'ms';
import type { Cache, ICache } from '../../cache/cache.interface.js';
import { cacheKeys } from '../../cache/cache.keys.js';
import { CACHE_TTL } from '../../cache/cache.ttl.js';
import logger from '../../shared/utils/logger.js';
import type { Job } from './job.types.js';

export interface JobEnrichedData {
  description?: string;
  experienceRequirements?: string;
  applicantLocationRequirements?: string;
  jobLocationType?: string;
}

export interface JobDetailEnricherOptions {
  concurrency?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

export function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url.trim()).digest('hex');
}

/**
 * Extracts Schema.org JobPosting JSON-LD or fallback article/main description from HTML.
 */
export function extractJobPostingDetails(html: string): JobEnrichedData | null {
  if (!html || !html.trim()) {
    return null;
  }

  const $ = cheerio.load(html);

  // 1. Schema.org JobPosting via JSON-LD
  const scriptTags = $('script[type="application/ld+json"]').toArray();
  for (const script of scriptTags) {
    try {
      const content = $(script).html();
      if (!content || !content.trim()) continue;
      const parsed = JSON.parse(content.trim());
      const candidates: any[] = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue;
        const itemType = item['@type'];
        const isJobPosting =
          itemType === 'JobPosting' ||
          (Array.isArray(itemType) && itemType.includes('JobPosting')) ||
          (typeof itemType === 'string' && itemType.includes('JobPosting'));

        if (isJobPosting) {
          const rawDesc = item.description || '';
          let cleanedDesc = '';
          if (typeof rawDesc === 'string') {
            cleanedDesc = rawDesc.includes('<')
              ? cheerio.load(rawDesc)('body').text().replace(/\s+/g, ' ').trim()
              : rawDesc.replace(/\s+/g, ' ').trim();
          }

          const expReq = item.experienceRequirements
            ? typeof item.experienceRequirements === 'string'
              ? item.experienceRequirements.replace(/\s+/g, ' ').trim()
              : JSON.stringify(item.experienceRequirements)
            : undefined;

          const locReq = item.applicantLocationRequirements
            ? typeof item.applicantLocationRequirements === 'string'
              ? item.applicantLocationRequirements.replace(/\s+/g, ' ').trim()
              : item.applicantLocationRequirements.name ||
                JSON.stringify(item.applicantLocationRequirements)
            : undefined;

          const locType =
            typeof item.jobLocationType === 'string'
              ? item.jobLocationType.replace(/\s+/g, ' ').trim()
              : undefined;

          if (cleanedDesc.length > 50) {
            return {
              description: cleanedDesc,
              experienceRequirements: expReq,
              applicantLocationRequirements: locReq,
              jobLocationType: locType,
            };
          }
        }
      }
    } catch (err: unknown) {
      logger.debug(
        `[JobDetailEnricher] JSON-LD parse warning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Fallback DOM selectors for detailed job description
  const selectors = [
    'main',
    'article',
    '[data-testid="job-description"]',
    '.job-description',
    '#job-description',
    '.job-details',
    '.description',
  ];

  for (const selector of selectors) {
    const el = $(selector);
    if (el.length > 0) {
      const text = el.first().text().replace(/\s+/g, ' ').trim();
      if (text.length >= 100) {
        return { description: text };
      }
    }
  }

  return null;
}

/**
 * Fast streaming fetch that caps response body at maxBytes (default ~40KB).
 */
export async function fetchHtmlSnippet(
  url: string,
  timeoutMs: number = ms('3s'),
  maxBytes: number = 40 * 1024,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok || !response.body) {
      return '';
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        if (receivedBytes >= maxBytes) {
          try {
            await reader.cancel();
          } catch (cancelErr: unknown) {
            logger.debug(
              `[JobDetailEnricher] Reader cancel notice: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`,
            );
          }
          break;
        }
      }
    }

    const combined = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder('utf-8').decode(combined);
  } catch (err: unknown) {
    logger.debug(
      `[JobDetailEnricher] fetchHtmlSnippet failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export class JobDetailEnricher {
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    private readonly cache?: Cache | ICache | null,
    options?: JobDetailEnricherOptions,
  ) {
    this.concurrency = options?.concurrency ?? 8;
    this.timeoutMs = options?.timeoutMs ?? ms('3s');
    this.maxBytes = options?.maxBytes ?? 40 * 1024;
  }

  public async enrichJob<T extends Partial<Job> & { url?: string; applicationUrl?: string | null }>(
    job: T,
  ): Promise<T> {
    const currentDesc = (job.description || '').trim();
    if (currentDesc.length >= 350) {
      return job;
    }

    const targetUrl = job.applicationUrl || job.url;
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return job;
    }

    const hash = hashUrl(targetUrl);
    const cacheKey = cacheKeys.jobEnrichment(hash);

    // 1. Check Redis cache
    if (this.cache) {
      try {
        const cached = await this.cache.get<JobEnrichedData>(cacheKey);
        if (cached && cached.description && cached.description.length > currentDesc.length) {
          job.description = cached.description;
          return job;
        }
      } catch (err: unknown) {
        logger.debug(
          `[JobDetailEnricher] Cache get failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. Live HTTP streaming fetch
    const html = await fetchHtmlSnippet(targetUrl, this.timeoutMs, this.maxBytes);
    if (!html) {
      return job;
    }

    // 3. Extract Schema.org JSON-LD or fallback details
    const details = extractJobPostingDetails(html);
    if (details && details.description && details.description.length > currentDesc.length) {
      job.description = details.description;

      if (this.cache) {
        try {
          await this.cache.set(cacheKey, details, CACHE_TTL.JOB_ENRICHMENT);
        } catch (err: unknown) {
          logger.debug(
            `[JobDetailEnricher] Cache set failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return job;
  }

  public async enrichJobs<T extends Partial<Job> & { url?: string; applicationUrl?: string | null }>(
    jobs: T[],
  ): Promise<T[]> {
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return [];
    }

    const enrichedList: T[] = new Array(jobs.length);
    const queue = jobs.map((job, index) => ({ job, index }));

    const workerCount = Math.min(this.concurrency, jobs.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        try {
          enrichedList[item.index] = await this.enrichJob(item.job);
        } catch (err: unknown) {
          logger.warn(
            `[JobDetailEnricher] Worker enrichment error: ${err instanceof Error ? err.message : String(err)}`,
          );
          enrichedList[item.index] = item.job;
        }
      }
    });

    await Promise.all(workers);
    return enrichedList;
  }
}

export const jobDetailEnricher = new JobDetailEnricher();

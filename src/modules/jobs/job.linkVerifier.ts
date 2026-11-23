import crypto from 'node:crypto';
import ms from 'ms';
import type { Cache, ICache } from '../../cache/cache.interface.js';
import { cacheKeys } from '../../cache/cache.keys.js';
import { CACHE_TTL } from '../../cache/cache.ttl.js';
import logger from '../../shared/utils/logger.js';

export interface JobLivenessResult {
  isAlive: boolean;
  reason?: string;
  statusCode?: number;
  inconclusive?: boolean;
}

export const EXPIRED_JOB_REGEX =
  /\b(?:(?:this|the)\s+(?:job\s+position|job|position|posting|listing)\s+(?:has\s+expired|is\s+no\s+longer\s+available|was\s+removed)|no\s+longer\s+accepting\s+applications|application\s+period\s+has\s+ended|position\s+has\s+been\s+filled|job\s+not\s+found)\b/i;

export const STALE_POSTING_REGEX =
  /\bposted\s+(?:almost\s+)?(?:\d+\s+years?|(?:[2-9]|\d{2,})\s+months?)\s+ago\b/i;

export const CLOSURE_STEM_REGEX =
  /\b(?:expired|no\s+longer\s+(?:available|accepting|open|active)|not\s+available(?:\s+anymore)?|anymore|has\s+been\s+filled|position\s+filled|job\s+not\s+found|listing\s+(?:was\s+)?removed|page\s+not\s+found|404\s+not\s+found|job\s+closed|vacancy\s+closed)\b/i;

export const AGGREGATOR_FALLBACK_PAGE_REGEX =
  /\b(?:adzuna\s+jobs\s+search|search\s+jobs\s+on\s+adzuna|search\s+jobs\s+[-–—:]\s*adzuna|no\s+longer\s+available|this\s+job\s+ad\s+is\s+closed)\b/i;

export const WAF_BLOCK_REGEX =
  /\b(?:access\s+denied|403\s+forbidden|forbidden|edgesuite\.net|cloudflare|attention\s+required|security\s+service|pardon\s+our\s+interruption|request\s+blocked|unauthorized\s+access|geo-?blocked|awswaf|gokuprops|challenge-platform|aws-waf)\b/i;

export const LINK_VERIFIER_TIMEOUT_MS = ms('3.5s');
export const LINK_VERIFIER_SAMPLE_BYTES = 25 * 1024; // ~25KB

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url.trim()).digest('hex');
}

/**
 * Normalizes HTML snippet by stripping markup and collapsing whitespace.
 */
export function normalizeHtmlText(htmlSnippet: string): string {
  return htmlSnippet.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Verifies the liveness of a job application/detail URL.
 * Checks Redis cache first (TTL 24h).
 * Uses native fetch with 3.5s timeout and realistic browser headers.
 * Rejects 404/410, 403 WAF/access-denied block pages, soft-404 expired text, and stale age text.
 */
export async function verifyJobLinkLiveness(
  url: string,
  cache?: Cache | ICache | null,
): Promise<JobLivenessResult> {
  if (!url || !url.startsWith('http')) {
    return { isAlive: false, reason: 'Invalid or missing URL' };
  }

  const hash = hashUrl(url);
  const cacheKey = cacheKeys.linkLiveness(hash);

  // 1. Check Redis cache first
  if (cache) {
    try {
      const cached = await cache.get<JobLivenessResult>(cacheKey);
      if (cached && typeof cached.isAlive === 'boolean') {
        return cached;
      }
    } catch (err: unknown) {
      logger.debug(
        `[JobLinkVerifier] Cache read failed for ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // 2. Perform live HTTP probe
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(LINK_VERIFIER_TIMEOUT_MS),
      redirect: 'follow',
    });

    const status = response.status;

    // Direct HTTP dead status (e.g. 404 Not Found, 410 Gone on euremotejobs)
    if (status === 404 || status === 410) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: `HTTP ${status} (${status === 410 ? 'Gone' : 'Not Found'})`,
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Direct HTTP 202 Accepted with AWS WAF challenge (e.g. career.io anti-bot challenge)
    if (status === 202) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: 202,
        reason: 'WAF anti-bot challenge page detected (HTTP 202 Challenge)',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Check HTTP 403 for WAF / Access Denied block pages (e.g. totaljobs, sherlocktalent, Cloudflare)
    if (status === 403) {
      try {
        const rawHtml = await response.text();
        const htmlSnippet = rawHtml.slice(0, LINK_VERIFIER_SAMPLE_BYTES);
        const text = normalizeHtmlText(htmlSnippet);
        if (text.length < 15000 && WAF_BLOCK_REGEX.test(text)) {
          const result: JobLivenessResult = {
            isAlive: false,
            statusCode: 403,
            reason: 'WAF / Access Denied block page detected (HTTP 403)',
          };
          await saveToCache(cache, cacheKey, result);
          return result;
        }
      } catch (bodyErr: unknown) {
        logger.debug(
          `[JobLinkVerifier] Failed reading 403 response body for ${url}: ${
            bodyErr instanceof Error ? bodyErr.message : String(bodyErr)
          }`,
        );
      }

      return {
        isAlive: true,
        statusCode: 403,
        inconclusive: true,
        reason: 'HTTP 403 protection block (inconclusive, keeping job)',
      };
    }

    // Rate limit -> treat as inconclusive (keep the job)
    if (status === 429) {
      return {
        isAlive: true,
        statusCode: status,
        inconclusive: true,
        reason: `HTTP ${status} protection block (inconclusive, keeping job)`,
      };
    }

    // Read the first ~25KB of HTML response
    const rawHtml = await response.text();
    const htmlSnippet = rawHtml.slice(0, LINK_VERIFIER_SAMPLE_BYTES);
    const text = normalizeHtmlText(htmlSnippet);

    // Check for AWS WAF / Cloudflare anti-bot challenge scripts in HTML
    if (
      rawHtml.includes('awsWafCookieDomainList') ||
      rawHtml.includes('gokuProps') ||
      /window\.(?:awsWaf|gokuProps)/i.test(rawHtml)
    ) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: 'WAF anti-bot challenge page detected in HTML (AWS WAF challenge)',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Structural Stems: inspect <title>, <h1>, <h2>, and normalized headings
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawHtml);
    const titleText = titleMatch ? normalizeHtmlText(titleMatch[1]) : '';

    const h1Matches = Array.from(rawHtml.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi))
      .map((m) => normalizeHtmlText(m[1]))
      .join(' ');

    const h2Matches = Array.from(rawHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))
      .map((m) => normalizeHtmlText(m[1]))
      .join(' ');

    const structuralHeadings = `${titleText} ${h1Matches} ${h2Matches}`.toLowerCase();

    // Check structural headings against closure stems
    if (CLOSURE_STEM_REGEX.test(structuralHeadings)) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: 'Expired/closed job posting indicator found in HTML (heading closure stem)',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Aggregator fallback search page detection (e.g. Adzuna redirects expired ads to "Adzuna Jobs Search")
    const isAdzunaUrl = url.includes('adzuna.');
    const isSearchFallback =
      AGGREGATOR_FALLBACK_PAGE_REGEX.test(structuralHeadings) ||
      (isAdzunaUrl &&
        (/adzuna\s+jobs\s+search/i.test(rawHtml) || response.url.includes('/search')));

    if (isSearchFallback) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: 'Aggregator search fallback page detected (job posting is closed/expired)',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Soft-404 / Expired Job Check (e.g. dailyremote "This Job Has Expired" or short pages with closure stems)
    if (EXPIRED_JOB_REGEX.test(text) || (text.length < 5000 && CLOSURE_STEM_REGEX.test(text))) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: 'Expired/closed job posting indicator found in HTML',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Stale Posting Check (e.g. career.io "Posted almost 2 years ago")
    if (STALE_POSTING_REGEX.test(text)) {
      const result: JobLivenessResult = {
        isAlive: false,
        statusCode: status,
        reason: 'Stale job age indicator found in HTML',
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Job is alive and accessible
    const result: JobLivenessResult = {
      isAlive: true,
      statusCode: status,
    };
    await saveToCache(cache, cacheKey, result);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[JobLinkVerifier] Probe error for ${url}: ${message}`);

    // If an aggregator tracking redirect (e.g. Adzuna) fails with connect timeout or connection refused,
    // the tracking link is broken / unreachable for users.
    if (
      url.includes('adzuna.') &&
      (message.includes('timeout') ||
        message.includes('Timeout') ||
        message.includes('ECONNREFUSED') ||
        message.includes('UND_ERR_CONNECT_TIMEOUT'))
    ) {
      const result: JobLivenessResult = {
        isAlive: false,
        reason: `Aggregator link unreachable or timed out (${message})`,
      };
      await saveToCache(cache, cacheKey, result);
      return result;
    }

    // Timeout or transient network error: treat as inconclusive (keep job)
    return {
      isAlive: true,
      inconclusive: true,
      reason: `Probe exception: ${message} (inconclusive, keeping job)`,
    };
  }
}

async function saveToCache(
  cache: Cache | null | undefined,
  cacheKey: string,
  result: JobLivenessResult,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(cacheKey, result, CACHE_TTL.LINK_LIVENESS);
  } catch (err: unknown) {
    logger.debug(
      `[JobLinkVerifier] Cache write failed for ${cacheKey}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Filters a list of jobs with bounded concurrency (default batch size 5).
 * Drops jobs whose application/posting URL is verified to be dead, expired, or stale.
 */
export async function filterLiveJobs<
  T extends { url: string; applicationUrl?: string | null; title?: string },
>(
  jobs: T[],
  cache?: Cache | null,
  batchSize: number = 5,
): Promise<T[]> {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return [];
  }

  const liveJobs: T[] = [];

  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const verifications = await Promise.all(
      batch.map(async (job) => {
        const targetUrl = job.applicationUrl || job.url;
        const liveness = await verifyJobLinkLiveness(targetUrl, cache);
        return { job, liveness };
      }),
    );

    for (const { job, liveness } of verifications) {
      if (liveness.isAlive) {
        liveJobs.push(job);
      } else {
        logger.info(
          `[JobLinkVerifier] Dropping dead/expired job: "${job.title || job.url}" (${liveness.reason})`,
        );
      }
    }
  }

  return liveJobs;
}

export interface IJobLinkVerifier {
  filterLiveJobs<T extends { url: string; applicationUrl?: string | null; title?: string }>(
    jobs: T[],
    cache?: Cache | ICache | null,
    batchSize?: number,
  ): Promise<T[]>;
  verifyJobLinkLiveness(
    url: string,
    cache?: Cache | ICache | null,
  ): Promise<JobLivenessResult>;
}

export class JobLinkVerifier implements IJobLinkVerifier {
  public filterLiveJobs<T extends { url: string; applicationUrl?: string | null; title?: string }>(
    jobs: T[],
    cache?: Cache | ICache | null,
    batchSize?: number,
  ): Promise<T[]> {
    return filterLiveJobs(jobs, cache, batchSize);
  }

  public verifyJobLinkLiveness(
    url: string,
    cache?: Cache | ICache | null,
  ): Promise<JobLivenessResult> {
    return verifyJobLinkLiveness(url, cache);
  }
}

export const jobLinkVerifier: IJobLinkVerifier = new JobLinkVerifier();


import crypto from 'node:crypto';
import type { Cache } from '../../cache/cache.interface.js';
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

export const LINK_VERIFIER_TIMEOUT_MS = 3500;
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
 * Uses native fetch with 3.5s timeout.
 * Rejects 404/410, soft-404 expired text, and stale age text.
 * Inconclusive results (timeouts, 403, 429) keep the job to prevent false drops.
 */
export async function verifyJobLinkLiveness(
  url: string,
  cache?: Cache | null,
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
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

    // Bot protection / rate limit / forbidden -> treat as inconclusive (keep the job)
    if (status === 403 || status === 429) {
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

    // Soft-404 / Expired Job Check (e.g. dailyremote "This Job Has Expired")
    if (EXPIRED_JOB_REGEX.test(text)) {
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

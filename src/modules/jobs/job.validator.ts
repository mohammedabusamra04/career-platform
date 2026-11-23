import ms from 'ms';
import type { Job } from './job.types.js';
import logger from '../../shared/utils/logger.js';

export const MAX_JOB_AGE_DAYS = 21;

export interface IJobValidator {
  validateJob(job: Job, now?: unknown): boolean;
}

export function validateJob(job: Job, now?: unknown): boolean {
  const referenceTime = now instanceof Date ? now.getTime() : Date.now();
  const url = job.applicationUrl || job.url;
  const maxAgeMs = ms(`${MAX_JOB_AGE_DAYS}d`);
  const cutoffTime = referenceTime - maxAgeMs;

  const hasValidPublicationDate =
    job.publicationDate instanceof Date &&
    !Number.isNaN(job.publicationDate.getTime()) &&
    job.publicationDate.getTime() >= cutoffTime;

  return (
    typeof job.title === 'string' &&
    job.title.trim().length > 0 &&
    typeof job.company === 'string' &&
    job.company.trim().length > 0 &&
    isValidUrl(url) &&
    typeof job.source === 'string' &&
    job.source.trim().length > 0 &&
    hasValidPublicationDate &&
    job.scrapedAt instanceof Date &&
    !Number.isNaN(job.scrapedAt.getTime())
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (err: unknown) {
    logger.debug(`[JobValidator] Invalid URL parse for ${value}: ${(err as Error).message}`);
    return false;
  }
}

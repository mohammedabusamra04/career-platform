import type { Job } from './job.types.js';
import logger from '../../shared/utils/logger.js';

export function validateJob(job: Job): boolean {
  const url = job.applicationUrl || job.url;
  return (
    typeof job.title === 'string' &&
    job.title.trim().length > 0 &&
    typeof job.company === 'string' &&
    job.company.trim().length > 0 &&
    isValidUrl(url) &&
    typeof job.source === 'string' &&
    job.source.trim().length > 0 &&
    job.publicationDate instanceof Date &&
    !Number.isNaN(job.publicationDate.getTime()) &&
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

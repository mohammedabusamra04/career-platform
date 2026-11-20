/**
 * TASK-27: Job Normalization & Sanitization
 * Integrates:
 * - TASK-27.1: Text Sanitization & Safe HTML Stripping (stripHtml, cleanUrl, sanitizeSingleLine)
 * - TASK-27.2: Location & Timestamp Standardization (parsePublicationDate, normalizeLocation)
 */

import type { ExperienceLevel, WorkType } from '../../shared/types/job.js';

import { Job, JobSourceType } from './job.types.js';
import {
  stripHtml,
  cleanUrl,
  sanitizeSingleLine,
  parsePublicationDate,
  normalizeLocation,
} from './job.sanitizer.js';

export interface RawJob {
  title?: string;
  company?: string;
  source?: JobSourceType | string;
  applicationUrl?: string;
  url?: string;

  location?: string;
  country?: string;
  remote?: boolean;

  workType?: WorkType;
  experienceLevel?: ExperienceLevel;

  description?: string;
  skills?: string[];

  /** Accepts ISO strings, epoch numbers, RFC-2822, relative strings, or Date objects */
  publicationDate?: string | number | Date;
  publishedAt?: string | number | Date;

  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
}

export function normalizeJob(rawJob: RawJob): Job {
  const scrapedAt = new Date();

  // --- URLs (TASK-27.1: strip UTM params, validate) ---
  const applicationUrl =
    cleanUrl(rawJob.applicationUrl || rawJob.url) ||
    (rawJob.applicationUrl || rawJob.url || '').trim();

  // --- Publication Date (TASK-27.2: multi-format parser) ---
  const pubDate = parsePublicationDate(
    rawJob.publishedAt ?? rawJob.publicationDate,
    scrapedAt,
  );

  // --- Description (TASK-27.1: safe HTML stripping & entity decoding) ---
  const cleanDescription = rawJob.description
    ? stripHtml(rawJob.description)
    : undefined;

  // --- Location (TASK-27.2: location & country standardization) ---
  const loc = normalizeLocation(rawJob.location, rawJob.remote);

  // Inferred or explicit remote flag
  const isRemote =
    rawJob.remote ??
    (loc.isRemote ||
      rawJob.workType === 'remote' ||
      /remote|عن بعد|telecommute/i.test(`${rawJob.title ?? ''} ${rawJob.location ?? ''}`));

  // Prefer explicit country from source, otherwise inferred country code
  const country = rawJob.country?.trim() || loc.country;

  return {
    title: sanitizeSingleLine(rawJob.title),
    company: sanitizeSingleLine(rawJob.company),
    source: rawJob.source ?? JobSourceType.OTHER,
    applicationUrl,
    url: applicationUrl,

    location: loc.location || rawJob.location?.trim(),
    country,
    remote: isRemote,

    workType: rawJob.workType,
    experienceLevel: rawJob.experienceLevel,

    description: cleanDescription,
    skills: Array.isArray(rawJob.skills) ? rawJob.skills : [],

    publicationDate: pubDate,
    publishedAt: pubDate,

    salaryMin: typeof rawJob.salaryMin === 'number' ? rawJob.salaryMin : undefined,
    salaryMax: typeof rawJob.salaryMax === 'number' ? rawJob.salaryMax : undefined,
    currency: rawJob.currency?.trim(),

    scrapedAt,
  };
}

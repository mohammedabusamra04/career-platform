import type { Job } from '../jobs/job.types.js';
import logger from '../../shared/utils/logger.js';

export enum LinkTier {
  DIRECT_ATS = 3,
  JOB_BOARD = 2,
  AGGREGATOR = 1,
  UNKNOWN = 0,
}

const DIRECT_ATS_DOMAINS = [
  'lever.co',
  'greenhouse.io',
  'workday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'workable.com',
  'recruitee.com',
  'taleo.net',
  'icims.com',
  'jobvite.com',
  'applytojob.com',
  'rippling.com',
  'personio.com',
  'personio.de',
  'breezy.hr',
  'join.com',
  'teamtailor.com',
  'workday.',
];

const JOB_BOARD_DOMAINS_AND_SOURCES = [
  'linkedin.com',
  'linkedin',
  'indeed.com',
  'indeed',
  'glassdoor.com',
  'glassdoor',
  'weworkremotely.com',
  'we_work_remotely',
  'arbeitnow.com',
  'arbeitnow',
  'mostaql.com',
  'mostaqel.com',
  'mostaqel',
  'mostaql',
  'baeed.com',
  'baeed',
  'bayt.com',
  'bayt',
  'wuzzuf.net',
  'wuzzuf',
  'forasna.com',
  'forasna',
  'remotive.com',
  'remotive.io',
  'remotive',
  'stackoverflow.com',
  'dice.com',
  'monster.com',
  'naukrigulf.com',
  'narigulf',
  'souq',
  'freelancer',
];

const AGGREGATOR_DOMAINS_AND_SOURCES = [
  'adzuna.com',
  'adzuna',
  'jooble.org',
  'jooble.com',
  'jooble',
  'tanqeeb.com',
  'tanqeeb',
  'taqneeb',
  'ziprecruiter.com',
  'ziprecruiter',
  'careerjet.com',
  'careerjet',
  'jobrapido.com',
  'jobrapido',
  'neuvoo.com',
  'talent.com',
  'simplyhired.com',
];

/**
 * Determines the LinkTier of a given URL and/or source identifier.
 * Direct ATS (Tier 3) > Primary Job Board (Tier 2) > Aggregator (Tier 1) > Unknown (Tier 0).
 */
export function getLinkTier(rawUrl?: string | null, source?: string | null): LinkTier {
  const urlLower = (rawUrl || '').toLowerCase();
  const sourceLower = (source || '').toLowerCase();

  let hostname = '';
  try {
    if (urlLower.startsWith('http://') || urlLower.startsWith('https://')) {
      const parsed = new URL(urlLower);
      hostname = parsed.hostname;
    }
  } catch (err: unknown) {
    logger.debug(`[ListingMerger] URL hostname parse fallback: ${(err as Error).message}`);
    hostname = urlLower;
  }

  // 1. Direct ATS / Company ATS
  for (const domain of DIRECT_ATS_DOMAINS) {
    if (hostname.includes(domain) || urlLower.includes(domain)) {
      return LinkTier.DIRECT_ATS;
    }
  }
  if (
    (hostname.startsWith('careers.') || hostname.startsWith('jobs.')) &&
    !AGGREGATOR_DOMAINS_AND_SOURCES.some((agg) => hostname.includes(agg)) &&
    !JOB_BOARD_DOMAINS_AND_SOURCES.some((jb) => hostname.includes(jb))
  ) {
    return LinkTier.DIRECT_ATS;
  }

  // 2. Primary Job Boards
  for (const jb of JOB_BOARD_DOMAINS_AND_SOURCES) {
    if (hostname.includes(jb) || sourceLower === jb || sourceLower.includes(jb)) {
      return LinkTier.JOB_BOARD;
    }
  }

  // 3. General Aggregators
  for (const agg of AGGREGATOR_DOMAINS_AND_SOURCES) {
    if (hostname.includes(agg) || sourceLower === agg || sourceLower.includes(agg)) {
      return LinkTier.AGGREGATOR;
    }
  }

  return rawUrl && rawUrl.trim().length > 0 ? LinkTier.JOB_BOARD : LinkTier.UNKNOWN;
}

/**
 * Selects the higher-precedence URL based on LinkTier.
 * When tiers are equal, prefers the non-empty or longer URL.
 */
export function selectPreferredLink(
  urlA: string | undefined | null,
  sourceA: string | undefined | null,
  urlB: string | undefined | null,
  sourceB: string | undefined | null,
): string {
  const cleanA = (urlA || '').trim();
  const cleanB = (urlB || '').trim();

  if (!cleanA && cleanB) return cleanB;
  if (!cleanB && cleanA) return cleanA;
  if (!cleanA && !cleanB) return '';

  const tierA = getLinkTier(cleanA, sourceA);
  const tierB = getLinkTier(cleanB, sourceB);

  if (tierA > tierB) return cleanA;
  if (tierB > tierA) return cleanB;

  // Same tier: keep cleanA (or longer if significantly richer)
  return cleanA.length >= cleanB.length ? cleanA : cleanB;
}

/**
 * Merges two descriptions, retaining the longer, richer content.
 */
export function mergeDescription(descA?: string | null, descB?: string | null): string {
  const cleanA = (descA || '').trim();
  const cleanB = (descB || '').trim();

  if (!cleanA && cleanB) return cleanB;
  if (!cleanB && cleanA) return cleanA;
  return cleanA.length >= cleanB.length ? (descA || '') : (descB || '');
}

/**
 * Merges salary information, retaining non-null salary data when one listing lacks it.
 */
export function mergeSalary(
  salaryA: { min?: number | null; max?: number | null; currency?: string | null },
  salaryB: { min?: number | null; max?: number | null; currency?: string | null },
): { min: number | null; max: number | null; currency: string | null } {
  const hasA = (salaryA.min != null && salaryA.min > 0) || (salaryA.max != null && salaryA.max > 0);
  const hasB = (salaryB.min != null && salaryB.min > 0) || (salaryB.max != null && salaryB.max > 0);

  if (hasA && !hasB) {
    return {
      min: salaryA.min ?? null,
      max: salaryA.max ?? null,
      currency: salaryA.currency ?? null,
    };
  }

  if (hasB && !hasA) {
    return {
      min: salaryB.min ?? null,
      max: salaryB.max ?? null,
      currency: salaryB.currency ?? null,
    };
  }

  if (hasA && hasB) {
    // Both have salary: prefer the more complete specification (both min and max)
    const completeA = salaryA.min != null && salaryA.max != null;
    const completeB = salaryB.min != null && salaryB.max != null;

    if (completeA && !completeB) {
      return {
        min: salaryA.min ?? null,
        max: salaryA.max ?? null,
        currency: salaryA.currency ?? salaryB.currency ?? null,
      };
    }
    if (completeB && !completeA) {
      return {
        min: salaryB.min ?? null,
        max: salaryB.max ?? null,
        currency: salaryB.currency ?? salaryA.currency ?? null,
      };
    }

    return {
      min: salaryA.min ?? salaryB.min ?? null,
      max: Math.max(salaryA.max ?? 0, salaryB.max ?? 0) || null,
      currency: salaryA.currency ?? salaryB.currency ?? null,
    };
  }

  return {
    min: null,
    max: null,
    currency: salaryA.currency ?? salaryB.currency ?? null,
  };
}

/**
 * Merges provenance sourcesSeen arrays without duplicates.
 */
export function mergeSourcesSeen(
  sourcesA?: string[] | null,
  sourceA?: string | null,
  sourcesB?: string[] | null,
  sourceB?: string | null,
): string[] {
  const set = new Set<string>();

  const add = (val?: string | null) => {
    if (val && typeof val === 'string' && val.trim().length > 0) {
      set.add(val.trim().toLowerCase());
    }
  };

  if (Array.isArray(sourcesA)) sourcesA.forEach(add);
  add(sourceA);
  if (Array.isArray(sourcesB)) sourcesB.forEach(add);
  add(sourceB);

  return Array.from(set);
}

/**
 * Merges unique skills case-insensitively, preserving original formatting.
 */
export function mergeSkills(skillsA?: string[] | null, skillsB?: string[] | null): string[] {
  const map = new Map<string, string>();

  for (const skill of [...(skillsA || []), ...(skillsB || [])]) {
    if (skill && skill.trim()) {
      const lower = skill.trim().toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, skill.trim());
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Intelligent Field Precedence & Rich Listing Merger Service (TASK-28.3).
 *
 * Rules:
 * 1. Link Precedence: Company ATS/Direct (lever.co, greenhouse.io, workday.com, etc.)
 *    > Primary Job Board (linkedin, indeed, etc.) > General Aggregator (adzuna, jooble, tanqeeb).
 * 2. Description: Keep the longer, richer description.
 * 3. Salary: If one listing has salary and the other does not, retain the salary data.
 * 4. Provenance: Append all seen source identifiers to `sourcesSeen: string[]`.
 * 5. Skills: Merge unique skills without duplicates.
 */
export class ListingMergerService {
  /**
   * Merges two Job domain entities into a single highest-quality listing.
   */
  public mergeJobs(existingJob: Job, incomingJob: Job): Job {
    // 1. Link Precedence
    const preferredApplicationUrl = selectPreferredLink(
      existingJob.applicationUrl,
      existingJob.source,
      incomingJob.applicationUrl,
      incomingJob.source,
    );

    const preferredUrl = selectPreferredLink(
      existingJob.url,
      existingJob.source,
      incomingJob.url,
      incomingJob.source,
    );

    // Source identifier defaults to the higher tier source or preserves existing
    const existingTier = getLinkTier(existingJob.url || existingJob.applicationUrl, existingJob.source);
    const incomingTier = getLinkTier(incomingJob.url || incomingJob.applicationUrl, incomingJob.source);
    const primarySource = incomingTier > existingTier ? incomingJob.source : existingJob.source;

    // 2. Longer Description
    const mergedDescription = mergeDescription(existingJob.description, incomingJob.description);

    // 3. Retain Salary Data
    const salary = mergeSalary(
      {
        min: existingJob.salaryMin,
        max: existingJob.salaryMax,
        currency: existingJob.currency,
      },
      {
        min: incomingJob.salaryMin,
        max: incomingJob.salaryMax,
        currency: incomingJob.currency,
      },
    );

    // 4. Provenance tracking: sourcesSeen
    const sourcesSeen = mergeSourcesSeen(
      existingJob.sourcesSeen,
      existingJob.source,
      incomingJob.sourcesSeen,
      incomingJob.source,
    );

    // 5. Skills union
    const skills = mergeSkills(existingJob.skills, incomingJob.skills);

    // 6. Location & Country
    const location = existingJob.location || incomingJob.location || undefined;
    const country = existingJob.country || incomingJob.country || undefined;

    // 7. Remote & Work Type & Experience
    const remote = existingJob.remote ?? incomingJob.remote;
    const workType =
      existingJob.workType && existingJob.workType !== ('UNKNOWN' as any)
        ? existingJob.workType
        : incomingJob.workType;
    const experienceLevel =
      existingJob.experienceLevel && existingJob.experienceLevel !== ('UNKNOWN' as any)
        ? existingJob.experienceLevel
        : incomingJob.experienceLevel;

    // 8. Timestamps
    const publishedAt =
      existingJob.publishedAt && incomingJob.publishedAt
        ? new Date(Math.min(existingJob.publishedAt.getTime(), incomingJob.publishedAt.getTime()))
        : existingJob.publishedAt || incomingJob.publishedAt;

    const publicationDate =
      existingJob.publicationDate && incomingJob.publicationDate
        ? new Date(
            Math.min(existingJob.publicationDate.getTime(), incomingJob.publicationDate.getTime()),
          )
        : existingJob.publicationDate || incomingJob.publicationDate;

    const scrapedAt =
      existingJob.scrapedAt && incomingJob.scrapedAt
        ? new Date(Math.max(existingJob.scrapedAt.getTime(), incomingJob.scrapedAt.getTime()))
        : existingJob.scrapedAt || incomingJob.scrapedAt || new Date();

    return {
      title: incomingTier > existingTier ? incomingJob.title : existingJob.title,
      company: incomingTier > existingTier ? incomingJob.company : existingJob.company,
      source: primarySource,
      url: preferredUrl,
      applicationUrl: preferredApplicationUrl,
      location,
      country,
      remote,
      workType,
      experienceLevel,
      description: mergedDescription,
      skills,
      publicationDate,
      publishedAt,
      salaryMin: salary.min ?? undefined,
      salaryMax: salary.max ?? undefined,
      currency: salary.currency ?? undefined,
      scrapedAt,
      sourcesSeen,
    };
  }
}

export const listingMergerService = new ListingMergerService();

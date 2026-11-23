import type { PrismaClient, Prisma } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';

export const EXPLORER_SLA_TARGET_MS = ms('300ms');
import {
  hardFilterEngine,
  ARAB_COUNTRY_CODES,
  ARAB_SOURCES,
} from '../matching/hardFilter.engine.js';
import { equivalenceMatchingService } from '../matching/equivalenceMatching.service.js';
import { mapToScorableJob, type RawDatabaseJob } from '../delivery/firstDigest.service.js';
import {
  escapeTelegramMarkdown,
  sanitizeApplicationUrl,
  formatRemoteScope,
  formatExperienceLevel,
  formatMatchTone,
} from '../notifications/telegram/digestCard.formatter.js';
import {
  RegionPreference,
  type Specialization,
} from '../preferences/preference.taxonomy.js';
import { JobSourceRegistry } from './sources/jobSource.registry.js';
import { negativeExclusionMatcher } from './classifier/negativeExclusion.matcher.js';
import { MAX_JOB_AGE_DAYS } from './job.validator.js';
import logger from '../../shared/utils/logger.js';

export type JobSortOrder = 'BEST_MATCH' | 'LATEST';

export interface KeysetCursor {
  sortKey: number | string;
  jobId: string;
}

export interface JobExplorerOptions {
  page?: number;
  pageSize?: number;
  sort?: JobSortOrder;
  cursor?: string;
}

export interface ExplorerJobItem {
  id: string;
  title: string;
  company: string;
  source?: string | null;
  url: string;
  applicationUrl?: string | null;
  location?: string | null;
  country?: string | null;
  remoteScope?: string | null;
  experienceLevel?: string | null;
  score?: number | null;
  publishedAt?: Date | null;
}

export interface JobExplorerResult {
  hasMatches: boolean;
  totalMatches: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  sort: JobSortOrder;
  jobs: ExplorerJobItem[];
  nextCursor?: string | null;
  prevCursor?: string | null;
  executionTimeMs: number;
}

/**
 * Encodes a keyset cursor token containing sort key and job ID tie-breaker.
 */
export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * Safely decodes a keyset cursor token.
 */
export function decodeKeysetCursor(token?: string | null): KeysetCursor | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.jobId === 'string' && parsed.sortKey !== undefined) {
      return parsed as KeysetCursor;
    }
  } catch (err: unknown) {
    logger.warn(`[JobExplorerService] Failed decoding keyset cursor: ${(err as Error).message}`);
  }
  return null;
}

/**
 * Builds Prisma database-level regional eligibility filter matching hard-filter taxonomy.
 * Applies criteria in PostgreSQL directly to prevent truncating candidate results.
 */
export function buildDatabaseRegionFilter(regionPref: RegionPreference): Prisma.JobWhereInput {
  if (regionPref === RegionPreference.BOTH) {
    return {};
  }

  const arabCountries = Array.from(ARAB_COUNTRY_CODES);
  const arabSources = Array.from(ARAB_SOURCES);

  if (regionPref === RegionPreference.ARAB) {
    return {
      OR: [
        { remoteScope: 'WORLDWIDE' },
        { country: { in: arabCountries } },
        { source: { in: arabSources } },
      ],
    };
  }

  // INTERNATIONAL: Exclude on-site local roles restricted to Arab countries
  return {
    OR: [
      { remoteScope: 'WORLDWIDE' },
      { country: { notIn: arabCountries } },
      { country: null },
    ],
  };
}

export const ARABIC_HEADER_TEMPLATES = [
  (count: number) => `🎯 **وجدنا ${count} وظيفة نشطة تناسب تخصصاتك!**`,
  (count: number) => `✨ **استكشف ${count} فرصة عمل واعدة متوافقة مع ملفك المهني:**`,
  (count: number) => `🚀 **أمامك ${count} فرصة متاحة حالياً تناسب مجالك وخبرتك:**`,
  (count: number) => `💼 **جمعنا لك ${count} وظيفة نشطة ومميزة تناسب طموحك:**`,
  (count: number) => `🌟 **إليك ${count} فرصة عمل مختارة ومطابقة لمعاييرك المهنية:**`,
];

export const ENGLISH_HEADER_TEMPLATES = [
  (count: number) => `🎯 **We found ${count} active jobs matching your preferences!**`,
  (count: number) => `✨ **Explore ${count} promising career opportunities tailored for you:**`,
  (count: number) => `🚀 **You have ${count} active openings ready to explore:**`,
  (count: number) => `💼 **Handpicked ${count} active opportunities aligned with your career goals:**`,
  (count: number) => `🌟 **Here are ${count} selected opportunities matching your criteria:**`,
];

/**
 * Returns a varied header banner to keep the user experience dynamic and engaging.
 * Allows passing an optional templateIndex for deterministic testing.
 */
export function formatJobsHeader(
  count: number,
  lang: 'ar' | 'en' = 'ar',
  templateIndex?: number,
): string {
  if (count <= 0) {
    if (lang === 'en') {
      return '🔍 **No active jobs currently match your preferences**\n\nNew opportunities are collected continuously, check back soon or broaden your preferences in /settings!';
    }
    return '🔍 **لا توجد وظائف نشطة مطابقة لتفضيلاتك حالياً**\n\nيتم جمع فرص جديدة باستمرار، تفقد القائمة لاحقاً أو قم بتوسيع نطاق تفضيلاتك عبر /settings!';
  }

  const templates = lang === 'en' ? ENGLISH_HEADER_TEMPLATES : ARABIC_HEADER_TEMPLATES;
  const index =
    typeof templateIndex === 'number'
      ? Math.abs(templateIndex) % templates.length
      : Math.floor(Math.random() * templates.length);

  return templates[index](count);
}

export class JobExplorerService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Queries active matching jobs directly from PostgreSQL shared pool.
   *
   * Guaranteed Invariants:
   * - Zero external scraping: NEVER calls external job source adapters.
   * - Sub-300ms execution leveraging composite indexes on Job table.
   * - Filtered strictly by user's active specializations and region preference.
   */
  public async getJobsForUser(
    userId: string,
    options?: JobExplorerOptions,
  ): Promise<JobExplorerResult> {
    const startTime = Date.now();
    const page = Math.max(1, options?.page || 1);
    const pageSize = Math.max(1, options?.pageSize || 5);
    const sort = options?.sort || 'BEST_MATCH';

    // 1. Fetch user's active preferences
    const userPref = await this.db.userPreference.findUnique({
      where: { userId },
    });

    if (!userPref || !userPref.specializations || userPref.specializations.length === 0) {
      return {
        hasMatches: false,
        totalMatches: 0,
        currentPage: 1,
        totalPages: 0,
        pageSize,
        sort,
        jobs: [],
        executionTimeMs: Date.now() - startTime,
      };
    }

    const specs = userPref.specializations as Specialization[];
    const regionPref = userPref.regionPreference as RegionPreference;

    // 2. Direct query against PostgreSQL shared pool using composite index:
    // (primarySpecialization, remoteScope, status) and (status, publishedAt DESC).
    // Push regional eligibility directly into database query to avoid truncating candidates.
    // Strictly filter out non-ACTIVE jobs and jobs older than MAX_JOB_AGE_DAYS (21 days).
    const regionFilter = buildDatabaseRegionFilter(regionPref);
    const maxAgeMs = MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    const whereConditions: Prisma.JobWhereInput[] = [
      {
        status: 'ACTIVE',
        title: { notIn: ['Reset Filter', 'Manage My Jobs', 'Jobs with Salaries', 'Add Job'] },
        OR: [
          { primarySpecialization: { in: specs } },
          { secondarySpecialization: { in: specs } },
        ],
        AND: [
          {
            publishedAt: { gte: cutoffDate },
          },
        ],
      },
    ];

    if (regionFilter.OR) {
      whereConditions.push({ OR: regionFilter.OR });
    }

    const rawJobs = await this.db.job.findMany({
      where: {
        AND: whereConditions,
      },
      select: {
        id: true,
        title: true,
        company: true,
        source: true,
        url: true,
        applicationUrl: true,
        location: true,
        country: true,
        remoteScope: true,
        primarySpecialization: true,
        secondarySpecialization: true,
        experienceLevel: true,
        workType: true,
        publishedAt: true,
        scrapedAt: true,
        status: true,
      },
      orderBy: [
        { publishedAt: 'desc' },
        { id: 'desc' },
      ],
    });

    // 3. Filter jobs by regional and experience level compatibility (strictly ACTIVE, not stale, excluding navigation URLs and non-technical roles)
    const regionallyFiltered = rawJobs.filter((job) => {
      if (job.status && job.status !== 'ACTIVE') {
        return false;
      }
      const jobDate = job.publishedAt ?? job.scrapedAt;
      if (jobDate && jobDate.getTime() < cutoffDate.getTime()) {
        return false;
      }

      return (
        !/job_list|with-salaries|search\?|create_job|create_widget/i.test(job.url) &&
        !negativeExclusionMatcher.evaluate(job.title).isExcluded &&
        hardFilterEngine.isRegionCompatible(
          {
            id: job.id,
            title: job.title,
            primarySpecialization: (job.primarySpecialization as Specialization) ?? null,
            secondarySpecialization: (job.secondarySpecialization as Specialization) ?? null,
            remoteScope: job.remoteScope,
            country: job.country,
            location: job.location,
            workType: job.workType,
            experienceLevel: job.experienceLevel,
          },
          regionPref,
        ) &&
        hardFilterEngine.isExperienceCompatible(
          {
            id: job.id,
            title: job.title,
            experienceLevel: job.experienceLevel,
          },
          userPref.experienceLevel,
        )
      );
    });

    if (regionallyFiltered.length === 0) {
      return {
        hasMatches: false,
        totalMatches: 0,
        currentPage: 1,
        totalPages: 0,
        pageSize,
        sort,
        jobs: [],
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 4. Compute relevance scores using equivalence grouping engine
    const scorableJobs = regionallyFiltered.map((j) => mapToScorableJob(j as RawDatabaseJob));
    const scoredJobs = equivalenceMatchingService.matchGroup(
      {
        preferenceHash: userPref.preferenceHash || 'jobs-explorer',
        specializations: specs,
        regionPreference: regionPref,
        experienceLevel: userPref.experienceLevel ?? null,
        workType: userPref.workType ?? null,
        userIds: [userId],
      },
      scorableJobs,
    );

    // Map into ExplorerJobItem items
    const rawJobSourceMap = new Map<string, string>();
    for (const rj of rawJobs) {
      if (rj.id && (rj as { source?: string }).source) {
        rawJobSourceMap.set(rj.id, (rj as { source?: string }).source!);
      }
    }

    const allMatches: ExplorerJobItem[] = scoredJobs.map((item) => {
      const rawCompany =
        'company' in item.job ? String((item.job as { company?: unknown }).company || '') : '';
      const jobId = item.job.id as string;
      const jobSource =
        ('source' in item.job ? (item.job as { source?: string }).source : undefined) ||
        rawJobSourceMap.get(jobId) ||
        null;

      return {
        id: jobId,
        title: item.job.title || 'Untitled Role',
        company: rawCompany || 'Company',
        source: jobSource,
        url: item.job.url || item.job.applicationUrl || '',
        applicationUrl: item.job.applicationUrl,
        location: item.job.location,
        country: item.job.country,
        remoteScope: item.job.remoteScope,
        experienceLevel: item.job.experienceLevel,
        score: item.scoring.score,
        publishedAt: item.job.publishedAt ?? null,
      };
    });

    // 5. Apply deterministic keyset sorting with unique job-ID tie-breaker
    if (sort === 'LATEST') {
      allMatches.sort((a, b) => {
        const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });
    } else {
      allMatches.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });
    }

    // 6. Keyset pagination using cursor or page-index fallback
    const totalMatches = allMatches.length;
    const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));

    let startIndex = 0;
    const decodedCursor = decodeKeysetCursor(options?.cursor);

    if (decodedCursor) {
      const cursorIndex = allMatches.findIndex(
        (item) => item.id === decodedCursor.jobId,
      );
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    } else {
      const safeCurrentPage = Math.min(page, totalPages);
      startIndex = (safeCurrentPage - 1) * pageSize;
    }

    const pagedJobs = allMatches.slice(startIndex, startIndex + pageSize);
    const calculatedCurrentPage = Math.min(
      Math.floor(startIndex / pageSize) + 1,
      totalPages,
    );

    // Build deterministic keyset cursors for next and previous navigation
    let nextCursor: string | null = null;
    let prevCursor: string | null = null;

    if (pagedJobs.length > 0) {
      const lastJob = pagedJobs[pagedJobs.length - 1];
      const nextIndex = startIndex + pagedJobs.length;
      if (nextIndex < totalMatches) {
        const sortKey =
          sort === 'LATEST'
            ? lastJob.publishedAt?.toISOString() || ''
            : lastJob.score ?? 0;
        nextCursor = encodeKeysetCursor({
          sortKey,
          jobId: lastJob.id,
        });
      }

      if (startIndex > 0) {
        const firstJob = pagedJobs[0];
        const sortKey =
          sort === 'LATEST'
            ? firstJob.publishedAt?.toISOString() || ''
            : firstJob.score ?? 0;
        prevCursor = encodeKeysetCursor({
          sortKey,
          jobId: firstJob.id,
        });
      }
    }

    const executionTimeMs = Date.now() - startTime;
    logger.info(
      `[JobExplorerService] Retrieved ${totalMatches} active jobs for user ${userId} in ${executionTimeMs}ms`,
    );

    return {
      hasMatches: true,
      totalMatches,
      currentPage: calculatedCurrentPage,
      totalPages,
      pageSize,
      sort,
      jobs: pagedJobs,
      nextCursor,
      prevCursor,
      executionTimeMs,
    };
  }

  /**
   * Formats candidate jobs for display in Telegram using varied header templates.
   */
  public formatJobsExplorerMessage(
    result: JobExplorerResult,
    options?: {
      language?: 'ar' | 'en';
      templateIndex?: number;
    },
  ): string {
    const lang = options?.language || 'ar';
    const header = formatJobsHeader(result.totalMatches, lang, options?.templateIndex);

    if (!result.hasMatches || result.jobs.length === 0) {
      return header;
    }

    const isArabic = lang === 'ar';
    const sortLabel =
      result.sort === 'LATEST'
        ? isArabic
          ? '⏱️ الأحدث نشراً'
          : '⏱️ Latest Published'
        : isArabic
          ? '🎯 الأكثر مطابقة'
          : '🎯 Best Match';

    const sortInfo = isArabic
      ? `📊 **الترتيب:** ${sortLabel} | **الصفحة:** ${result.currentPage}/${result.totalPages}\n────────────────────\n\n`
      : `📊 **Sorting:** ${sortLabel} | **Page:** ${result.currentPage}/${result.totalPages}\n────────────────────\n\n`;

    const jobCards = result.jobs
      .map((job, idx) => {
        const indexOnPage = idx + 1;
        const safeTitle = escapeTelegramMarkdown(job.title || 'Untitled Role');
        const safeCompany = escapeTelegramMarkdown(job.company || 'Company');
        const targetUrl = sanitizeApplicationUrl(job.applicationUrl || job.url);

        const applyText = isArabic ? 'التقديم المباشر' : 'Direct Application';
        const titleLink = targetUrl ? `[${safeTitle}](${targetUrl})` : `*${safeTitle}*`;
        const directLinkLine = targetUrl ? `🔗 [${applyText}](${targetUrl})` : '';

        const locationPart = job.location || job.country || '';
        const safeLocation = escapeTelegramMarkdown(locationPart);
        const companyAndLocation = safeLocation
          ? `🏢 *${safeCompany}* | 📍 ${safeLocation}`
          : `🏢 *${safeCompany}*`;

        const remoteLine = formatRemoteScope(job.remoteScope, job.country, job.location, lang);
        const experienceLine = formatExperienceLevel(job.experienceLevel, lang);
        const matchToneLine = formatMatchTone(job.score ?? 70, lang);
        const platformBadge = JobSourceRegistry.formatSourceBadge(job.source, lang, targetUrl || job.url);
        const platformLine = `🌐 ${escapeTelegramMarkdown(platformBadge)}`;

        const lines = [
          `*${indexOnPage}.* 💼 ${titleLink}`,
          companyAndLocation,
          platformLine,
          remoteLine,
          experienceLine,
          matchToneLine,
        ];

        if (directLinkLine) {
          lines.push(directLinkLine);
        }

        return lines.join('\n');
      })
      .join('\n\n────────────────────\n\n');

    const disclaimer = isArabic
      ? '💡 *تنبيه:* الروابط أعلاه تنقلك مباشرة إلى موقع التقديم الرسمي. البوت لا يقدّم على الوظائف بالنيابة عنك.'
      : '💡 *Notice:* The links above take you directly to official job listings. The bot does not apply on your behalf.';

    return `${header}\n\n${sortInfo}${jobCards}\n\n────────────────────\n${disclaimer}`;
  }
}

export const jobExplorerService = new JobExplorerService();

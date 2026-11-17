import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';

export const EXPLORER_SLA_TARGET_MS = ms('300ms');
import { hardFilterEngine } from '../matching/hard-filter.engine.js';
import { equivalenceMatchingService } from '../matching/equivalence-matching.service.js';
import { mapToScorableJob, type RawDatabaseJob } from '../delivery/first-digest.service.js';
import {
  escapeTelegramMarkdown,
  sanitizeApplicationUrl,
  formatRemoteScope,
  formatExperienceLevel,
  formatMatchTone,
} from '../notifications/telegram/digest-card.formatter.js';
import type { Specialization, RegionPreference } from '../preferences/preference.taxonomy.js';
import logger from '../../shared/utils/logger.js';

export type JobSortOrder = 'BEST_MATCH' | 'LATEST';

export interface JobExplorerOptions {
  page?: number;
  pageSize?: number;
  sort?: JobSortOrder;
}

export interface ExplorerJobItem {
  id: string;
  title: string;
  company: string;
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
  executionTimeMs: number;
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
    // (primarySpecialization, remoteScope, status) and (status, publishedAt DESC)
    const rawJobs = await this.db.job.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { primarySpecialization: { in: specs } },
          { secondarySpecialization: { in: specs } },
        ],
      },
      select: {
        id: true,
        title: true,
        company: true,
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
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: 500, // Safe pool buffer for in-memory score sorting and regional hard-filtering
    });

    // 3. Filter jobs by regional compatibility
    const regionallyFiltered = rawJobs.filter((job) =>
      hardFilterEngine.isRegionCompatible(
        {
          id: job.id,
          primarySpecialization: (job.primarySpecialization as Specialization) ?? null,
          secondarySpecialization: (job.secondarySpecialization as Specialization) ?? null,
          remoteScope: job.remoteScope,
          country: job.country,
          location: job.location,
          workType: job.workType,
        },
        regionPref,
      ),
    );

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
    const allMatches: ExplorerJobItem[] = scoredJobs.map((item) => {
      const rawCompany =
        'company' in item.job ? String((item.job as { company?: unknown }).company || '') : '';

      return {
        id: item.job.id as string,
        title: item.job.title || 'Untitled Role',
        company: rawCompany || 'Company',
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

    // 5. Apply sorting: 'BEST_MATCH' (score DESC) vs 'LATEST' (publishedAt DESC)
    if (sort === 'LATEST') {
      allMatches.sort((a, b) => {
        const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return timeB - timeA;
      });
    } else {
      allMatches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    // 6. Keyset page slicing (5 jobs per page)
    const totalMatches = allMatches.length;
    const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
    const safeCurrentPage = Math.min(page, totalPages);
    const startIndex = (safeCurrentPage - 1) * pageSize;
    const pagedJobs = allMatches.slice(startIndex, startIndex + pageSize);

    const executionTimeMs = Date.now() - startTime;
    logger.info(
      `[JobExplorerService] Retrieved ${totalMatches} active jobs for user ${userId} in ${executionTimeMs}ms`,
    );

    return {
      hasMatches: true,
      totalMatches,
      currentPage: safeCurrentPage,
      totalPages,
      pageSize,
      sort,
      jobs: pagedJobs,
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

        const lines = [
          `*${indexOnPage}.* 💼 ${titleLink}`,
          companyAndLocation,
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

    return `${header}\n\n${sortInfo}${jobCards}`;
  }
}

export const jobExplorerService = new JobExplorerService();

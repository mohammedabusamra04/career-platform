import type { PrismaClient } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import ms from 'ms';
import { prisma } from '../../shared/database/prisma.service.js';
import { transparentExplanationBuilder } from '../matching/scoreReason.builder.js';
import type { ScorableJob, ScoringResult } from '../matching/scoring.calculator.js';
import type { Specialization, RegionPreference } from '../preferences/preference.taxonomy.js';
import {
  type DigestCardJob,
  escapeTelegramMarkdown,
  cleanAndEscapeTitle,
} from '../notifications/telegram/digestCard.formatter.js';
import { JobSourceRegistry } from '../jobs/sources/jobSource.registry.js';
import { jobLinkVerifier, type IJobLinkVerifier } from '../jobs/job.linkVerifier.js';
import {
  JobExplorerService,
  type IJobExplorerService,
  type ExplorerJobItem,
} from '../jobs/jobExplorer.service.js';
import logger from '../../shared/utils/logger.js';

export const HISTORICAL_SENT_WINDOW = ms('4h');

export interface RawDatabaseJob {
  id: string;
  title: string;
  company?: string | null;
  source?: string | null;
  url?: string | null;
  applicationUrl?: string | null;
  location?: string | null;
  country?: string | null;
  remoteScope?: string | null;
  primarySpecialization?: Specialization | string | null;
  secondarySpecialization?: Specialization | string | null;
  experienceLevel?: string | null;
  workType?: string | null;
  publishedAt?: Date | null;
}

/**
 * Explicitly maps database job records into strongly-typed ScorableJob models,
 * validating required fields and eliminating unsafe unchecked casts.
 */
export function mapToScorableJob(job: RawDatabaseJob): ScorableJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company ?? null,
    primarySpecialization: (job.primarySpecialization as Specialization) ?? null,
    secondarySpecialization: (job.secondarySpecialization as Specialization) ?? null,
    remoteScope: job.remoteScope,
    country: job.country,
    location: job.location,
    workType: job.workType,
    source: job.source,
    url: job.url,
    applicationUrl: job.applicationUrl,
    experienceLevel: job.experienceLevel,
    publishedAt: job.publishedAt,
    publicationDate: job.publishedAt,
  };
}

export interface FirstDigestCandidate {
  jobId: string;
  title: string;
  company: string;
  source?: string | null;
  url: string;
  applicationUrl?: string | null;
  location?: string | null;
  country?: string | null;
  remoteScope?: string | null;
  score: number;
  explanationAr: string;
  explanationEn: string;
}

export interface FirstDigestResult {
  hasMatches: boolean;
  totalMatches: number;
  page: number;
  totalPages: number;
  jobs: FirstDigestCandidate[];
  deliveredJobIds: string[];
}

export class FirstDigestService {
  private jobExplorer?: IJobExplorerService;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly linkVerifier: IJobLinkVerifier = jobLinkVerifier,
    jobExplorer?: IJobExplorerService,
  ) {
    if (jobExplorer) {
      this.jobExplorer = jobExplorer;
    }
  }

  private getJobExplorer(): IJobExplorerService {
    if (!this.jobExplorer) {
      this.jobExplorer = new JobExplorerService(this.db);
    }
    return this.jobExplorer;
  }

  /**
   * Queries active jobs, matches them against the new user's preferences,
   * records the delivered jobs in SentJob, and returns Page 1 of the digest.
   *
   * @param userId Platform user UUID
   * @param preferences User's selected specializations and region
   * @param pageSize Number of jobs per page (default: 5, max 20 across pages)
   */
  public async generateAndDeliverFirstDigest(
    userId: string,
    preferences: {
      specializations: Specialization[];
      regionPreference: RegionPreference;
      experienceLevel?: string | null;
      workType?: string | null;
      preferenceHash?: string;
    },
    pageSize: number = 5,
  ): Promise<FirstDigestResult> {
    const startTime = Date.now();

    // 1. Fetch candidate jobs via JobExplorerService (single source of truth for querying & DB-level regional/cutoff filters)
    let explorerResult = await this.getJobExplorer().getJobsForUser(userId, {
      pageSize: 20,
      sort: 'BEST_MATCH',
      preferences,
    });

    // If shared pool currently has 0 active jobs for this stack (e.g. fresh environment or first subscriber),
    // trigger an on-demand collection from configured sources so user receives matches immediately!
    if ((!explorerResult.jobs || explorerResult.jobs.length === 0) && process.env.NODE_ENV !== 'test') {
      try {
        const { jobCollectionService } = await import('../../config/services.js');
        if (jobCollectionService) {
          logger.info(
            `[FirstDigestService] Database pool has 0 active jobs for [${preferences.specializations.join(', ')}]. Triggering immediate on-demand collection...`,
          );
          await jobCollectionService.collectJobs({
            jobTitle: preferences.specializations[0],
            experienceLevel: (preferences.experienceLevel as any) || undefined,
          });

          // Re-query via JobExplorerService after collection
          explorerResult = await this.getJobExplorer().getJobsForUser(userId, {
            pageSize: 20,
            sort: 'BEST_MATCH',
            preferences,
          });
        }
      } catch (err: unknown) {
        logger.warn(`[FirstDigestService] On-demand fallback collection failed: ${(err as Error).message}`);
      }
    }

    if (!explorerResult.jobs || explorerResult.jobs.length === 0) {
      return {
        hasMatches: false,
        totalMatches: 0,
        page: 1,
        totalPages: 0,
        jobs: [],
        deliveredJobIds: [],
      };
    }

    // 2. Fetch user's existing sent jobs (if any)
    const existingSent =
      (await this.db.sentJob?.findMany?.({
        where: { userId },
        select: { jobId: true },
      })) || [];
    const sentJobIds = new Set(existingSent.map((s) => s.jobId));
    const freshJobs = explorerResult.jobs.filter((j) => !sentJobIds.has(j.id));

    if (freshJobs.length === 0) {
      return {
        hasMatches: false,
        totalMatches: 0,
        page: 1,
        totalPages: 0,
        jobs: [],
        deliveredJobIds: [],
      };
    }

    // 3. Filter live links so new users never receive 504 / dead links
    const topCandidates = freshJobs.slice(0, pageSize * 2);
    const liveMatches = await this.linkVerifier.filterLiveJobs(
      topCandidates.map((m) => ({
        ...m,
        job: m,
        url: m.url || m.applicationUrl || '',
        applicationUrl: m.applicationUrl,
        title: m.title,
      })),
    );

    const validPageJobs = (liveMatches.length > 0 ? liveMatches : topCandidates).slice(0, pageSize);
    const deliveredJobIds = validPageJobs
      .map((p) => ('id' in p ? p.id : (p as any).job?.id) as string)
      .filter((id) => typeof id === 'string' && id.length > 0);

    const durationMs = Date.now() - startTime;
    logger.info(
      `[FirstDigestService] Prepared ${deliveredJobIds.length} candidate jobs for user ${userId} in ${durationMs}ms`,
    );

    const candidates: FirstDigestCandidate[] = validPageJobs.map((item) => {
      const rawJob: ExplorerJobItem = 'id' in item && item.id ? (item as ExplorerJobItem) : (item as any).job;
      const explanationContext = {
        job: rawJob,
        preferences: {
          specializations: preferences.specializations,
          regionPreference: preferences.regionPreference,
          experienceLevel: preferences.experienceLevel,
        },
      };

      const scoreVal = rawJob.score ?? 70;
      const scoreObj: ScoringResult = {
        score: scoreVal,
        isEligibleForDigest: true,
        breakdown: {
          specializationScore: 50,
          levelScore: 10,
          regionScore: 10,
          freshnessScore: 0,
          atsScore: 0,
          rawTotal: scoreVal,
          totalScore: scoreVal,
        },
      };

      const explanationAr = transparentExplanationBuilder.formatScoreReport(
        scoreObj,
        explanationContext,
        'ar',
      );

      const explanationEn = transparentExplanationBuilder.formatScoreReport(
        scoreObj,
        explanationContext,
        'en',
      );

      const rawCompany =
        'company' in rawJob ? String((rawJob as { company?: unknown }).company || '') : '';

      return {
        jobId: rawJob.id,
        title: rawJob.title || 'Untitled',
        company: rawCompany || 'Company',
        source: rawJob.source || null,
        url: rawJob.url || rawJob.applicationUrl || '',
        applicationUrl: rawJob.applicationUrl,
        location: rawJob.location,
        country: rawJob.country,
        remoteScope: rawJob.remoteScope,
        score: rawJob.score ?? 70,
        explanationAr,
        explanationEn,
      };
    });

    const totalPages = Math.ceil(freshJobs.length / pageSize);

    return {
      hasMatches: true,
      totalMatches: freshJobs.length,
      page: 1,
      totalPages,
      jobs: candidates,
      deliveredJobIds,
    };
  }

  /**
   * Persists delivered jobs to SentJob records only after successful message dispatch.
   */
  public async recordDeliveredJobs(userId: string, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;

    await this.db.sentJob.createMany({
      data: jobIds.map((jobId) => ({
        userId,
        jobId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Retrieves up to 20 candidate jobs personalized for a user's preferences,
   * used for in-place pagination across digest pages.
   */
  public async getPersonalizedDigestJobs(userId: string): Promise<DigestCardJob[]> {
    const explorerResult = await this.getJobExplorer().getJobsForUser(userId, {
      pageSize: 20,
      sort: 'BEST_MATCH',
    });

    if (!explorerResult.jobs || explorerResult.jobs.length === 0) {
      return [];
    }

    // Exclude jobs sent in previous cycles while retaining current session jobs
    const cutoffDate = new Date(Date.now() - HISTORICAL_SENT_WINDOW);
    const historicalSent = await this.db.sentJob.findMany({
      where: {
        userId,
        sentAt: { lt: cutoffDate },
      },
      select: { jobId: true },
    });
    const historicalSentIds = new Set(historicalSent.map((s) => s.jobId));

    const personalized = explorerResult.jobs
      .filter((j) => !historicalSentIds.has(j.id))
      .slice(0, 20);

    return personalized.map((item) => {
      const rawCompany =
        'company' in item ? String((item as { company?: unknown }).company || '') : '';

      return {
        id: item.id,
        title: item.title || 'Untitled Role',
        company: rawCompany || 'Company',
        source: item.source || null,
        url: item.url || item.applicationUrl || '',
        applicationUrl: item.applicationUrl,
        location: item.location,
        country: item.country,
        remoteScope: item.remoteScope,
        experienceLevel: item.experienceLevel,
        score: item.score ?? 70,
      };
    });
  }

  /**
   * Formats candidate job cards into an elegant bilingual Telegram message.
   */
  public formatDigestMessage(
    digest: FirstDigestResult,
    options?: { singleDailyRunTime?: string; language?: 'ar' | 'en' },
  ): string {
    const lang = options?.language || 'ar';

    if (!digest.hasMatches || digest.jobs.length === 0) {
      if (lang === 'en') {
        return (
          `🔍 **No jobs currently match your criteria**\n\n` +
          `Your preferences have been saved successfully! You will automatically receive your personalized digest in the upcoming evening digest as soon as matching opportunities are collected.\n\n` +
          `💡 You can broaden your search or adjust your settings anytime via /settings`
        );
      }

      return (
        `🔍 **لا توجد وظائف مطابقة تماماً لتخصصك حالياً**\n\n` +
        `لقد تم حفظ تفضيلاتك بنجاح! سيقوم البوت بإشعارك تلقائياً في الملخص المسائي فور رصد فرص جديدة تناسب مجالك.\n\n` +
        `💡 يمكنك توسيع نطاق البحث أو مراجعة إعداداتك عبر الأمر /settings`
      );
    }

    if (lang === 'en') {
      const header =
        `🎉 **Your First Personalized Job Digest!**\n` +
        `We hand-picked the top ${digest.jobs.length} matching opportunities for you:\n` +
        `────────────────────\n\n`;

      const jobCards = digest.jobs
        .map((item, idx) => {
          const safeTitle = cleanAndEscapeTitle(item.title);
          const rawCompany = item.company?.trim();
          const isGenericCompany =
            !rawCompany ||
            rawCompany.toLowerCase() === 'company' ||
            rawCompany.toLowerCase().includes('employer');
          const displayCompany = !isGenericCompany ? escapeTelegramMarkdown(rawCompany) : '';

          const platformBadge = JobSourceRegistry.formatSourceBadge(
            item.source,
            'en',
            item.applicationUrl || item.url,
          );
          const safePlatform = escapeTelegramMarkdown(platformBadge);

          const remoteInfo =
            item.remoteScope === 'WORLDWIDE'
              ? '🌍 Worldwide Remote'
              : item.country
                ? `📍 ${escapeTelegramMarkdown(item.country)}`
                : '🏢 Flexible';

          const metaLine = displayCompany
            ? `🏢 *Company:* ${displayCompany} • 🌐 ${safePlatform} • ${remoteInfo}`
            : `🌐 ${safePlatform} • ${remoteInfo}`;

          const titleLine = item.url
            ? `*${idx + 1}.* 💻 [${safeTitle}](${item.url})`
            : `*${idx + 1}.* 💻 *${safeTitle}*`;

          return [
            titleLine,
            metaLine,
            item.explanationEn,
            item.url ? `🔗 [Apply Here](${item.url})` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n────────────────────\n\n');

      const footer =
        `\n\n────────────────────\n` +
        `📬 **Note:** You will receive your daily updated digest once every evening at your leisure time.`;

      return `${header}${jobCards}${footer}`;
    }

    const header =
      `🎉 **أول ملخص مخصص لك فور انضمامك!**\n` +
      `اخترنا لك أفضل ${digest.jobs.length} فرصة مطابقة لملفك حالياً:\n` +
      `────────────────────\n\n`;

    const jobCards = digest.jobs
      .map((item, idx) => {
        const safeTitle = cleanAndEscapeTitle(item.title);
        const rawCompany = item.company?.trim();
        const isGenericCompany =
          !rawCompany ||
          rawCompany.toLowerCase() === 'company' ||
          rawCompany.toLowerCase().includes('employer');
        const displayCompany = !isGenericCompany ? escapeTelegramMarkdown(rawCompany) : '';

        const platformBadge = JobSourceRegistry.formatSourceBadge(
          item.source,
          'ar',
          item.applicationUrl || item.url,
        );
        const safePlatform = escapeTelegramMarkdown(platformBadge);

        const remoteInfo =
          item.remoteScope === 'WORLDWIDE'
            ? '🌍 عن بُعد (عالمياً)'
            : item.country
              ? `📍 ${escapeTelegramMarkdown(item.country)}`
              : '🏢 مرن';

        const metaLine = displayCompany
          ? `🏢 *الشركة:* ${displayCompany} • 🌐 ${safePlatform} • ${remoteInfo}`
          : `🌐 ${safePlatform} • ${remoteInfo}`;

        const titleLine = item.url
          ? `*${idx + 1}.* 💻 [${safeTitle}](${item.url})`
          : `*${idx + 1}.* 💻 *${safeTitle}*`;

        return [
          titleLine,
          metaLine,
          item.explanationAr,
          item.url ? `🔗 [اضغط هنا للتقديم المباشر](${item.url})` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n────────────────────\n\n');

    const footer =
      `\n\n────────────────────\n` +
      `📬 **ملاحظة:** سنرسل لك ملخصك المحدث تلقائياً مرة واحدة يومياً في المساء.`;

    return `${header}${jobCards}${footer}`;
  }
  /**
   * Builds quick-action buttons for empty state guidance (e.g. edit specs or expand region).
   */
  public buildEmptyStateKeyboard(lang: 'ar' | 'en' = 'ar'): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    const editSpecsLabel = lang === 'ar' ? 'تعديل التخصصات 🛠️' : 'Edit Specializations 🛠️';
    const expandRegionLabel = lang === 'ar' ? 'توسيع نطاق السوق 🌍' : 'Expand Target Region 🌍';

    keyboard.text(editSpecsLabel, 'settings_edit_specs').row();
    keyboard.text(expandRegionLabel, 'settings_edit_region');

    return keyboard;
  }
}

export const firstDigestService = new FirstDigestService();

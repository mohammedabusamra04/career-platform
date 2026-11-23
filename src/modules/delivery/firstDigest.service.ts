import type { PrismaClient } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import ms from 'ms';
import { prisma } from '../../shared/database/prisma.service.js';
import { equivalenceMatchingService } from '../matching/equivalenceMatching.service.js';
import { transparentExplanationBuilder } from '../matching/scoreReason.builder.js';
import type { ScorableJob } from '../matching/scoring.calculator.js';
import type { Specialization, RegionPreference } from '../preferences/preference.taxonomy.js';
import type { DigestCardJob } from '../notifications/telegram/digestCard.formatter.js';
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

function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export class FirstDigestService {
  constructor(private readonly db: PrismaClient = prisma) {}

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

    // 1. Fetch active jobs from PostgreSQL filtered by candidate specializations
    let activeJobs = await this.db.job.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { primarySpecialization: { in: preferences.specializations } },
          { secondarySpecialization: { in: preferences.specializations } },
        ],
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
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: 250,
    });

    // If shared pool currently has 0 active jobs for this stack (e.g. fresh environment or first subscriber),
    // trigger an on-demand collection from configured sources so user receives matches immediately!
    if (activeJobs.length === 0 && process.env.NODE_ENV !== 'test') {
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

          // Re-query database after collection
          activeJobs = await this.db.job.findMany({
            where: {
              status: 'ACTIVE',
              OR: [
                { primarySpecialization: { in: preferences.specializations } },
                { secondarySpecialization: { in: preferences.specializations } },
              ],
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
            },
            orderBy: {
              publishedAt: 'desc',
            },
            take: 250,
          });
        }
      } catch (err: unknown) {
        logger.warn(`[FirstDigestService] On-demand fallback collection failed: ${(err as Error).message}`);
      }
    }

    if (activeJobs.length === 0) {
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
    const existingSent = await this.db.sentJob.findMany({
      where: { userId },
      select: { jobId: true },
    });
    const sentJobIds = new Set(existingSent.map((s) => s.jobId));

    // 3. Match and score jobs using equivalenceMatchingService
    const group = {
      preferenceHash: preferences.preferenceHash || 'first-digest-adhoc',
      specializations: preferences.specializations,
      regionPreference: preferences.regionPreference,
      experienceLevel: preferences.experienceLevel ?? null,
      workType: preferences.workType ?? null,
      userIds: [userId],
    };

    const scorableJobs = activeJobs.map(mapToScorableJob);
    const scoredGroupJobs = equivalenceMatchingService.matchGroup(
      group,
      scorableJobs,
    );

    // 4. Personalize by subtracting already sent jobs (up to 20 top matches)
    const personalizedMatches = equivalenceMatchingService.personalizeForMember(
      scoredGroupJobs,
      sentJobIds,
      20,
    );

    if (personalizedMatches.length === 0) {
      return {
        hasMatches: false,
        totalMatches: 0,
        page: 1,
        totalPages: 0,
        jobs: [],
        deliveredJobIds: [],
      };
    }

    // 5. Slice Page 1 (top 5 jobs) with valid IDs
    const pageJobs = personalizedMatches.slice(0, pageSize);
    const validPageJobs = pageJobs.filter(
      (p) => typeof p.job.id === 'string' && p.job.id.length > 0,
    );
    const deliveredJobIds = validPageJobs.map((p) => p.job.id as string);

    const durationMs = Date.now() - startTime;
    logger.info(
      `[FirstDigestService] Prepared ${deliveredJobIds.length} candidate jobs for user ${userId} in ${durationMs}ms`,
    );

    const candidates: FirstDigestCandidate[] = validPageJobs.map((item) => {
      const explanationContext = {
        job: item.job,
        preferences: {
          specializations: preferences.specializations,
          regionPreference: preferences.regionPreference,
          experienceLevel: preferences.experienceLevel,
        },
      };

      const explanationAr = transparentExplanationBuilder.formatScoreReport(
        item.scoring,
        explanationContext,
        'ar',
      );

      const explanationEn = transparentExplanationBuilder.formatScoreReport(
        item.scoring,
        explanationContext,
        'en',
      );

      const rawCompany =
        'company' in item.job ? String((item.job as { company?: unknown }).company || '') : '';

      return {
        jobId: item.job.id as string,
        title: item.job.title || 'Untitled',
        company: rawCompany || 'Company',
        url: item.job.url || item.job.applicationUrl || '',
        applicationUrl: item.job.applicationUrl,
        location: item.job.location,
        country: item.job.country,
        remoteScope: item.job.remoteScope,
        score: item.scoring.score,
        explanationAr,
        explanationEn,
      };
    });

    const totalPages = Math.ceil(personalizedMatches.length / pageSize);

    return {
      hasMatches: true,
      totalMatches: personalizedMatches.length,
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
    const userPref = await this.db.userPreference.findUnique({
      where: { userId },
    });

    if (!userPref || !userPref.specializations?.length) {
      return [];
    }

    const specs = userPref.specializations as Specialization[];
    const activeJobs = await this.db.job.findMany({
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
      take: 250,
    });

    if (activeJobs.length === 0) {
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

    const group = {
      preferenceHash: userPref.preferenceHash || 'digest-pagination',
      specializations: specs,
      regionPreference: userPref.regionPreference as RegionPreference,
      experienceLevel: userPref.experienceLevel ?? null,
      workType: userPref.workType ?? null,
      userIds: [userId],
    };

    const scorableJobs = activeJobs.map(mapToScorableJob);
    const scored = equivalenceMatchingService.matchGroup(
      group,
      scorableJobs,
    );

    const personalized = equivalenceMatchingService.personalizeForMember(
      scored,
      historicalSentIds,
      20,
    );

    return personalized.map((item) => {
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
          const safeTitle = escapeMarkdown(item.title);
          const safeCompany = escapeMarkdown(item.company);
          const remoteInfo =
            item.remoteScope === 'WORLDWIDE'
              ? '🌍 Worldwide Remote'
              : item.country
                ? `📍 ${item.country}`
                : '🏢 Flexible';

          const titleLine = item.url
            ? `*${idx + 1}.* 💻 [${safeTitle}](${item.url})`
            : `*${idx + 1}.* 💻 *${safeTitle}*`;

          return [
            titleLine,
            `🏢 *Company:* ${safeCompany} • ${remoteInfo}`,
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
        const safeTitle = escapeMarkdown(item.title);
        const safeCompany = escapeMarkdown(item.company);
        const remoteInfo =
          item.remoteScope === 'WORLDWIDE'
            ? '🌍 عن بُعد (عالمياً)'
            : item.country
              ? `📍 ${item.country}`
              : '🏢 مرن';

        const titleLine = item.url
          ? `*${idx + 1}.* 💻 [${safeTitle}](${item.url})`
          : `*${idx + 1}.* 💻 *${safeTitle}*`;

        return [
          titleLine,
          `🏢 *الشركة:* ${safeCompany} • ${remoteInfo}`,
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

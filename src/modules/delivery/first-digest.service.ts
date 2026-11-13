import type { PrismaClient } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import { prisma } from '../../shared/database/prisma.service.js';
import {
  equivalenceMatchingService,
} from '../matching/equivalence-matching.service.js';
import { transparentExplanationBuilder } from '../matching/score-reason.builder.js';
import type { ScorableJob } from '../matching/scoring.calculator.js';
import type {
  Specialization,
  RegionPreference,
} from '../preferences/preference.taxonomy.js';
import logger from '../../shared/utils/logger.js';

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
    const activeJobs = await this.db.job.findMany({
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
      take: 100,
    });

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

    const scoredGroupJobs = equivalenceMatchingService.matchGroup(
      group,
      activeJobs as unknown as ScorableJob[],
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
    const validPageJobs = pageJobs.filter((p) => typeof p.job.id === 'string' && p.job.id.length > 0);
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

      const rawCompany = 'company' in item.job ? String((item.job as { company?: unknown }).company || '') : '';

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
   * Formats candidate job cards into an elegant bilingual Telegram message.
   */
  public formatDigestMessage(
    digest: FirstDigestResult,
    options?: { singleDailyRunTime?: string; language?: 'ar' | 'en' },
  ): string {
    const runTime = options?.singleDailyRunTime || '21:00';
    const lang = options?.language || 'ar';

    if (!digest.hasMatches || digest.jobs.length === 0) {
      if (lang === 'en') {
        return (
          `🔍 **No jobs currently match your criteria**\n\n` +
          `Your preferences have been saved successfully! You will automatically receive your personalized digest in the next evening slot (${runTime}) as soon as matching opportunities are collected.\n\n` +
          `💡 You can broaden your search or adjust your settings anytime via /settings`
        );
      }

      return (
        `🔍 **لا توجد وظائف مطابقة تماماً لتخصصك حالياً**\n\n` +
        `لقد تم حفظ تفضيلاتك بنجاح! سيقوم البوت بإشعارك تلقائياً في الملخص المسائي القادم (${runTime}) فور رصد فرص جديدة تناسب مجالك.\n\n` +
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
          const link = item.url ? `[Apply Here](${item.url})` : '';
          const remoteInfo =
            item.remoteScope === 'WORLDWIDE'
              ? '🌍 Worldwide Remote'
              : item.country
                ? `📍 ${item.country}`
                : '🏢 Flexible';

          return (
            `*${idx + 1}\\. ${safeTitle}*\n` +
            `🏢 *Company:* ${safeCompany}\n` +
            `🌐 *Work Scope:* ${remoteInfo}\n` +
            `${item.explanationEn}\n` +
            `🔗 ${link}\n`
          );
        })
        .join('\n────────────────────\n\n');

      const footer =
        `\n────────────────────\n` +
        `📬 **Note:** You will receive your daily updated digest once every evening at your leisure time (${runTime}).`;

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
        const link = item.url ? `[التقديم من هنا](${item.url})` : '';
        const remoteInfo =
          item.remoteScope === 'WORLDWIDE'
            ? '🌍 عن بُعد (عالمياً)'
            : item.country
              ? `📍 ${item.country}`
              : '🏢 مرن';

        return (
          `*${idx + 1}\\. ${safeTitle}*\n` +
          `🏢 *الشركة:* ${safeCompany}\n` +
          `🌐 *نطاق العمل:* ${remoteInfo}\n` +
          `${item.explanationAr}\n` +
          `🔗 ${link}\n`
        );
      })
      .join('\n────────────────────\n\n');

    const footer =
      `\n────────────────────\n` +
      `📬 **ملاحظة:** سنرسل لك ملخصك المحدث تلقائياً مرة واحدة يومياً في ساعة الراحة المسائية (${runTime}).`;

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

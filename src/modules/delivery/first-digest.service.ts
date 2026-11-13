import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../shared/database/prisma.service.js';
import {
  equivalenceMatchingService,
} from '../matching/equivalence-matching.service.js';
import { transparentExplanationBuilder } from '../matching/score-reason.builder.js';
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

    // 1. Fetch active jobs from PostgreSQL
    const activeJobs = await this.db.job.findMany({
      where: {
        status: 'ACTIVE',
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
      take: 200, // Top fresh pool to evaluate
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

    const scoredGroupJobs = equivalenceMatchingService.matchGroup(group, activeJobs as any);

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

    // 5. Slice Page 1 (top 5 jobs)
    const pageJobs = personalizedMatches.slice(0, pageSize);
    const deliveredJobIds = pageJobs.map((p) => p.job.id!).filter(Boolean);

    // 6. Record delivered jobs transactionally in SentJob
    if (deliveredJobIds.length > 0) {
      await this.db.sentJob.createMany({
        data: deliveredJobIds.map((jobId) => ({
          userId,
          jobId,
        })),
        skipDuplicates: true,
      });
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      `[FirstDigestService] Delivered ${deliveredJobIds.length} jobs for user ${userId} in ${durationMs}ms`,
    );

    const candidates: FirstDigestCandidate[] = pageJobs.map((item) => {
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

      return {
        jobId: item.job.id!,
        title: item.job.title || 'Untitled',
        company: (item.job as any).company || 'Company',
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
          `Your preferences have been saved successfully! You will automatically receive your personalized digest in the next evening slot (${runTime}) as soon as matching opportunities are collected ✨\n\n` +
          `💡 You can broaden your search or adjust your settings anytime via /settings`
        );
      }

      return (
        `🔍 **لا توجد وظائف مطابقة تماماً لتخصصك حالياً**\n\n` +
        `لقد تم حفظ تفضيلاتك بنجاح! سيقوم البوت بإشعارك تلقائياً في الملخص المسائي القادم (${runTime}) فور رصد فرص جديدة تناسب مجالك ✨\n\n` +
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
          const link = item.url ? `[Apply Here](${item.url})` : '';
          const remoteInfo =
            item.remoteScope === 'WORLDWIDE'
              ? '🌍 Worldwide Remote'
              : item.country
                ? `📍 ${item.country}`
                : '🏢 Flexible';

          return (
            `**${idx + 1}. ${item.title}**\n` +
            `🏢 **Company:** ${item.company}\n` +
            `🌐 **Work Scope:** ${remoteInfo}\n` +
            `${item.explanationEn}\n` +
            `🔗 ${link}\n`
          );
        })
        .join('\n────────────────────\n\n');

      const footer =
        `\n────────────────────\n` +
        `📬 **Note:** You will receive your daily updated digest once every evening at your leisure time (${runTime}) ✨`;

      return `${header}${jobCards}${footer}`;
    }

    const header =
      `🎉 **أول ملخص مخصص لك فور انضمامك!**\n` +
      `اخترنا لك أفضل ${digest.jobs.length} فرصة مطابقة لملفك حالياً:\n` +
      `────────────────────\n\n`;

    const jobCards = digest.jobs
      .map((item, idx) => {
        const link = item.url ? `[التقديم من هنا](${item.url})` : '';
        const remoteInfo =
          item.remoteScope === 'WORLDWIDE'
            ? '🌍 عن بُعد (عالمياً)'
            : item.country
              ? `📍 ${item.country}`
              : '🏢 مرن';

        return (
          `**${idx + 1}. ${item.title}**\n` +
          `🏢 **الشركة:** ${item.company}\n` +
          `🌐 **نطاق العمل:** ${remoteInfo}\n` +
          `${item.explanationAr}\n` +
          `🔗 ${link}\n`
        );
      })
      .join('\n────────────────────\n\n');

    const footer =
      `\n────────────────────\n` +
      `📬 **ملاحظة:** سنرسل لك ملخصك المحدث تلقائياً مرة واحدة يومياً في ساعة الراحة المسائية (${runTime}) ✨`;

    return `${header}${jobCards}${footer}`;
  }
}

export const firstDigestService = new FirstDigestService();

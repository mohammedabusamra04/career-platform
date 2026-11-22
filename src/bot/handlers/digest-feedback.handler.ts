import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import type { ISentJobRepository } from '../../modules/notifications/repositories/sent-job.repository.interface.js';
import { sentJobRepository as defaultSentJobRepository } from '../../modules/notifications/repositories/prisma-sent-job.repository.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface DigestFeedbackHandlerDependencies {
  userRepository?: IUserRepository;
  sentJobRepository?: ISentJobRepository;
}

const defaultUserRepository = new PrismaUserRepository();

/**
 * Returns the confirmation toast message based on user language (DeployMe tone).
 */
export function getDigestFeedbackToastMessage(lang: SupportedLanguage = 'ar'): string {
  if (lang === 'en') {
    return 'Feedback logged! Tuning your stack feed 🎯';
  }
  return 'تم تسجيل تقييمك! رح نضبطلك الفلتر للجايات 🎯';
}

/**
 * Registers Telegram callback query handlers for inline job feedback (TASK-43.3).
 *
 * Catches callback queries matching: `^feedback:(like|dislike):([a-zA-Z0-9_-]+)$`
 * - Answers callback query promptly with a confirmation toast.
 * - Idempotently persists feedback state (LIKE or DISLIKE) to SentJob in PostgreSQL.
 * - Bilingual support for Arabic and English.
 */
export function registerDigestFeedbackHandler(
  bot: Bot<BotContext>,
  deps?: DigestFeedbackHandlerDependencies,
): void {
  const userRepo = deps?.userRepository ?? defaultUserRepository;
  const sentJobRepo = deps?.sentJobRepository ?? defaultSentJobRepository;

  // 1. Star Rating Callback Handler: feedback:rate:([1-5])
  bot.callbackQuery(/^feedback:rate:([1-5])$/, async (ctx) => {
    const stars = parseInt(ctx.match?.[1] || '5', 10);
    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const isAr = lang === 'ar';

    const toastMessage = isAr
      ? `شكراً لتقييمك (${stars}/5 نجوم)! رح نضبطلك الفرص للجايات ⭐️`
      : `Thanks for rating (${stars}/5 stars)! Tuning your feed ⭐️`;

    try {
      await ctx.answerCallbackQuery({
        text: toastMessage,
      });
    } catch (err: unknown) {
      logger.warn(`[DigestFeedbackHandler] Failed answering rate callback: ${(err as Error).message}`);
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (user) {
        logger.info(`[DigestFeedbackHandler] User ${user.id} submitted a ${stars}-star rating.`);
      }
    } catch (err: unknown) {
      logger.error(`[DigestFeedbackHandler] Error processing star rating: ${(err as Error).message}`);
    }
  });

  // 2. Individual Job Feedback (LIKE / DISLIKE) Callback Handler
  bot.callbackQuery(/^feedback:(like|dislike):([a-zA-Z0-9_-]+)$/, async (ctx) => {
    const rawAction = ctx.match?.[1];
    const jobId = ctx.match?.[2];

    if (!jobId || !rawAction) {
      return;
    }

    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const toastMessage = getDigestFeedbackToastMessage(lang);

    // 1. Immediately acknowledge the callback query with confirmation toast
    // to provide instant visual feedback and stop Telegram button loading spinner
    try {
      await ctx.answerCallbackQuery({
        text: toastMessage,
      });
    } catch (err: unknown) {
      logger.warn(`[DigestFeedbackHandler] Failed answering callback query: ${(err as Error).message}`);
    }

    // 2. Identify user from Telegram ID
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        logger.warn(`[DigestFeedbackHandler] User not found for telegramId: ${telegramId}`);
        return;
      }

      // 3. Persist feedback state to SentJob
      const feedbackType = rawAction === 'like' ? 'LIKE' : 'DISLIKE';
      await sentJobRepo.recordFeedback(user.id, jobId, feedbackType);

      logger.info(
        `[DigestFeedbackHandler] Feedback "${feedbackType}" recorded for user ${user.id} and job ${jobId}`,
      );
    } catch (err: unknown) {
      logger.error(
        `[DigestFeedbackHandler] Error persisting feedback for jobId ${jobId}: ${(err as Error).message}`,
      );
    }
  });
}
import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prismaUser.repository.js';
import {
  firstDigestService as defaultFirstDigestService,
  type FirstDigestService,
} from '../../modules/delivery/firstDigest.service.js';
import {
  formatDigestPageMessage,
  paginateDigestJobs,
} from '../../modules/notifications/telegram/digestCard.formatter.js';
import { buildDigestPaginationKeyboard } from '../keyboards/digestPagination.keyboard.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface DigestPaginationHandlerDependencies {
  userRepository?: IUserRepository;
  firstDigestService?: FirstDigestService;
}

const defaultUserRepository = new PrismaUserRepository();

/**
 * Registers Telegram callback query handlers for inline digest pagination (TASK-43.2).
 *
 * Provides in-place message editing via `ctx.editMessageText` when users click
 * pagination buttons (`digest:page:<targetPage>`), keeping the chat clean without
 * cluttering the chat history with new messages.
 */
export function registerDigestPaginationHandler(
  bot: Bot<BotContext>,
  deps?: DigestPaginationHandlerDependencies,
): void {
  const userRepo = deps?.userRepository ?? defaultUserRepository;
  const digestService = deps?.firstDigestService ?? defaultFirstDigestService;

  // 1. Non-action page indicator button callback
  bot.callbackQuery('digest:noop', async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (err: unknown) {
      logger.warn(`[DigestPaginationHandler] Stale noop callback: ${(err as Error).message}`);
    }
  });

  // 2. Pagination callback: digest:page:<targetPage>
  bot.callbackQuery(/^digest:page:(\d+)$/, async (ctx) => {
    // Acknowledge the callback immediately to prevent Telegram client spinner hanging
    try {
      await ctx.answerCallbackQuery();
    } catch (err: unknown) {
      logger.warn(`[DigestPaginationHandler] Failed acknowledging page callback: ${(err as Error).message}`);
    }

    const rawPage = ctx.match?.[1];
    const targetPage = rawPage ? parseInt(rawPage, 10) : 1;

    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const lang: SupportedLanguage = ctx.session?.language || 'ar';

    try {
      // Lookup user in PostgreSQL
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        logger.warn(`[DigestPaginationHandler] User not found for telegramId: ${telegramId}`);
        return;
      }

      // Retrieve up to 20 candidate jobs matching user preferences
      const candidateJobs = await digestService.getPersonalizedDigestJobs(user.id);
      if (candidateJobs.length === 0) {
        return;
      }

      const pagination = paginateDigestJobs(candidateJobs, targetPage, 5, 20);
      const formattedMessage = formatDigestPageMessage(candidateJobs, {
        language: lang,
        pageNumber: pagination.currentPage,
        pageSize: 5,
        maxJobs: 20,
      });

      const keyboard = buildDigestPaginationKeyboard(
        pagination.currentPage,
        pagination.totalPages,
        lang,
        pagination.pagedJobs,
      );

      // Edit message in-place without producing new chat messages
      await ctx.editMessageText(formattedMessage, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });

      // Record displayed jobs to SentJob ONLY after in-place edit succeeds
      const displayedJobIds = pagination.pagedJobs
        .map((job) => job.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      if (displayedJobIds.length > 0) {
        await digestService.recordDeliveredJobs(user.id, displayedJobIds);
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message || '';
      // Telegram throws an error if editMessageText is called with identical content
      if (errMsg.includes('message is not modified')) {
        return;
      }
      logger.error(`[DigestPaginationHandler] Error editing digest message: ${errMsg}`);
    }
  });
}


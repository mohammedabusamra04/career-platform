import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prismaUser.repository.js';
import {
  jobExplorerService as defaultJobExplorerService,
  type JobExplorerService,
  type JobSortOrder,
} from '../../modules/jobs/jobExplorer.service.js';
import {
  buildJobExplorerKeyboard,
  buildJobExplorerEmptyKeyboard,
} from '../keyboards/jobExplorer.keyboard.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface JobsHandlerDependencies {
  userRepository?: IUserRepository;
  jobExplorerService?: JobExplorerService;
}

const defaultUserRepository = new PrismaUserRepository();

/**
 * Registers Telegram command and callback handlers for the `/jobs` database explorer engine.
 *
 * Implements TASK-44:
 * - Query PostgreSQL pool directly with user's active preferences in <300ms.
 * - Zero external scraping: never invokes remote crawler adapters.
 * - Varied dynamic headers so users never get bored.
 * - Keyset 5 jobs per page pagination with in-place message editing.
 * - Sorting toggle between Best Match and Latest.
 */
export function registerJobsHandler(
  bot: Bot<BotContext>,
  deps?: JobsHandlerDependencies,
): void {
  const userRepo = deps?.userRepository ?? defaultUserRepository;
  const explorerService = deps?.jobExplorerService ?? defaultJobExplorerService;

  // 1. /jobs Command: Open on-demand explorer
  bot.command('jobs', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const isArabic = lang === 'ar';

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        const notConfiguredMsg = isArabic
          ? '⚠️ لسا ما ضبطت الـ Stack تبعك! ابعت /start عشان تختار تخصصاتك ونشغّلك الرادار.'
          : "⚠️ Your stack isn't configured yet! Send /start to pick your specializations.";
        await ctx.reply(notConfiguredMsg);
        return;
      }

      const sort: JobSortOrder = ctx.session?.jobsSort || 'BEST_MATCH';
      const result = await explorerService.getJobsForUser(user.id, {
        page: 1,
        pageSize: 5,
        sort,
      });

      if (!result.hasMatches || result.jobs.length === 0) {
        const emptyMsg = explorerService.formatJobsExplorerMessage(result, { language: lang });
        await ctx.reply(emptyMsg, {
          parse_mode: 'Markdown',
          reply_markup: buildJobExplorerEmptyKeyboard(lang),
        });
        return;
      }

      const formattedMessage = explorerService.formatJobsExplorerMessage(result, {
        language: lang,
      });

      const keyboard = buildJobExplorerKeyboard({
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        sort: result.sort,
        language: lang,
        jobs: result.jobs,
      });

      await ctx.reply(formattedMessage, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.error(`[JobsHandler] Error executing /jobs: ${(err as Error).message}`);
      const errorMsg = isArabic
        ? '⚠️ تعذر سحب الفرص حالياً، جرّب كمان شوي.'
        : "⚠️ Couldn't fetch roles right now. Try again shortly.";
      await ctx.reply(errorMsg);
    }
  });

  // 2. Non-action page indicator button callback
  bot.callbackQuery('jobs:noop', async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (err: unknown) {
      logger.warn(`[JobsHandler] Stale noop callback: ${(err as Error).message}`);
    }
  });

  // 3. Keyset Pagination Callback: jobs:page:<sort>:<targetPage> or legacy jobs:page:<targetPage>
  bot.callbackQuery(/^jobs:page:(?:(BEST_MATCH|LATEST):)?(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (err: unknown) {
      logger.warn(`[JobsHandler] Failed acknowledging page callback: ${(err as Error).message}`);
    }

    // Read sort order directly from stateless callback data; fallback to session or default
    const rawSort = ctx.match?.[1] as JobSortOrder | undefined;
    const rawPage = ctx.match?.[2];
    const targetPage = rawPage ? parseInt(rawPage, 10) : 1;
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const sort: JobSortOrder = rawSort || ctx.session?.jobsSort || 'BEST_MATCH';

    if (ctx.session && rawSort) {
      ctx.session.jobsSort = rawSort;
    }

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        logger.warn(`[JobsHandler] User not found for telegramId: ${telegramId}`);
        return;
      }

      const result = await explorerService.getJobsForUser(user.id, {
        page: targetPage,
        pageSize: 5,
        sort,
      });

      if (result.jobs.length === 0) return;

      const formattedMessage = explorerService.formatJobsExplorerMessage(result, {
        language: lang,
      });

      const keyboard = buildJobExplorerKeyboard({
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        sort: result.sort,
        language: lang,
        jobs: result.jobs,
      });

      await ctx.editMessageText(formattedMessage, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      const errMsg = (err as Error).message || '';
      if (errMsg.includes('message is not modified')) {
        return;
      }
      logger.error(`[JobsHandler] Error paginating /jobs: ${errMsg}`);
    }
  });

  // 4. Sorting Toggle Callback: jobs:sort:(BEST_MATCH|LATEST)
  bot.callbackQuery(/^jobs:sort:(BEST_MATCH|LATEST)$/, async (ctx) => {
    const requestedSort = ctx.match?.[1] as JobSortOrder;
    if (!requestedSort) return;

    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const isArabic = lang === 'ar';
    const toastText =
      requestedSort === 'LATEST'
        ? isArabic
          ? '⏱️ الترتيب: الأحدث نزولاً'
          : '⏱️ Sorted by: Latest First'
        : isArabic
          ? '🎯 الترتيب: الأنسب للـ Stack'
          : '🎯 Sorted by: Best Stack Fit';

    try {
      await ctx.answerCallbackQuery({ text: toastText });
    } catch (err: unknown) {
      logger.warn(`[JobsHandler] Failed acknowledging sort callback: ${(err as Error).message}`);
    }

    if (ctx.session) {
      ctx.session.jobsSort = requestedSort;
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) return;

      const result = await explorerService.getJobsForUser(user.id, {
        page: 1,
        pageSize: 5,
        sort: requestedSort,
      });

      const formattedMessage = explorerService.formatJobsExplorerMessage(result, {
        language: lang,
      });

      const keyboard = buildJobExplorerKeyboard({
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        sort: requestedSort,
        language: lang,
        jobs: result.jobs,
      });

      await ctx.editMessageText(formattedMessage, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      const errMsg = (err as Error).message || '';
      if (errMsg.includes('message is not modified')) {
        return;
      }
      logger.error(`[JobsHandler] Error toggling sort for /jobs: ${errMsg}`);
    }
  });
}
import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import { UserStatus } from '../../modules/users/user.types.js';
import { buildPauseKeyboard } from '../keyboards/pause.keyboard.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface PauseResumeHandlerDependencies {
  userRepository?: IUserRepository;
}

const defaultUserRepository = new PrismaUserRepository();

export const PAUSE_MESSAGES = {
  prompt: {
    ar: '⏸️ *إيقاف الـ Pipeline مؤقتاً*\n\nبدك تاخد بريك أو مشغول هالفترة؟ بتقدر توقف الـ Ping مؤقتاً وترجعه وقت ما بدك.\nاختار المدة:',
    en: '⏸️ *Pause DeployMe Pipeline*\n\nTaking a break or heads-down coding? Temporarily pause job pings and resume anytime.\nSelect a duration:',
  },
  paused1d: {
    ar: 'تم إيقاف الـ Pipeline مؤقتاً لمدة 24 ساعة ⏱️\nرح يرجع يشتغل لحاله بكرة، أو ابعت /resume بأي وقت لتشغله فوراً.',
    en: 'Pipeline paused for 24 hours ⏱️\nPings will auto-resume tomorrow, or send /resume anytime to bring it back live.',
  },
  paused7d: {
    ar: 'تم إيقاف الـ Pipeline مؤقتاً لمدة أسبوع (7 أيام) 📅\nرح يرجع يشتغل لحاله بعد 7 أيام، أو ابعت /resume بأي وقت لتشغله فوراً.',
    en: 'Pipeline paused for 1 week 📅\nPings will auto-resume in 7 days, or send /resume anytime to bring it back live.',
  },
  pausedIndefinite: {
    ar: 'تم إيقاف الـ Pipeline مؤقتاً حتى تشغله يدوياً ⏸️\nلما تكون جاهز ترجع تستقبل فرص، ابعت: /resume',
    en: 'Pipeline paused until manually resumed ⏸️\nWhenever you are ready for job pings again, send /resume.',
  },
  cancel: {
    ar: 'تم إلغاء الإيقاف المؤقت — رادار DeployMe لسا شغال Live 📡',
    en: 'Pause cancelled — your DeployMe pipeline is still live 📡',
  },
  resumed: {
    ar: 'رجعنا Live! تم استئناف الـ Pipeline بنجاح ⚡\nرح نكمل نفلتر السوق ونعملك Ping بأقوى الفرص المطابقة لـ Stack تبعك.',
    en: 'Back live! Your DeployMe pipeline has been resumed ⚡\nWe will keep scanning and ping you with roles matching your stack.',
  },
  alreadyActive: {
    ar: 'رادار DeployMe شغال Live أصلاً 📡\nالـ Pipeline مفعّل ورح توصلك الفرص المطابقة أول بأول.',
    en: 'Your DeployMe pipeline is already live 📡\nYou are all set to receive matching job pings.',
  },
  notRegistered: {
    ar: 'لسا ما ضبطت حسابك على DeployMe! ابعت /start عشان تختار الـ Stack تبعك ونشغّلك الرادار ⚡',
    en: 'No stack config found yet! Send /start to set up your DeployMe pipeline ⚡',
  },
  errorSave: {
    ar: '⚠️ صار خطأ تقني أثناء حفظ الإعداد. جرّب كمان شوي.',
    en: '⚠️ Something went wrong saving your setting. Please try again shortly.',
  },
  errorResume: {
    ar: '⚠️ تعذر تشغيل الـ Pipeline حالياً. جرّب كمان شوي.',
    en: '⚠️ Could not resume your pipeline right now. Please try again shortly.',
  },
};

export function registerPauseResumeHandler(
  bot: Bot<BotContext>,
  deps: PauseResumeHandlerDependencies = {},
): void {
  const userRepository = deps.userRepository ?? defaultUserRepository;

  bot.command('pause', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(PAUSE_MESSAGES.notRegistered[lang]);
      return;
    }

    const keyboard = buildPauseKeyboard(lang);
    await ctx.reply(PAUSE_MESSAGES.prompt[lang], {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery('pause_1d', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, pausedUntil);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts for 24h until ${pausedUntil.toISOString()}`);

      await ctx.editMessageText(PAUSE_MESSAGES.paused1d[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} for 24h: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply(PAUSE_MESSAGES.errorSave[lang]);
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_7d', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const pausedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, pausedUntil);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts for 7d until ${pausedUntil.toISOString()}`);

      await ctx.editMessageText(PAUSE_MESSAGES.paused7d[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} for 7d: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply(PAUSE_MESSAGES.errorSave[lang]);
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_indefinite', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, null);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts indefinitely`);

      await ctx.editMessageText(PAUSE_MESSAGES.pausedIndefinite[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} indefinitely: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply(PAUSE_MESSAGES.errorSave[lang]);
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_cancel', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    await ctx.editMessageText(PAUSE_MESSAGES.cancel[lang]);
    await ctx.answerCallbackQuery();
  });

  bot.command('resume', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(PAUSE_MESSAGES.notRegistered[lang]);
      return;
    }

    if (user.status === UserStatus.PAUSED || user.pausedUntil !== null) {
      try {
        await userRepository.updateStatus(telegramId, UserStatus.ACTIVE, null);
        logger.info(`[PauseResumeHandler] User ${telegramId} resumed alerts`);
        await ctx.reply(PAUSE_MESSAGES.resumed[lang]);
      } catch (error) {
        logger.error(`[PauseResumeHandler] Failed to resume user ${telegramId}: ${error instanceof Error ? error.message : String(error)}`);
        await ctx.reply(PAUSE_MESSAGES.errorResume[lang]);
      }
    } else {
      await ctx.reply(PAUSE_MESSAGES.alreadyActive[lang]);
    }
  });
}
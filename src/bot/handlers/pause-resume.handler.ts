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
    ar: '⏸️ *إيقاف التنبيهات مؤقتاً*\n\nيمكنك إيقاف إرسال إشعارات الوظائف مؤقتاً إذا كنت في إجازة أو مشغولاً.\nاختر المدة المناسبة:',
    en: '⏸️ *Pause Job Alerts*\n\nYou can temporarily pause job alerts during vacations or busy periods.\nSelect a duration:',
  },
  paused1d: {
    ar: 'تم إيقاف التنبيهات مؤقتاً لمدة 24 ساعة ⏱️\nستعود الإشعارات تلقائياً غداً، أو يمكنك كتابة /resume في أي وقت للاستئناف.',
    en: 'Job alerts paused for 24 hours ⏱️\nAlerts will resume automatically tomorrow, or type /resume anytime to unpause.',
  },
  paused7d: {
    ar: 'تم إيقاف التنبيهات مؤقتاً لمدة أسبوع (7 أيام) 📅\nستعود الإشعارات تلقائياً بعد 7 أيام، أو يمكنك كتابة /resume في أي وقت للاستئناف.',
    en: 'Job alerts paused for 1 week 📅\nAlerts will resume automatically after 7 days, or type /resume anytime to unpause.',
  },
  pausedIndefinite: {
    ar: 'تم إيقاف التنبيهات مؤقتاً حتى تقوم بالاستئناف يدوياً ⏸️\nلإعادة تفعيل التنبيهات في أي وقت، اكتب: /resume',
    en: 'Job alerts paused indefinitely ⏸️\nTo resume receiving notifications anytime, send /resume.',
  },
  cancel: {
    ar: 'تم إلغاء الإيقاف المؤقت، تنبيهات الوظائف لا تزال نشطة ومفعّلة 🔔',
    en: 'Pause cancelled. Your job alerts remain active 🔔',
  },
  resumed: {
    ar: 'تم استئناف إشعارات الوظائف بنجاح 🚀\nسنقوم بإرسال أحدث الفرص المطابقة لتفضيلاتك بانتظام.',
    en: 'Job alerts have been resumed successfully 🚀\nYou will receive matching job opportunities regularly.',
  },
  alreadyActive: {
    ar: 'إشعاراتك مفعّلة ونشطة بالفعل 🔔\nستصلك الفرص المطابقة بانتظام دون انقطاع.',
    en: 'Your job alerts are already active 🔔\nYou are set to receive matching opportunities without interruption.',
  },
  notRegistered: {
    ar: 'لم يتم العثور على حساب مسجل. يرجى كتابة /start للبدء وضبط تفضيلاتك 🚀',
    en: 'No registered profile found. Please type /start to set up your preferences 🚀',
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

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
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

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, pausedUntil);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts for 24h until ${pausedUntil.toISOString()}`);

      await ctx.editMessageText(PAUSE_MESSAGES.paused1d[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} for 24h: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply('حدث خطأ أثناء حفظ التفضيل. يرجى المحاولة لاحقاً.');
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_7d', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    const pausedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, pausedUntil);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts for 7d until ${pausedUntil.toISOString()}`);

      await ctx.editMessageText(PAUSE_MESSAGES.paused7d[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} for 7d: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply('حدث خطأ أثناء حفظ التفضيل. يرجى المحاولة لاحقاً.');
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_indefinite', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';

    try {
      await userRepository.updateStatus(telegramId, UserStatus.PAUSED, null);
      logger.info(`[PauseResumeHandler] User ${telegramId} paused alerts indefinitely`);

      await ctx.editMessageText(PAUSE_MESSAGES.pausedIndefinite[lang]);
    } catch (error) {
      logger.error(`[PauseResumeHandler] Failed to pause user ${telegramId} indefinitely: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply('حدث خطأ أثناء حفظ التفضيل. يرجى المحاولة لاحقاً.');
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('pause_cancel', async (ctx) => {
    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    await ctx.editMessageText(PAUSE_MESSAGES.cancel[lang]);
    await ctx.answerCallbackQuery();
  });

  bot.command('resume', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
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
        await ctx.reply('حدث خطأ أثناء استئناف التنبيهات. يرجى المحاولة لاحقاً.');
      }
    } else {
      await ctx.reply(PAUSE_MESSAGES.alreadyActive[lang]);
    }
  });
}

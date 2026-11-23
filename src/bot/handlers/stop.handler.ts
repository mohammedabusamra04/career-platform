import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../modules/preferences/repositories/userPreference.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prismaUser.repository.js';
import { PrismaUserPreferenceRepository } from '../../modules/preferences/repositories/prismaUserPreference.repository.js';
import { UserStatus } from '../../modules/users/user.types.js';
import { buildStopKeyboard } from '../keyboards/stop.keyboard.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface StopHandlerDependencies {
  userRepository?: IUserRepository;
  preferenceRepository?: IUserPreferenceRepository;
}

const defaultUserRepository = new PrismaUserRepository();
const defaultPreferenceRepository = new PrismaUserPreferenceRepository();

export const STOP_MESSAGES = {
  warning: {
    ar: '⚠️ *تأكيد حذف الحساب والبيانات*\n\nمتأكد إنك بدك تلغي الاشتراك وتمسح بياناتك من DeployMe؟\nرح يتم حذف إعدادات الـ Stack تبعك وإيقاف الـ Pipeline نهائياً.',
    en: '⚠️ *Confirm Account & Data Deletion*\n\nAre you sure you want to unsubscribe and delete your DeployMe profile?\nYour stack config will be erased and all pings will stop permanently.',
  },
  deleted: {
    ar: 'تم إلغاء اشتراكك وحذف بياناتك بنجاح ✅\n\nتم مسح إعدادات الـ Stack وتجريد حسابك من أي بيانات شخصية.\nلو حبيت ترجع بأي وقت مستقبلاً، ابعت /start لنبدأ من جديد.',
    en: "Your account has been deleted successfully ✅\n\nYour stack config has been erased and personal identifiers removed.\nIf you ever want to jump back in, send /start anytime.",
  },
  cancelled: {
    ar: 'تم التراجع — حسابك والـ Pipeline تبعك لسا شغالين ومحميين 🛡️',
    en: 'Cancelled — your DeployMe profile and pipeline remain live and safe 🛡️',
  },
  alreadyDeleted: {
    ar: 'حسابك محذوف أصلاً. بتقدر تبعت /start بأي وقت لتنشئ حساب جديد وتضبط الـ Stack تبعك ⚡',
    en: 'Your account is already deleted. Send /start anytime to set up a fresh stack config ⚡',
  },
  notRegistered: {
    ar: 'لسا ما ضبطت حسابك على DeployMe! ابعت /start عشان تختار الـ Stack تبعك ونشغّلك الرادار ⚡',
    en: 'No registered profile found! Send /start to configure your DeployMe stack ⚡',
  },
  errorDelete: {
    ar: '⚠️ صار خطأ تقني أثناء تنفيذ الحذف. جرّب كمان شوي.',
    en: '⚠️ Something went wrong processing the deletion. Please try again shortly.',
  },
};

export function registerStopHandler(
  bot: Bot<BotContext>,
  deps: StopHandlerDependencies = {},
): void {
  const userRepository = deps.userRepository ?? defaultUserRepository;
  const preferenceRepository = deps.preferenceRepository ?? defaultPreferenceRepository;

  bot.command('stop', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      await ctx.reply(STOP_MESSAGES.notRegistered[lang]);
      return;
    }

    if (user.status === UserStatus.DELETED) {
      await ctx.reply(STOP_MESSAGES.alreadyDeleted[lang]);
      return;
    }

    const keyboard = buildStopKeyboard(lang);
    await ctx.reply(STOP_MESSAGES.warning[lang], {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery('stop_confirm', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      await ctx.editMessageText(STOP_MESSAGES.notRegistered[lang]);
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await userRepository.markAsDeleted(telegramId);
      await preferenceRepository.deleteByUserId(user.id);

      if (ctx.session) {
        ctx.session.step = 'specializations';
        ctx.session.selectedSpecializations = [];
        ctx.session.selectedRegion = undefined;
        ctx.session.preferences = {};
      }

      logger.info(`[StopHandler] User ${telegramId} (${user.id}) soft-deleted and preferences pruned.`);
      await ctx.editMessageText(STOP_MESSAGES.deleted[lang]);
    } catch (error) {
      logger.error(`[StopHandler] Failed to delete user ${telegramId}: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply(STOP_MESSAGES.errorDelete[lang]);
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('stop_cancel', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    await ctx.editMessageText(STOP_MESSAGES.cancelled[lang]);
    await ctx.answerCallbackQuery();
  });
}
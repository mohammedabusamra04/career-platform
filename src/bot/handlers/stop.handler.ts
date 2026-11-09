import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../modules/preferences/repositories/user-preference.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import { PrismaUserPreferenceRepository } from '../../modules/preferences/repositories/prisma-user-preference.repository.js';
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
    ar: '⚠️ *تأكيد حذف الحساب والبيانات*\n\nهل أنت متأكد من رغبتك في إلغاء الاشتراك وحذف بياناتك؟\nسيتم مسح تفضيلاتك الوظيفية وإيقاف إرسال أي إشعارات نهائياً.',
    en: '⚠️ *Confirm Account & Data Deletion*\n\nAre you sure you want to unsubscribe and delete your profile?\nYour job preferences will be deleted and all notifications will stop permanently.',
  },
  deleted: {
    ar: 'تم إلغاء اشتراكك وحذف بياناتك بنجاح ✅\n\nنأسف لمغادرتك! تم مسح تفضيلاتك وتجريد بيانات حسابك من أي معلومات شخصية.\nإذا رغبت في العودة مستقبلاً، يمكنك إرسال /start في أي وقت للبدء من جديد.',
    en: "Your account has been deleted successfully ✅\n\nWe're sorry to see you go. Your preferences have been erased and personal identifiers removed.\nIf you ever wish to return, send /start anytime to begin again.",
  },
  cancelled: {
    ar: 'تم التراجع، حسابك وتفضيلاتك لا تزال نشطة ومحمية 🛡️',
    en: 'Cancelled. Your account and preferences remain active and safe 🛡️',
  },
  alreadyDeleted: {
    ar: 'حسابك محذوف بالفعل. يمكنك إرسال /start لإنشاء حساب جديد وضبط التفضيلات 🚀',
    en: 'Your account is already deleted. You can send /start to create a new profile 🚀',
  },
  notRegistered: {
    ar: 'لم يتم العثور على حساب مسجل. يرجى كتابة /start للبدء وضبط تفضيلاتك 🚀',
    en: 'No registered profile found. Please type /start to set up your preferences 🚀',
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

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
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

    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      await ctx.editMessageText(STOP_MESSAGES.notRegistered[lang]);
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await userRepository.markAsDeleted(telegramId);
      await preferenceRepository.deleteByUserId(user.id);

      ctx.session.step = 'specializations';
      ctx.session.selectedSpecializations = [];
      ctx.session.selectedRegion = undefined;
      ctx.session.preferences = {};

      logger.info(`[StopHandler] User ${telegramId} (${user.id}) soft-deleted and preferences pruned.`);
      await ctx.editMessageText(STOP_MESSAGES.deleted[lang]);
    } catch (error) {
      logger.error(`[StopHandler] Failed to delete user ${telegramId}: ${error instanceof Error ? error.message : String(error)}`);
      await ctx.reply('حدث خطأ أثناء معالجة طلب الحذف. يرجى المحاولة لاحقاً.');
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('stop_cancel', async (ctx) => {
    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    await ctx.editMessageText(STOP_MESSAGES.cancelled[lang]);
    await ctx.answerCallbackQuery();
  });
}

import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../modules/preferences/repositories/user-preference.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import { PrismaUserPreferenceRepository } from '../../modules/preferences/repositories/prisma-user-preference.repository.js';
import {
  RegionPreference,
  Specialization,
} from '../../modules/preferences/preference.taxonomy.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { getWelcomeMessage } from './start.handler.js';
import type { SupportedLanguage } from '../session.js';
import {
  firstDigestService,
  type FirstDigestService,
} from '../../modules/delivery/first-digest.service.js';
import logger from '../../shared/utils/logger.js';

export interface ConfirmationHandlerDependencies {
  userRepository?: IUserRepository;
  preferenceRepository?: IUserPreferenceRepository;
  firstDigestService?: FirstDigestService;
}

const defaultUserRepository = new PrismaUserRepository();
const defaultPreferenceRepository = new PrismaUserPreferenceRepository();
const defaultFirstDigestService = firstDigestService;

const REGION_LABELS = {
  [RegionPreference.BOTH]: {
    ar: '🌍 السوق العربي والدولي معاً',
    en: '🌍 Arab & International Markets',
  },
  [RegionPreference.ARAB]: {
    ar: '🏢 السوق العربي وفرص الشرق الأوسط',
    en: '🏢 Arab & Middle East Market Only',
  },
  [RegionPreference.INTERNATIONAL]: {
    ar: '🌐 السوق الدولي والعمل عن بعد عالمياً',
    en: '🌐 International & Global Remote Only',
  },
};

export function formatSummaryCard(
  specializations: Specialization[],
  region: RegionPreference,
  lang: SupportedLanguage = 'ar',
): string {
  const specsList = specializations.length > 0 ? specializations.join(', ') : 'None';
  const regionLabel = REGION_LABELS[region]
    ? REGION_LABELS[region][lang]
    : REGION_LABELS[RegionPreference.BOTH][lang];

  if (lang === 'en') {
    return (
      `📋 **Review Your Job Alert Preferences**\n\n` +
      `🎯 **Specializations:**\n• ${specsList}\n\n` +
      `📍 **Target Market:**\n• ${regionLabel}\n\n` +
      `⏰ **Delivery Schedule:**\n• You will receive a daily digest of the best matching tech opportunities every day 🚀\n\n` +
      `Click **Confirm & Save** to start receiving your alerts!`
    );
  }

  return (
    `📋 **ملخص تفضيلات تنبيهات الوظائف**\n\n` +
    `🎯 **المجالات والتخصصات المختارة:**\n• ${specsList}\n\n` +
    `📍 **نطاق السوق المستهدف:**\n• ${regionLabel}\n\n` +
    `⏰ **نظام الإرسال:**\n• سيصلك ملخص يومي شامل بأفضل الفرص التقنية المطابقة يومياً 🚀\n\n` +
    `اضغط على **تأكيد وحفظ** للبدء في استلام التنبيهات!`
  );
}

export function registerConfirmationHandler(
  bot: Bot<BotContext>,
  deps: ConfirmationHandlerDependencies = {},
): void {
  const userRepo = deps.userRepository ?? defaultUserRepository;
  const prefRepo = deps.preferenceRepository ?? defaultPreferenceRepository;
  const digestService = deps.firstDigestService ?? defaultFirstDigestService;

  // 1. Confirm and Save: pref_confirm
  bot.callbackQuery('pref_confirm', async (ctx) => {
    const telegramId = ctx.from?.id;
    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const specializations = ctx.session?.selectedSpecializations || [];
    const regionPreference = ctx.session?.selectedRegion || RegionPreference.BOTH;

    if (!telegramId || specializations.length === 0) {
      const errorMsg =
        lang === 'en'
          ? '⚠️ Unable to save preferences. Please run /start to configure your profile.'
          : '⚠️ تعذر حفظ التفضيلات. يرجى البدء مجدداً عبر الأمر /start لإكمال الإعداد.';
      await ctx.answerCallbackQuery({ text: errorMsg, show_alert: true });
      return;
    }

    try {
      // 1. Look up user record
      let user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        user = await userRepo.create({
          telegramId,
          firstName: ctx.from?.first_name || null,
          username: ctx.from?.username || null,
        });
      }

      // 2. Transactionally save preferences
      await prefRepo.savePreferences(user.id, {
        specializations,
        regionPreference,
      });

      // 3. Update session step
      if (ctx.session) {
        ctx.session.step = 'confirmation';
      }

      await ctx.answerCallbackQuery({
        text: lang === 'en' ? 'Preferences saved successfully! ✅' : 'تم حفظ التفضيلات بنجاح! ✅',
      });

      // 4. Send rich congratulations & next steps message
      const successMessage =
        lang === 'en'
          ? `🎉 **Congratulations! Your profile is all set!**\n\n` +
            `✅ Your preferences have been saved.\n` +
            `📬 We will automatically deliver your personalized job digest every evening at your leisure time.\n\n` +
            `💡 **Useful Commands:**\n` +
            `• /jobs - Browse matching jobs instantly\n` +
            `• /settings - View or modify your preferences anytime\n` +
            `• /help - Display the command directory`
          : `🎉 **تهانينا! تم ضبط حسابك بنجاح!**\n\n` +
            `✅ تم حفظ تفضيلاتك في النظام بنجاح.\n` +
            `📬 سنرسل لك ملخصاً يومياً بأفضل الفرص التقنية المطابقة لمجالك في ساعة الراحة المسائية.\n\n` +
            `💡 **أوامر مفيدة يمكنك استخدامها الآن:**\n` +
            `• /jobs - استكشاف الوظائف المطابقة لمجالك حالياً\n` +
            `• /settings - عرض أو تعديل تفضيلاتك في أي وقت\n` +
            `• /help - عرض دليل المساعدة وجميع الأوامر`;

      await ctx.reply(successMessage, {
        parse_mode: 'Markdown',
      });

      // 5. Send searching placeholder message (TASK-40.1 Acceptance Criteria)
      const searchingText =
        lang === 'en'
          ? 'Searching for the best opportunities matching your profile right now... 🔍'
          : 'جاري البحث عن أنسب الفرص المتاحة لك الآن... 🔍';

      const searchingMsg = await ctx.reply(searchingText, {
        parse_mode: 'Markdown',
      });

      // 6. Query active jobs, score & deliver Page 1 immediately (<1.5s)
      try {
        const digest = await digestService.generateAndDeliverFirstDigest(user.id, {
          specializations,
          regionPreference,
        });

        const digestCard = digestService.formatDigestMessage(digest, {
          language: lang,
        });

        const replyMarkup =
          !digest.hasMatches || digest.jobs.length === 0
            ? digestService.buildEmptyStateKeyboard(lang)
            : undefined;

        // Edit searching message with formatted digest cards and empty state buttons if 0 matches
        if (searchingMsg && searchingMsg.message_id && ctx.chat) {
          await ctx.api.editMessageText(ctx.chat.id, searchingMsg.message_id, digestCard, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
            reply_markup: replyMarkup,
          });
        }
      } catch (digestErr: unknown) {
        logger.error(`[ConfirmationHandler] First digest delivery error: ${(digestErr as Error).message}`);
      }
    } catch (err: unknown) {
      logger.error(`[ConfirmationHandler] Error saving preferences: ${(err as Error).message}`);
      await ctx.answerCallbackQuery({
        text:
          lang === 'en'
            ? '⚠️ An error occurred while saving your preferences. Please try again.'
            : '⚠️ حدث خطأ أثناء حفظ تفضيلاتك. يرجى المحاولة مرة أخرى.',
        show_alert: true,
      });
    }
  });

  // 2. Edit Preferences: pref_edit (Return to Step 1: Specializations)
  bot.callbackQuery('pref_edit', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'specializations',
        language: 'ar',
        selectedSpecializations: [],
        preferences: {},
      };
    }

    ctx.session.step = 'specializations';
    const lang = ctx.session.language || 'ar';
    const selectedSpecs = ctx.session.selectedSpecializations || [];
    const firstName = ctx.from?.first_name || null;

    await ctx.answerCallbackQuery();

    const welcomeMsg = getWelcomeMessage(lang, firstName);
    const keyboard = buildSpecializationKeyboard(selectedSpecs, lang);

    try {
      await ctx.editMessageText(welcomeMsg, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[ConfirmationHandler] pref_edit: ${(err as Error).message}`);
    }
  });
}

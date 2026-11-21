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
import { buildDigestPaginationKeyboard } from '../keyboards/digest-pagination.keyboard.js';
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
    ar: '🌐 السوق الدولي وفرص الـ Remote عالمياً',
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
      `📋 *Review Your DeployMe Pipeline Config*\n\n` +
      `🎯 *Tech Stack / Specializations:*\n• ${specsList}\n\n` +
      `📍 *Target Market:*\n• ${regionLabel}\n\n` +
      `⏰ *Delivery Schedule:*\n• You will receive a curated daily digest of matching tech roles every evening ⚡\n\n` +
      `Hit *Save & Deploy Pipeline* to launch your alerts!`
    );
  }

  return (
    `📋 *ملخص إعدادات الـ Pipeline تبعك*\n\n` +
    `🎯 *التخصصات والـ Stack المختار:*\n• ${specsList}\n\n` +
    `📍 *نطاق السوق المستهدف:*\n• ${regionLabel}\n\n` +
    `⏰ *نظام الإرسال:*\n• رح توصلك تجميعة يومية بأفضل الفرص التقنية المطابقة لمجالك كل مساء ⚡\n\n` +
    `اضغط على *تأكيد وتشغيل الـ Pipeline* عشان نبدأ!`
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
          ? '⚠️ Unable to save config. Please run /start to configure your stack.'
          : '⚠️ تعذر حفظ الإعدادات. يرجى البدء مجدداً عبر الأمر /start لإكمال الضبط.';
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

      // 2. Transactionally save preferences (preserving any configured experience level)
      const existingPrefs = await prefRepo.findByUserId(user.id);
      const experienceLevel =
        existingPrefs?.experienceLevel || ctx.session?.preferences?.experienceLevel || undefined;

      await prefRepo.savePreferences(user.id, {
        specializations,
        regionPreference,
        experienceLevel: experienceLevel as any,
      });

      // 3. Update session step
      if (ctx.session) {
        ctx.session.step = 'confirmation';
      }

      await ctx.answerCallbackQuery({
        text: lang === 'en' ? 'Pipeline deployed! ✅' : 'تم تشغيل الـ Pipeline بنجاح! ✅',
      });

      // 4. Send rich confirmation & next steps message
      const successMessage =
        lang === 'en'
          ? `⚡ *All set! Your DeployMe pipeline is live!*\n\n` +
            `✅ Your stack & market preferences are saved.\n` +
            `📬 We'll ping you automatically every evening with top matching roles.\n\n` +
            `💡 *Quick Commands:*\n` +
            `• /jobs - Browse matching roles right now\n` +
            `• /settings - Adjust your stack or market scope\n` +
            `• /help - View all available commands`
          : `⚡ *جاهز للـ Production! تم تشغيل الـ Pipeline بنجاح!*\n\n` +
            `✅ تم حفظ إعدادات الـ Stack ونطاق السوق في النظام.\n` +
            `📬 رح نعملك Ping يومياً كل مساء بأقوى الفرص التقنية المطابقة لمجالك.\n\n` +
            `💡 *أوامر سريعة بتفيدك:*\n` +
            `• /jobs - تصفح الفرص المطابقة لـ Stack تبعك حالياً\n` +
            `• /settings - تعديل تخصصاتك أو نطاق السوق في أي وقت\n` +
            `• /help - عرض دليل الأوامر والمساعدة`;

      await ctx.reply(successMessage, {
        parse_mode: 'Markdown',
      });

      // 5. Send searching placeholder message (TASK-40.1 Acceptance Criteria)
      const searchingText =
        lang === 'en'
          ? 'Scanning active roles matching your stack right now... 🔍'
          : 'بنفحص السوق وبنفلتر أنسب الفرص لـ Stack تبعك هلق... 🔍';

      const searchingMsg = await ctx.reply(searchingText, {
        parse_mode: 'Markdown',
      });

      // 6. Query active jobs, score & deliver Page 1 immediately (<1.5s)
      try {
        const digest = await digestService.generateAndDeliverFirstDigest(user.id, {
          specializations,
          regionPreference,
          experienceLevel,
        });

        const digestCard = digestService.formatDigestMessage(digest, {
          language: lang,
        });

        const replyMarkup =
          !digest.hasMatches || digest.jobs.length === 0
            ? digestService.buildEmptyStateKeyboard(lang)
            : buildDigestPaginationKeyboard(1, digest.totalPages, lang, digest.jobs);

        // Edit searching message with formatted digest cards and empty state buttons if 0 matches
        if (searchingMsg && searchingMsg.message_id && ctx.chat) {
          await ctx.api.editMessageText(ctx.chat.id, searchingMsg.message_id, digestCard, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
            reply_markup: replyMarkup,
          });

          // Record delivered jobs to SentJob ONLY after message dispatch succeeds
          if (digest.deliveredJobIds.length > 0) {
            await digestService.recordDeliveredJobs(user.id, digest.deliveredJobIds);
          }
        }
      } catch (digestErr: unknown) {
        logger.error(`[ConfirmationHandler] First digest delivery error: ${(digestErr as Error).message}`);

        // Fallback: update placeholder so user is not stuck on "Searching..."
        if (searchingMsg && searchingMsg.message_id && ctx.chat) {
          const fallbackText =
            lang === 'en'
              ? 'Could not load your instant digest right now, but your pipeline is active! You will receive your digest in the upcoming evening cycle (21:00).'
              : 'تعذر تحميل التجميعة الفورية حالياً، بس الـ Pipeline شغال تمام! رح توصلك تجميعتك في الجولة المسائية القادمة (21:00).';

          try {
            await ctx.api.editMessageText(ctx.chat.id, searchingMsg.message_id, fallbackText);
          } catch (fallbackErr: unknown) {
            logger.warn(`[ConfirmationHandler] Secondary fallback edit error: ${(fallbackErr as Error).message}`);
          }
        }
      }
    } catch (err: unknown) {
      logger.error(`[ConfirmationHandler] Error saving preferences: ${(err as Error).message}`);
      await ctx.answerCallbackQuery({
        text:
          lang === 'en'
            ? '⚠️ An error occurred while saving your preferences. Please try again.'
            : '⚠️ حدث خطأ أثناء حفظ إعداداتك. يرجى المحاولة مرة أخرى.',
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
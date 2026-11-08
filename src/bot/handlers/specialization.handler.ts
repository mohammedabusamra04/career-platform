import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import { Specialization, isApprovedSpecialization } from '../../modules/preferences/preference.taxonomy.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { buildRegionKeyboard } from '../keyboards/region.keyboard.js';
import { getRegionPromptMessage } from './region.handler.js';
import { getWelcomeMessage } from './start.handler.js';
import { RegionPreference } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export const SPECIALIZATION_MESSAGES = {
  maxReached: {
    ar: 'الحد الأقصى هو 3 تخصصات فقط ⚠️',
    en: 'Maximum 3 specializations allowed ⚠️',
  },
  minRequired: {
    ar: 'يرجى اختيار تخصص واحد على الأقل للمتابعة 📌',
    en: 'Please select at least 1 specialization to continue 📌',
  },
  stepConfirmed: {
    ar: 'تم اختيار التخصصات بنجاح ✅',
    en: 'Specializations selected successfully ✅',
  },
} as const;

/**
 * Registers callback query handlers for interactive multi-selection of specializations.
 * Handles toggle state, 3-specialization maximum constraint, language toggle, and navigation to the next step.
 */
export function registerSpecializationHandler(bot: Bot<BotContext>): void {
  // 1. Specialization Toggle: spec_toggle:<SPECIALIZATION>
  bot.callbackQuery(/^spec_toggle:(.+)$/, async (ctx) => {
    const rawSpec = ctx.match[1];
    if (!isApprovedSpecialization(rawSpec)) {
      await ctx.answerCallbackQuery({ text: 'Unknown specialization' });
      return;
    }

    const spec = rawSpec as Specialization;

    if (!ctx.session) {
      ctx.session = {
        step: 'specializations',
        language: 'ar',
        selectedSpecializations: [],
        preferences: {},
      };
    }

    const lang: SupportedLanguage = ctx.session.language || 'ar';
    const currentList: Specialization[] = ctx.session.selectedSpecializations || [];

    const isAlreadySelected = currentList.includes(spec);

    if (isAlreadySelected) {
      // Deselect
      ctx.session.selectedSpecializations = currentList.filter((s) => s !== spec);
      await ctx.answerCallbackQuery();
    } else {
      // Check maximum 3 selections constraint
      if (currentList.length >= 3) {
        await ctx.answerCallbackQuery({
          text: SPECIALIZATION_MESSAGES.maxReached[lang],
          show_alert: false,
        });
        return;
      }

      ctx.session.selectedSpecializations = [...currentList, spec];
      await ctx.answerCallbackQuery();
    }

    // Re-render keyboard with updated checkmarks
    const updatedKeyboard = buildSpecializationKeyboard(ctx.session.selectedSpecializations, lang);
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: updatedKeyboard,
      });
    } catch (err: unknown) {
      // Catch potential telegram message not modified errors safely
      logger.info(`[SpecializationHandler] editMessageReplyMarkup: ${(err as Error).message}`);
    }
  });

  // 2. Language Toggle: toggle_language
  bot.callbackQuery('toggle_language', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'specializations',
        language: 'ar',
        selectedSpecializations: [],
        preferences: {},
      };
    }

    const currentLang: SupportedLanguage = ctx.session.language || 'ar';
    const newLang: SupportedLanguage = currentLang === 'ar' ? 'en' : 'ar';
    ctx.session.language = newLang;

    await ctx.answerCallbackQuery();

    const selected = ctx.session.selectedSpecializations || [];
    const firstName = ctx.from?.first_name || null;
    const newText = getWelcomeMessage(newLang, firstName);
    const newKeyboard = buildSpecializationKeyboard(selected, newLang);

    try {
      await ctx.editMessageText(newText, {
        parse_mode: 'Markdown',
        reply_markup: newKeyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SpecializationHandler] toggle_language edit: ${(err as Error).message}`);
    }
  });

  // 3. Navigation / Submission: spec_submit
  bot.callbackQuery('spec_submit', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'specializations',
        language: 'ar',
        selectedSpecializations: [],
        preferences: {},
      };
    }

    const lang: SupportedLanguage = ctx.session.language || 'ar';
    const selected = ctx.session.selectedSpecializations || [];

    // Enforce minimum 1 selection
    if (selected.length === 0) {
      await ctx.answerCallbackQuery({
        text: SPECIALIZATION_MESSAGES.minRequired[lang],
        show_alert: false,
      });
      return;
    }

    // Progress to Step 2: Target Region (TASK-35)
    ctx.session.step = 'region';
    if (!ctx.session.selectedRegion) {
      ctx.session.selectedRegion = RegionPreference.BOTH;
    }

    await ctx.answerCallbackQuery({
      text: SPECIALIZATION_MESSAGES.stepConfirmed[lang],
    });

    const regionPrompt = getRegionPromptMessage(lang);
    const regionKeyboard = buildRegionKeyboard(ctx.session.selectedRegion, lang);

    await ctx.reply(regionPrompt, {
      parse_mode: 'Markdown',
      reply_markup: regionKeyboard,
    });
  });
}

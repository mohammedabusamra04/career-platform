import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import { buildExperienceKeyboard } from '../keyboards/experience.keyboard.js';
import { buildRegionKeyboard } from '../keyboards/region.keyboard.js';
import { getRegionPromptMessage } from './region.handler.js';
import { buildConfirmationKeyboard } from '../keyboards/confirmation.keyboard.js';
import { formatSummaryCard } from './confirmation.handler.js';
import { RegionPreference, type Specialization } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export function getExperienceStepPromptMessage(lang: SupportedLanguage = 'ar'): string {
  if (lang === 'en') {
    return (
      `📊 *Step 3:* Pick your experience level:\n\n` +
      `Select your seniority level to filter and receive opportunities best matched for you.\n` +
      `*(Tap your choice to mark it with a green checkmark ✅, then tap Next)*`
    );
  }

  return (
    `📊 *الخطوة 3:* حدد مستوى خبرتك المهنية:\n\n` +
    `اختار مستواك لتصفية واستلام الوظائف الأنسب لخبرتك في السوق.\n` +
    `*(اضغط على مستواك لتحديده بعلامة الصح الأخضر ✅ ثم اضغط التالي)*`
  );
}

export function registerExperienceStepHandler(bot: Bot<BotContext>): void {
  // 1. Select Experience Level: exp_step_select:<LEVEL>
  bot.callbackQuery(/^exp_step_select:(JUNIOR|MID|SENIOR|ALL)$/, async (ctx) => {
    const rawLevel = ctx.match[1];

    if (!ctx.session) {
      ctx.session = {
        step: 'experience-level',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        selectedExperience: 'ALL',
        preferences: {},
      };
    }

    ctx.session.selectedExperience = rawLevel;
    const lang = ctx.session.language || 'ar';

    await ctx.answerCallbackQuery();

    const keyboard = buildExperienceKeyboard(rawLevel, lang);
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[ExperienceStepHandler] editMessageReplyMarkup: ${(err as Error).message}`);
    }
  });

  // 2. Back Navigation: exp_step_back (Return to Step 2: Region)
  bot.callbackQuery('exp_step_back', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'region',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        preferences: {},
      };
    }

    ctx.session.step = 'region';
    const lang = ctx.session.language || 'ar';
    const selectedRegion = ctx.session.selectedRegion || RegionPreference.BOTH;

    await ctx.answerCallbackQuery();

    const regionPrompt = getRegionPromptMessage(lang);
    const keyboard = buildRegionKeyboard(selectedRegion, lang);

    try {
      await ctx.editMessageText(regionPrompt, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[ExperienceStepHandler] exp_step_back edit: ${(err as Error).message}`);
    }
  });

  // 3. Next Navigation: exp_step_submit (Advance to Confirmation)
  bot.callbackQuery('exp_step_submit', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'experience-level',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        selectedExperience: 'ALL',
        preferences: {},
      };
    }

    if (!ctx.session.selectedExperience) {
      ctx.session.selectedExperience = 'ALL';
    }

    // Restore specializations if session was reset
    if (
      (!ctx.session.selectedSpecializations || ctx.session.selectedSpecializations.length === 0) &&
      ctx.from?.id
    ) {
      try {
        const { prisma } = await import('../../shared/database/prisma.service.js');
        const user = await prisma.user.findUnique({
          where: { telegramId: BigInt(ctx.from.id) },
          include: { preference: true },
        });
        if (user?.preference?.specializations && user.preference.specializations.length > 0) {
          ctx.session.selectedSpecializations = user.preference.specializations as Specialization[];
        }
      } catch (err: unknown) {
        logger.info(`[ExperienceStepHandler] preference fallback lookup: ${(err as Error).message}`);
      }
    }

    ctx.session.step = 'confirmation';
    const lang = ctx.session.language || 'ar';
    const specs = ctx.session.selectedSpecializations || [];
    const region = ctx.session.selectedRegion || RegionPreference.BOTH;
    const exp = ctx.session.selectedExperience;

    await ctx.answerCallbackQuery();

    const summaryText = formatSummaryCard(specs, region, lang, exp);
    const confirmationKeyboard = buildConfirmationKeyboard(lang);

    if (typeof ctx.editMessageText === 'function') {
      try {
        await ctx.editMessageText(summaryText, {
          parse_mode: 'Markdown',
          reply_markup: confirmationKeyboard,
        });
        return;
      } catch (err: unknown) {
        logger.info(`[ExperienceStepHandler] exp_step_submit editMessageText fallback: ${(err as Error).message}`);
      }
    }

    await ctx.reply(summaryText, {
      parse_mode: 'Markdown',
      reply_markup: confirmationKeyboard,
    });
  });
}


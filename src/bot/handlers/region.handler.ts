import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import {
  RegionPreference,
  Specialization,
} from '../../modules/preferences/preference.taxonomy.js';
import { buildRegionKeyboard } from '../keyboards/region.keyboard.js';
import { buildExperienceKeyboard } from '../keyboards/experience.keyboard.js';
import { getExperienceStepPromptMessage } from './experienceStep.handler.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { getWelcomeMessage } from './start.handler.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export function getRegionPromptMessage(lang: SupportedLanguage): string {
  if (lang === 'en') {
    return (
      `📍 *Step 2:* Pick your target market scope:\n\n` +
      `Choose whether you want roles from the Arab/MENA region, global Remote gigs, or both.\n` +
      `*(Tap your choice to mark it with a green checkmark ✅, then tap Next)*`
    );
  }

  return (
    `📍 *الخطوة 2:* حدد نطاق السوق اللي بتستهدفه:\n\n` +
    `اختار إذا حابب توصلك فرص السوق العربي، أو فرص الـ Remote العالمية، أو الاثنين مع بعض.\n` +
    `*(اضغط على خيارك لتحديده بعلامة الصح الأخضر ✅ ثم اضغط التالي)*`
  );
}

export function registerRegionHandler(bot: Bot<BotContext>): void {
  // 1. Select Region Option: region_select:<REGION>
  bot.callbackQuery(/^region_select:(ARAB|INTERNATIONAL|BOTH)$/, async (ctx) => {
    const rawRegion = ctx.match[1] as RegionPreference;

    if (!ctx.session) {
      ctx.session = {
        step: 'region',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        preferences: {},
      };
    }

    ctx.session.selectedRegion = rawRegion;
    const lang = ctx.session.language || 'ar';

    await ctx.answerCallbackQuery();

    const keyboard = buildRegionKeyboard(rawRegion, lang);
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[RegionHandler] editMessageReplyMarkup: ${(err as Error).message}`);
    }
  });

  // 2. Back Navigation: region_back (Return to Step 1: Specializations)
  bot.callbackQuery('region_back', async (ctx) => {
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
      logger.info(`[RegionHandler] region_back edit: ${(err as Error).message}`);
    }
  });

  // 3. Next Navigation: region_submit (Advance to Step 3: Confirmation)
  bot.callbackQuery('region_submit', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'region',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        preferences: {},
      };
    }

    if (!ctx.session.selectedRegion) {
      ctx.session.selectedRegion = RegionPreference.BOTH;
    }

    // If session lost specializations (e.g. after deployment restart), restore from DB or fallback safely
    if ((!ctx.session.selectedSpecializations || ctx.session.selectedSpecializations.length === 0) && ctx.from?.id) {
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
        logger.info(`[RegionHandler] preference fallback lookup: ${(err as Error).message}`);
      }
    }

    ctx.session.step = 'experience-level';
    if (!ctx.session.selectedExperience) {
      ctx.session.selectedExperience = 'ALL';
    }

    const lang = ctx.session.language || 'ar';
    await ctx.answerCallbackQuery();

    const experiencePrompt = getExperienceStepPromptMessage(lang);
    const experienceKeyboard = buildExperienceKeyboard(ctx.session.selectedExperience, lang);

    if (typeof ctx.editMessageText === 'function') {
      try {
        await ctx.editMessageText(experiencePrompt, {
          parse_mode: 'Markdown',
          reply_markup: experienceKeyboard,
        });
        return;
      } catch (err: unknown) {
        logger.info(`[RegionHandler] region_submit editMessageText fallback: ${(err as Error).message}`);
      }
    }

    await ctx.reply(experiencePrompt, {
      parse_mode: 'Markdown',
      reply_markup: experienceKeyboard,
    });
  });
}
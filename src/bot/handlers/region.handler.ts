import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import { RegionPreference } from '../../modules/preferences/preference.taxonomy.js';
import { buildRegionKeyboard } from '../keyboards/region.keyboard.js';
import { buildConfirmationKeyboard } from '../keyboards/confirmation.keyboard.js';
import { formatSummaryCard } from './confirmation.handler.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { getWelcomeMessage } from './start.handler.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export function getRegionPromptMessage(lang: SupportedLanguage): string {
  if (lang === 'en') {
    return (
      `📍 **Step 2:** Choose your target geographic market:\n\n` +
      `Choose whether you want to receive opportunities from the Arab region, international remote roles, or both.`
    );
  }

  return (
    `📍 **الخطوة 2:** اختر نطاق السوق الجغرافي المستهدف:\n\n` +
    `حدد ما إذا كنت تفضل استقبال وظائف السوق العربي، أو الفرص العالمية عن بعد، أو كلاهما معاً.`
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

    ctx.session.step = 'confirmation';
    const lang = ctx.session.language || 'ar';
    const specs = ctx.session.selectedSpecializations || [];
    const region = ctx.session.selectedRegion;

    await ctx.answerCallbackQuery();

    const summaryText = formatSummaryCard(specs, region, lang);
    const confirmationKeyboard = buildConfirmationKeyboard(lang);

    await ctx.reply(summaryText, {
      parse_mode: 'Markdown',
      reply_markup: confirmationKeyboard,
    });
  });
}

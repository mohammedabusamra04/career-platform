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
import { buildSettingsKeyboard } from '../keyboards/settings.keyboard.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { buildRegionKeyboard } from '../keyboards/region.keyboard.js';
import { getRegionPromptMessage } from './region.handler.js';
import { getWelcomeMessage } from './start.handler.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface SettingsHandlerDependencies {
  userRepository?: IUserRepository;
  preferenceRepository?: IUserPreferenceRepository;
}

const defaultUserRepository = new PrismaUserRepository();
const defaultPreferenceRepository = new PrismaUserPreferenceRepository();

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

export function formatSettingsDashboard(
  specializations: Specialization[],
  region: RegionPreference,
  status: string,
  lang: SupportedLanguage = 'ar',
): string {
  const specsList = specializations.length > 0 ? specializations.join(', ') : 'None';
  const regionLabel = REGION_LABELS[region]
    ? REGION_LABELS[region][lang]
    : REGION_LABELS[RegionPreference.BOTH][lang];

  const statusLabel =
    status === 'PAUSED'
      ? lang === 'en'
        ? '⏸️ Paused'
        : '⏸️ متوقف مؤقتاً'
      : lang === 'en'
        ? '✅ Active'
        : '✅ نشط ومفعل';

  if (lang === 'en') {
    return (
      `⚙️ **Your Career Alert Settings**\n\n` +
      `👤 **Account Status:** ${statusLabel}\n` +
      `🎯 **Active Specializations:**\n• ${specsList}\n\n` +
      `📍 **Target Region:**\n• ${regionLabel}\n\n` +
      `💡 Choose what you would like to customize below:`
    );
  }

  return (
    `⚙️ **إعدادات تنبيهات الوظائف الخاصة بك**\n\n` +
    `👤 **حالة الحساب:** ${statusLabel}\n` +
    `🎯 **التخصصات المفعلة:**\n• ${specsList}\n\n` +
    `📍 **نطاق السوق المستهدف:**\n• ${regionLabel}\n\n` +
    `💡 اختر ما ترغب في تعديله من الخيارات أدناه:`
  );
}

export function registerSettingsHandler(
  bot: Bot<BotContext>,
  deps: SettingsHandlerDependencies = {},
): void {
  const userRepo = deps.userRepository ?? defaultUserRepository;
  const prefRepo = deps.preferenceRepository ?? defaultPreferenceRepository;

  const handleSettings = async (ctx: BotContext) => {
    const telegramId = ctx.from?.id;
    const lang: SupportedLanguage = ctx.session?.language || 'ar';

    if (!telegramId) {
      return;
    }

    try {
      const user = await userRepo.findByTelegramId(telegramId);
      if (!user) {
        const notFoundMsg =
          lang === 'en'
            ? '⚠️ Profile not found. Please type /start to set up your preferences.'
            : '⚠️ لم يتم العثور على حسابك. يرجى إرسال /start لضبط تفضيلاتك لأول مرة.';
        await ctx.reply(notFoundMsg);
        return;
      }

      const prefs = await prefRepo.findByUserId(user.id);
      const specs = prefs?.specializations || ctx.session?.selectedSpecializations || [];
      const region = prefs?.regionPreference || ctx.session?.selectedRegion || RegionPreference.BOTH;

      // Update session state
      if (!ctx.session) {
        ctx.session = {
          step: 'confirmation',
          language: lang,
          selectedSpecializations: specs,
          selectedRegion: region,
          preferences: {},
        };
      } else {
        ctx.session.selectedSpecializations = specs;
        ctx.session.selectedRegion = region;
      }

      const message = formatSettingsDashboard(specs, region, user.status, lang);
      const keyboard = buildSettingsKeyboard(lang);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.error(`[SettingsHandler] Error displaying settings: ${(err as Error).message}`);
    }
  };

  // Register command
  bot.command('settings', handleSettings);

  // 1. Edit Specializations callback
  bot.callbackQuery('settings_edit_specs', async (ctx) => {
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
    const selected = ctx.session.selectedSpecializations || [];
    const firstName = ctx.from?.first_name || null;

    await ctx.answerCallbackQuery();

    const welcomeMsg = getWelcomeMessage(lang, firstName);
    const keyboard = buildSpecializationKeyboard(selected, lang);

    try {
      await ctx.editMessageText(welcomeMsg, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SettingsHandler] settings_edit_specs edit: ${(err as Error).message}`);
    }
  });

  // 2. Edit Region callback
  bot.callbackQuery('settings_edit_region', async (ctx) => {
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
      logger.info(`[SettingsHandler] settings_edit_region edit: ${(err as Error).message}`);
    }
  });

  // 3. Switch Language callback in Settings
  bot.callbackQuery('settings_toggle_lang', async (ctx) => {
    if (!ctx.session) {
      ctx.session = {
        step: 'confirmation',
        language: 'ar',
        selectedSpecializations: [],
        selectedRegion: RegionPreference.BOTH,
        preferences: {},
      };
    }

    const currentLang: SupportedLanguage = ctx.session.language || 'ar';
    const newLang: SupportedLanguage = currentLang === 'ar' ? 'en' : 'ar';
    ctx.session.language = newLang;

    await ctx.answerCallbackQuery();

    const telegramId = ctx.from?.id;
    let status = 'ACTIVE';

    if (telegramId) {
      try {
        const user = await userRepo.findByTelegramId(telegramId);
        if (user) {
          status = user.status;
        }
      } catch (err: unknown) {
        logger.info(`[SettingsHandler] user lookup: ${(err as Error).message}`);
      }
    }

    const specs = ctx.session.selectedSpecializations || [];
    const region = ctx.session.selectedRegion || RegionPreference.BOTH;

    const message = formatSettingsDashboard(specs, region, status, newLang);
    const keyboard = buildSettingsKeyboard(newLang);

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SettingsHandler] settings_toggle_lang edit: ${(err as Error).message}`);
    }
  });
}

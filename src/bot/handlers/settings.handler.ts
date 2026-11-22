import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../modules/preferences/repositories/user-preference.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import { PrismaUserPreferenceRepository } from '../../modules/preferences/repositories/prisma-user-preference.repository.js';
import {
  RegionPreference,
  Specialization,
} from '../../modules/preferences/preference.taxonomy.js';
import type { ExperienceLevel } from '../../shared/types/job.js';
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
    ar: '🌐 السوق الدولي وفرص الـ Remote عالمياً',
    en: '🌐 International & Global Remote Only',
  },
};

export function formatExperienceDisplay(
  level?: string | null,
  lang: SupportedLanguage = 'ar',
): string {
  const norm = level?.toUpperCase() || 'ALL';
  if (lang === 'en') {
    switch (norm) {
      case 'JUNIOR':
        return 'Junior / Entry-Level';
      case 'MID':
        return 'Mid-Level';
      case 'SENIOR':
        return 'Senior / Lead';
      default:
        return 'Open to All Levels';
    }
  }
  switch (norm) {
    case 'JUNIOR':
      return 'مستوى مبتدئ (Junior)';
    case 'MID':
      return 'مستوى متوسط (Mid-Level)';
    case 'SENIOR':
      return 'مستوى متقدم (Senior)';
    default:
      return 'مفتوح لكل المستويات';
  }
}

export function buildExperienceSettingsKeyboard(
  currentLevel?: string | null,
  lang: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isAr = lang === 'ar';
  const norm = currentLevel?.toUpperCase() || 'ALL';

  const options = [
    { id: 'JUNIOR', labelAr: 'Junior (مبتدئ)', labelEn: 'Junior / Entry-Level' },
    { id: 'MID', labelAr: 'Mid-Level (متوسط)', labelEn: 'Mid-Level' },
    { id: 'SENIOR', labelAr: 'Senior (متقدم / خبير)', labelEn: 'Senior / Lead' },
    { id: 'ALL', labelAr: 'الكل (مفتوح للجميع)', labelEn: 'Open to All Levels' },
  ];

  for (const opt of options) {
    const isSelected = norm === opt.id;
    const text = `${isSelected ? '✅ ' : ''}${isAr ? opt.labelAr : opt.labelEn}`;
    keyboard.text(text, `settings_exp:${opt.id}`).row();
  }

  const backLabel = isAr ? '⬅️ رجوع للإعدادات' : '⬅️ Back to Settings';
  keyboard.text(backLabel, 'settings_back');

  return keyboard;
}

export function formatSettingsDashboard(
  specializations: Specialization[],
  region: RegionPreference,
  status: string,
  lang: SupportedLanguage = 'ar',
  experienceLevel?: string | null,
): string {
  const specsList = specializations.length > 0 ? specializations.join(', ') : 'None';
  const regionLabel = REGION_LABELS[region]
    ? REGION_LABELS[region][lang]
    : REGION_LABELS[RegionPreference.BOTH][lang];
  const expLabel = formatExperienceDisplay(experienceLevel, lang);

  const statusLabel =
    status === 'PAUSED'
      ? lang === 'en'
        ? '⏸️ Paused'
        : '⏸️ متوقف مؤقتاً'
      : lang === 'en'
        ? '✅ Live'
        : '✅ شغال (Live)';

  if (lang === 'en') {
    return (
      `⚙️ *DeployMe Pipeline Settings*\n\n` +
      `📡 *Pipeline Status:* ${statusLabel}\n` +
      `🎯 *Active Stack:*\n• ${specsList}\n\n` +
      `📊 *Experience Level:*\n• ${expLabel}\n\n` +
      `📍 *Market Scope:*\n• ${regionLabel}\n\n` +
      `💡 Pick what you'd like to update below:`
    );
  }

  return (
    `⚙️ *إعدادات الـ Pipeline في DeployMe*\n\n` +
    `📡 *حالة الرادار:* ${statusLabel}\n` +
    `🎯 *الـ Stack المفعّل:*\n• ${specsList}\n\n` +
    `📊 *مستوى الخبرة:*\n• ${expLabel}\n\n` +
    `📍 *نطاق السوق:*\n• ${regionLabel}\n\n` +
    `💡 اختار شو حابب تعدّل من الأزرار تحت:`
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
            ? "⚠️ Stack config not found. Send /start to set up your DeployMe pipeline."
            : '⚠️ لسا ما عملت إعداد لحسابك على DeployMe! ابعت /start عشان تضبط الـ Stack تبعك.';
        await ctx.reply(notFoundMsg);
        return;
      }

      const prefs = await prefRepo.findByUserId(user.id);
      const specs = prefs?.specializations || ctx.session?.selectedSpecializations || [];
      const region = prefs?.regionPreference || ctx.session?.selectedRegion || RegionPreference.BOTH;
      const expLevel = prefs?.experienceLevel || null;

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

      const message = formatSettingsDashboard(specs, region, user.status, lang, expLevel);
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
    const expLevel = ctx.session.preferences?.experienceLevel || null;

    const message = formatSettingsDashboard(specs, region, status, newLang, expLevel);
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

  // 4. Edit Experience Level callback
  bot.callbackQuery('settings_edit_experience', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const isAr = lang === 'ar';
    await ctx.answerCallbackQuery();

    const telegramId = ctx.from?.id;
    let currentExp: string | null = null;
    if (telegramId) {
      try {
        const user = await userRepo.findByTelegramId(telegramId);
        if (user) {
          const prefs = await prefRepo.findByUserId(user.id);
          currentExp = prefs?.experienceLevel ?? null;
        }
      } catch (err: unknown) {
        logger.info(`[SettingsHandler] user lookup for exp: ${(err as Error).message}`);
      }
    }

    const prompt = isAr
      ? '📊 *تحديد مستوى الخبرة*\n\nاختار مستواك المهني لتصفية واستلام الوظائف الأنسب لخبرتك:\n*(اضغط على مستواك ليتم اختياره بالصح الأخضر ✅)*'
      : '📊 *Set Experience Level*\n\nPick your seniority level to match relevant opportunities:\n*(Tap your level to select it with a green checkmark ✅)*';

    const keyboard = buildExperienceSettingsKeyboard(currentExp, lang);

    try {
      await ctx.editMessageText(prompt, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SettingsHandler] settings_edit_experience edit: ${(err as Error).message}`);
    }
  });

  // 5. Save Experience Level callback
  bot.callbackQuery(/^settings_exp:(JUNIOR|MID|SENIOR|ALL)$/, async (ctx) => {
    const rawLevel = ctx.match?.[1];
    const newLevel = rawLevel === 'ALL' ? null : rawLevel;
    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    const isAr = lang === 'ar';

    const telegramId = ctx.from?.id;
    let userRecord = null;
    let prefs = null;

    if (telegramId) {
      try {
        userRecord = await userRepo.findByTelegramId(telegramId);
        if (userRecord) {
          prefs = await prefRepo.findByUserId(userRecord.id);
          await prefRepo.savePreferences(userRecord.id, {
            specializations: prefs?.specializations || [Specialization.BACKEND],
            regionPreference: prefs?.regionPreference || RegionPreference.BOTH,
            experienceLevel: newLevel as never,
            workType: prefs?.workType as never,
          });
        }
      } catch (err: unknown) {
        logger.error(`[SettingsHandler] Failed saving experience level: ${(err as Error).message}`);
      }
    }

    if (ctx.session?.preferences) {
      ctx.session.preferences.experienceLevel = (newLevel as ExperienceLevel) ?? undefined;
    }

    await ctx.answerCallbackQuery({
      text: isAr ? '✅ تم تحديث مستوى الخبرة بنجاح!' : '✅ Experience level updated!',
    });

    const specs = prefs?.specializations || ctx.session?.selectedSpecializations || [];
    const region = prefs?.regionPreference || ctx.session?.selectedRegion || RegionPreference.BOTH;
    const status = userRecord?.status || 'ACTIVE';

    const message = formatSettingsDashboard(specs, region, status, lang, newLevel);
    const keyboard = buildSettingsKeyboard(lang);

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SettingsHandler] return to dashboard: ${(err as Error).message}`);
    }
  });

  // 6. Back to Settings Dashboard callback
  bot.callbackQuery('settings_back', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'ar';
    await ctx.answerCallbackQuery();

    const telegramId = ctx.from?.id;
    let userRecord = null;
    let prefs = null;

    if (telegramId) {
      try {
        userRecord = await userRepo.findByTelegramId(telegramId);
        if (userRecord) {
          prefs = await prefRepo.findByUserId(userRecord.id);
        }
      } catch (err: unknown) {
        logger.info(`[SettingsHandler] user lookup for back: ${(err as Error).message}`);
      }
    }

    const specs = prefs?.specializations || ctx.session?.selectedSpecializations || [];
    const region = prefs?.regionPreference || ctx.session?.selectedRegion || RegionPreference.BOTH;
    const status = userRecord?.status || 'ACTIVE';
    const expLevel = prefs?.experienceLevel ?? null;

    const message = formatSettingsDashboard(specs, region, status, lang, expLevel);
    const keyboard = buildSettingsKeyboard(lang);

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err: unknown) {
      logger.info(`[SettingsHandler] settings_back edit: ${(err as Error).message}`);
    }
  });
}
import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { IUserRepository } from '../../modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../modules/preferences/repositories/user-preference.repository.interface.js';
import { PrismaUserRepository } from '../../modules/users/repositories/prisma-user.repository.js';
import { PrismaUserPreferenceRepository } from '../../modules/preferences/repositories/prisma-user-preference.repository.js';
import { UserStatus } from '../../modules/users/user.types.js';
import { buildSpecializationKeyboard } from '../keyboards/specialization.keyboard.js';
import { Specialization } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';
import logger from '../../shared/utils/logger.js';

export interface StartHandlerDependencies {
  userRepository?: IUserRepository;
  preferenceRepository?: IUserPreferenceRepository;
}

const defaultUserRepository = new PrismaUserRepository();
const defaultPreferenceRepository = new PrismaUserPreferenceRepository();

export function getWelcomeMessage(lang: SupportedLanguage, firstName?: string | null): string {
  const nameDisplay = firstName ? ` ${firstName}` : '';

  if (lang === 'en') {
    return (
      `👋 Welcome to **SmartJobsBot**${nameDisplay}!\n\n` +
      `🎯 We deliver personalized tech jobs curated for your exact domain with zero noise.\n\n` +
      `**Step 1:** Select between **1 and 3 specializations** that match your career goals:`
    );
  }

  return (
    `👋 مرحباً بك في **SmartJobsBot**${nameDisplay}!\n\n` +
    `🎯 نساعدك في العثور على أفضل الفرص التقنية اليومية المخصصة لمجالك بدون أي إعلانات أو إزعاج.\n\n` +
    `**الخطوة 1:** اختر من **1 إلى 3 تخصصات** تناسب مسارك المهني:`
  );
}

export function registerStartHandler(
  bot: Bot<BotContext>,
  deps: StartHandlerDependencies = {},
): void {
  const userRepo = deps.userRepository ?? defaultUserRepository;
  const prefRepo = deps.preferenceRepository ?? defaultPreferenceRepository;

  const handleStart = async (ctx: BotContext) => {
    const telegramId = ctx.from?.id;
    const firstName = ctx.from?.first_name || null;
    const username = ctx.from?.username || null;

    let language: SupportedLanguage = ctx.session?.language || 'ar';
    let selectedSpecializations: Specialization[] = [];

    if (telegramId) {
      try {
        // Query database: load existing user or create active new user
        const existingUser = await userRepo.findByTelegramId(telegramId);
        if (!existingUser) {
          await userRepo.create({
            telegramId,
            firstName,
            username,
            status: UserStatus.ACTIVE,
          });
          logger.info(`[StartHandler] Created new user with telegramId: ${telegramId}`);
        } else {
          // User exists: load existing preferences if available
          const existingPrefs = await prefRepo.findByUserId(existingUser.id);
          if (existingPrefs?.specializations?.length) {
            selectedSpecializations = [...existingPrefs.specializations];
          }
        }
      } catch (err: unknown) {
        logger.error(`[StartHandler] Database error handling /start: ${(err as Error).message}`);
      }
    }

    // Reset preference session state (idempotency guarantee)
    ctx.session = {
      step: 'specializations',
      language,
      selectedSpecializations,
      preferences: {},
    };

    const message = getWelcomeMessage(language, firstName);
    const keyboard = buildSpecializationKeyboard(selectedSpecializations, language);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  };

  bot.command('start', handleStart);

  if (typeof bot.hears === 'function') {
    bot.hears(['🚀 Start Job Search', 'Start Job Search', 'Start', '/start'], handleStart);
  }

  if (typeof bot.callbackQuery === 'function') {
    bot.callbackQuery('start_search', async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleStart(ctx);
    });
  }
}

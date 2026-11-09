import { Bot, session } from 'grammy';

import env from '../config/env.js';
import logger from '../shared/utils/logger.js';

import type { BotContext } from './context.js';
import type { PreferenceSession } from './session.js';

import { registerPreferencesHandler } from './handlers/preferences.handler.js';
import { registerStartHandler } from './handlers/start.handler.js';
import { registerSpecializationHandler } from './handlers/specialization.handler.js';
import { registerRegionHandler } from './handlers/region.handler.js';
import { registerConfirmationHandler } from './handlers/confirmation.handler.js';
import { registerSettingsHandler } from './handlers/settings.handler.js';
import { registerPauseResumeHandler } from './handlers/pause-resume.handler.js';
import { deduplicateMiddleware } from './middleware/deduplicate.middleware.js';
import { registerSubscriptionHandler } from './handlers/subscription.handler.js';

if (!env.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

export const bot = new Bot<BotContext>(env.telegramBotToken);

bot.use(deduplicateMiddleware);

bot.use(
  session({
    initial(): PreferenceSession {
      return {
        step: 'specializations',
        language: 'ar',
        selectedSpecializations: [],
        preferences: {},
      };
    },
  }),
);

registerStartHandler(bot);
registerSpecializationHandler(bot);
registerRegionHandler(bot);
registerConfirmationHandler(bot);
registerSettingsHandler(bot);
registerPauseResumeHandler(bot);
registerPreferencesHandler(bot);
registerSubscriptionHandler(bot);

bot.catch((error) => {
  logger.error(`Telegram bot error: ${error.message}`);
});

import { Bot, session } from 'grammy';

import env from '../config/env.js';
import logger from '../shared/utils/logger.js';

import type { BotContext } from './context.js';
import type { PreferenceSession } from './session.js';

import { registerPreferencesHandler } from './handlers/preferences.handler.js';
import { registerDigestPaginationHandler } from './handlers/digestPagination.handler.js';
import { registerDigestFeedbackHandler } from './handlers/digestFeedback.handler.js';
import { registerJobsHandler } from './handlers/jobs.handler.js';
import { registerStartHandler } from './handlers/start.handler.js';
import { registerSpecializationHandler } from './handlers/specialization.handler.js';
import { registerRegionHandler } from './handlers/region.handler.js';
import { registerExperienceStepHandler } from './handlers/experienceStep.handler.js';
import { registerConfirmationHandler } from './handlers/confirmation.handler.js';
import { registerSettingsHandler } from './handlers/settings.handler.js';
import { registerPauseResumeHandler } from './handlers/pauseResume.handler.js';
import { registerStopHandler } from './handlers/stop.handler.js';
import { registerHelpHandler } from './handlers/help.handler.js';
import { deduplicateMiddleware } from './middleware/deduplicate.middleware.js';
import { callbackValidationMiddleware } from './middleware/callbackValidation.middleware.js';

const botToken =
  env.telegramBotToken ||
  (process.env.NODE_ENV === 'test' || process.env.VITEST ? '123456:mock_test_token' : '');

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

export const bot = new Bot<BotContext>(botToken);

bot.use(deduplicateMiddleware);
bot.use(callbackValidationMiddleware);

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
registerExperienceStepHandler(bot);
registerConfirmationHandler(bot);
registerDigestPaginationHandler(bot);
registerDigestFeedbackHandler(bot);
registerJobsHandler(bot);
registerSettingsHandler(bot);
registerPauseResumeHandler(bot);
registerStopHandler(bot);
registerHelpHandler(bot);
registerPreferencesHandler(bot);

bot.catch((error) => {
  logger.error(`Telegram bot error: ${error.message}`);
});

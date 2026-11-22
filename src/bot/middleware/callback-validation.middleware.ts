import type { NextFunction } from 'grammy';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import logger from '../../shared/utils/logger.js';

/**
 * Whitelist of known exact string callback identifiers.
 */
export const EXACT_CALLBACK_WHITELIST = new Set([
  'pref_confirm',
  'pref_edit',
  'digest:noop',
  'jobs:noop',
  'pause_1d',
  'pause_7d',
  'pause_indefinite',
  'pause_cancel',
  'preferences:confirm',
  'preferences:restart',
  'preferences:update',
  'region_back',
  'region_submit',
  'settings_edit_specs',
  'settings_edit_region',
  'settings_edit_experience',
  'settings_back',
  'settings_toggle_lang',
  'toggle_language',
  'spec_submit',
  'start_search',
  'stop_confirm',
  'stop_cancel',
]);

/**
 * Whitelist of known parameterized regex callback patterns.
 */
export const PARAMETERIZED_CALLBACK_PATTERNS = [
  /^feedback:rate:([1-5])$/,
  /^feedback:(like|dislike):([a-zA-Z0-9_-]+)$/,
  /^digest:page:([1-9][0-9]*)$/,
  /^jobs:page:(?:(BEST_MATCH|LATEST):)?([1-9][0-9]*)$/,
  /^jobs:sort:(BEST_MATCH|LATEST)$/,
  /^work-type:([a-zA-Z0-9_-]+)$/,
  /^experience:([a-zA-Z0-9_-]+)$/,
  /^region_select:(ARAB|INTERNATIONAL|BOTH)$/,
  /^spec_toggle:([a-zA-Z0-9_-]+)$/,
  /^settings_exp:(JUNIOR|MID|SENIOR|ALL)$/,
];

/**
 * Validates whether a raw callback data string matches authorized application schemas.
 */
export function isValidCallbackData(data: string): boolean {
  if (EXACT_CALLBACK_WHITELIST.has(data)) {
    return true;
  }
  return PARAMETERIZED_CALLBACK_PATTERNS.some((pattern) => pattern.test(data));
}

/**
 * Zod schema enforcing Telegram callback boundary constraints (1-64 bytes, authorized format).
 */
export const telegramCallbackSchema = z
  .string({
    required_error: 'Callback data is required',
    invalid_type_error: 'Callback data must be a string',
  })
  .min(1, 'Callback data cannot be empty')
  .max(64, 'Callback data exceeds 64 bytes limit')
  .refine(isValidCallbackData, {
    message: 'Unauthorized or malformed callback data payload',
  });

/**
 * GrammY middleware to validate incoming Telegram callback queries at the network boundary.
 * Rejects malformed, injected, or unmapped callback payloads without throwing uncaught exceptions.
 */
export async function callbackValidationMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const callbackQuery = ctx.callbackQuery;

  // Non-callback updates pass through untouched
  if (!callbackQuery || callbackQuery.data === undefined) {
    return next();
  }

  const rawData = callbackQuery.data;
  const validationResult = telegramCallbackSchema.safeParse(rawData);

  if (!validationResult.success) {
    const errorMsg = validationResult.error.issues.map((i) => i.message).join('; ');
    const fromId = ctx.from?.id;

    logger.warn(
      `[CallbackValidation] Rejected invalid callback from user ${fromId}: "${rawData}". Reason: ${errorMsg}`,
    );

    const lang = ctx.session?.language || 'ar';
    const toastMessage =
      lang === 'en'
        ? '⚠️ Action is invalid or has expired.'
        : '⚠️ هذا الإجراء غير صالح أو منتهي الصلاحية.';

    try {
      await ctx.answerCallbackQuery({
        text: toastMessage,
      });
    } catch (err: unknown) {
      logger.warn(`[CallbackValidation] Failed answering invalid callback query: ${(err as Error).message}`);
    }

    // Halt processing: do not invoke next handler for invalid payloads
    return;
  }

  return next();
}


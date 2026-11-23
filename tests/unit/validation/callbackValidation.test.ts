import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction } from 'grammy';
import type { BotContext } from '../../../src/bot/context.js';
import {
  callbackValidationMiddleware,
  isValidCallbackData,
  telegramCallbackSchema,
  EXACT_CALLBACK_WHITELIST,
  PARAMETERIZED_CALLBACK_PATTERNS,
} from '../../../src/bot/middleware/callbackValidation.middleware.js';

describe('TASK-45.1: Telegram Callback Query Zod Boundary Validation', () => {
  describe('isValidCallbackData & telegramCallbackSchema', () => {
    it('should authorize all exact whitelist callbacks', () => {
      expect(EXACT_CALLBACK_WHITELIST.size).toBeGreaterThan(15);

      for (const callback of EXACT_CALLBACK_WHITELIST) {
        expect(isValidCallbackData(callback)).toBe(true);
        expect(telegramCallbackSchema.safeParse(callback).success).toBe(true);
      }
    });

    it('should authorize valid parameterized callback patterns', () => {
      const validParameterized = [
        'feedback:like:job-uuid-123',
        'feedback:dislike:job-999',
        'digest:page:1',
        'digest:page:4',
        'jobs:page:1',
        'jobs:page:5',
        'jobs:page:BEST_MATCH:2',
        'jobs:page:LATEST:3',
        'jobs:sort:BEST_MATCH',
        'jobs:sort:LATEST',
        'work-type:REMOTE',
        'experience:SENIOR',
        'region_select:ARAB',
        'region_select:INTERNATIONAL',
        'region_select:BOTH',
        'spec_toggle:backend',
        'spec_toggle:ai-machine-learning',
        'settings_exp:JUNIOR',
        'settings_exp:MID',
        'settings_exp:SENIOR',
        'settings_exp:ALL',
      ];

      for (const cb of validParameterized) {
        expect(isValidCallbackData(cb)).toBe(true);
        expect(telegramCallbackSchema.safeParse(cb).success).toBe(true);
      }
    });

    it('should reject unauthorized, unknown, or malformed callbacks', () => {
      const invalidCallbacks = [
        'malicious_action',
        '__proto__',
        'constructor',
        'DROP TABLE users;',
        'feedback:unknown_action:123',
        'digest:page:0', // page 0 is invalid, pattern requires [1-9]
        'digest:page:-1',
        'jobs:sort:UNKNOWN',
        'region_select:LOCAL_ONLY',
        '', // empty
      ];

      for (const cb of invalidCallbacks) {
        expect(isValidCallbackData(cb)).toBe(false);
        expect(telegramCallbackSchema.safeParse(cb).success).toBe(false);
      }
    });

    it('should reject callback payloads exceeding 64 bytes limit', () => {
      const longPayload = 'spec_toggle:' + 'a'.repeat(60); // 72 chars > 64 bytes
      const result = telegramCallbackSchema.safeParse(longPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('64 bytes limit');
      }
    });
  });

  describe('callbackValidationMiddleware', () => {
    let mockCtx: {
      callbackQuery?: { data?: string };
      from?: { id: number };
      session?: { language?: 'ar' | 'en' };
      answerCallbackQuery: ReturnType<typeof vi.fn>;
    };
    let mockNext: NextFunction;

    beforeEach(() => {
      mockCtx = {
        callbackQuery: { data: 'jobs:sort:LATEST' },
        from: { id: 123456789 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      };
      mockNext = vi.fn().mockResolvedValue(undefined);
    });

    it('should pass valid callback query data to next handler', async () => {
      await callbackValidationMiddleware(mockCtx as unknown as BotContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCtx.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it('should pass non-callback updates directly to next handler', async () => {
      mockCtx.callbackQuery = undefined;

      await callbackValidationMiddleware(mockCtx as unknown as BotContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCtx.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it('should intercept invalid callback data, answer with toast, and halt processing', async () => {
      mockCtx.callbackQuery = { data: 'unauthorized_hacker_action' };

      await callbackValidationMiddleware(mockCtx as unknown as BotContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('هذا الإجراء غير صالح أو منتهي الصلاحية'),
        }),
      );
    });

    it('should answer in English when user session language is English', async () => {
      mockCtx.callbackQuery = { data: 'invalid_action' };
      mockCtx.session = { language: 'en' };

      await callbackValidationMiddleware(mockCtx as unknown as BotContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '⚠️ Action is invalid or has expired.',
        }),
      );
    });

    it('should safely handle and log error if answerCallbackQuery fails without crashing or leaving empty catch', async () => {
      mockCtx.callbackQuery = { data: 'bad_data' };
      mockCtx.answerCallbackQuery.mockRejectedValue(new Error('Network timeout'));

      await expect(
        callbackValidationMiddleware(mockCtx as unknown as BotContext, mockNext),
      ).resolves.not.toThrow();

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});


import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import {
  registerSpecializationHandler,
  SPECIALIZATION_MESSAGES,
} from '../../src/bot/handlers/specialization.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import { Specialization } from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-34.2: Inline Button Multi-Selection with Toggle State (#102)', () => {
  type CallbackHandler = (ctx: BotContext) => Promise<void>;
  const callbackQueryHandlers: Array<{ pattern: RegExp | string; handler: CallbackHandler }> = [];

  let mockBot: {
    callbackQuery: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    callbackQueryHandlers.length = 0;
    mockBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: CallbackHandler) => {
        callbackQueryHandlers.push({ pattern, handler });
      }),
    };

    registerSpecializationHandler(mockBot as unknown as Bot<BotContext>);
  });

  const getHandlerFor = (data: string) => {
    for (const entry of callbackQueryHandlers) {
      if (typeof entry.pattern === 'string' && entry.pattern === data) {
        return { handler: entry.handler, match: null };
      }
      if (entry.pattern instanceof RegExp) {
        const match = data.match(entry.pattern);
        if (match) {
          return { handler: entry.handler, match };
        }
      }
    }
    return null;
  };

  describe('Specialization Toggle Logic', () => {
    it('selects an unselected specialization and updates reply markup', async () => {
      const route = getHandlerFor('spec_toggle:BACKEND');
      expect(route).not.toBeNull();

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.selectedSpecializations).toEqual([Specialization.BACKEND]);
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith();
      expect(mockCtx.editMessageReplyMarkup).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_markup: expect.anything(),
        }),
      );
    });

    it('unselects an already selected specialization on second click (toggle off)', async () => {
      const route = getHandlerFor('spec_toggle:FRONTEND');

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [Specialization.FRONTEND, Specialization.DEVOPS],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.selectedSpecializations).toEqual([Specialization.DEVOPS]);
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith();
    });

    it('enforces maximum 3 selections constraint and rejects a 4th with Arabic alert toast', async () => {
      const route = getHandlerFor('spec_toggle:AI_ENGINEER');

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [
            Specialization.BACKEND,
            Specialization.FRONTEND,
            Specialization.DEVOPS,
          ],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      // State unchanged
      expect(mockCtx.session.selectedSpecializations).toHaveLength(3);
      expect(mockCtx.session.selectedSpecializations).not.toContain(Specialization.AI_ENGINEER);

      // Telegram alert toast displayed
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: SPECIALIZATION_MESSAGES.maxReached.ar,
        show_alert: false,
      });
      expect(mockCtx.editMessageReplyMarkup).not.toHaveBeenCalled();
    });

    it('displays English alert toast when maximum 3 constraint reached and user language is en', async () => {
      const route = getHandlerFor('spec_toggle:DATA');

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'specializations',
          language: 'en',
          selectedSpecializations: [
            Specialization.BACKEND,
            Specialization.FRONTEND,
            Specialization.DEVOPS,
          ],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: SPECIALIZATION_MESSAGES.maxReached.en,
        show_alert: false,
      });
    });
  });

  describe('Language Switcher Logic', () => {
    it('toggles language from Arabic to English and updates message text and keyboard', async () => {
      const route = getHandlerFor('toggle_language');
      expect(route).not.toBeNull();

      const mockCtx = {
        from: { first_name: 'Khaled' },
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [Specialization.MOBILE],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.language).toBe('en');
      // Preserves existing selections
      expect(mockCtx.session.selectedSpecializations).toEqual([Specialization.MOBILE]);
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to **SmartJobsBot** Khaled!'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('toggles language from English back to Arabic', async () => {
      const route = getHandlerFor('toggle_language');

      const mockCtx = {
        from: { first_name: 'سارة' },
        session: {
          step: 'specializations',
          language: 'en',
          selectedSpecializations: [],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.language).toBe('ar');
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('مرحباً بك في **SmartJobsBot** سارة!'),
        expect.anything(),
      );
    });
  });

  describe('Navigation & Submission Logic (spec_submit)', () => {
    it('prevents submission when 0 specializations are selected and shows toast', async () => {
      const route = getHandlerFor('spec_submit');
      expect(route).not.toBeNull();

      const mockCtx = {
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('specializations');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: SPECIALIZATION_MESSAGES.minRequired.ar,
        show_alert: false,
      });
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('advances to step "region" when 1 to 3 specializations are selected', async () => {
      const route = getHandlerFor('spec_submit');

      const mockCtx = {
        session: {
          step: 'specializations',
          language: 'ar',
          selectedSpecializations: [Specialization.FULLSTACK],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('region');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: SPECIALIZATION_MESSAGES.stepConfirmed.ar,
      });
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('الخطوة 2:'),
        expect.anything(),
      );
    });
  });
});

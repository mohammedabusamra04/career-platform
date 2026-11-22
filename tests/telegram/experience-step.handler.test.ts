import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import type { BotContext } from '../../src/bot/context.js';
import {
  registerExperienceStepHandler,
  getExperienceStepPromptMessage,
} from '../../src/bot/handlers/experience-step.handler.js';
import { buildExperienceKeyboard } from '../../src/bot/keyboards/experience.keyboard.js';
import { RegionPreference, Specialization } from '../../src/modules/preferences/preference.taxonomy.js';

describe('ExperienceStepHandler (Step 3: Experience Level)', () => {
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

    registerExperienceStepHandler(mockBot as unknown as Bot<BotContext>);
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

  describe('Prompt Messages', () => {
    it('returns prompt in Arabic with green checkmark note', () => {
      const msg = getExperienceStepPromptMessage('ar');
      expect(msg).toContain('الخطوة 3:');
      expect(msg).toContain('مستوى خبرتك');
      expect(msg).toContain('✅');
    });

    it('returns prompt in English with checkmark note', () => {
      const msg = getExperienceStepPromptMessage('en');
      expect(msg).toContain('Step 3:');
      expect(msg).toContain('experience level');
      expect(msg).toContain('✅');
    });
  });

  describe('buildExperienceKeyboard', () => {
    it('marks selected level with checkmark', () => {
      const keyboard = buildExperienceKeyboard('MID', 'ar');
      const flat = keyboard.inline_keyboard.flat();
      const midBtn = flat.find((b) => b.callback_data === 'exp_step_select:MID');
      const juniorBtn = flat.find((b) => b.callback_data === 'exp_step_select:JUNIOR');

      expect(midBtn?.text).toContain('✅');
      expect(juniorBtn?.text).not.toContain('✅');
    });
  });

  describe('Level Selection Callback (exp_step_select)', () => {
    it('updates session and re-renders keyboard on selection', async () => {
      const route = getHandlerFor('exp_step_select:SENIOR');
      expect(route).not.toBeNull();

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'experience-level',
          language: 'ar',
          selectedSpecializations: [Specialization.BACKEND],
          selectedRegion: RegionPreference.BOTH,
          selectedExperience: 'ALL',
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.selectedExperience).toBe('SENIOR');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageReplyMarkup).toHaveBeenCalled();
    });
  });

  describe('Back Navigation (exp_step_back)', () => {
    it('returns user to Step 2: Region', async () => {
      const route = getHandlerFor('exp_step_back');
      expect(route).not.toBeNull();

      const mockCtx = {
        session: {
          step: 'experience-level',
          language: 'ar',
          selectedSpecializations: [Specialization.FRONTEND],
          selectedRegion: RegionPreference.ARAB,
          selectedExperience: 'JUNIOR',
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('region');
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('الخطوة 2:'),
        expect.anything(),
      );
    });
  });

  describe('Submit Navigation (exp_step_submit)', () => {
    it('advances user to Confirmation summary card', async () => {
      const route = getHandlerFor('exp_step_submit');
      expect(route).not.toBeNull();

      const mockCtx = {
        session: {
          step: 'experience-level',
          language: 'ar',
          selectedSpecializations: [Specialization.BACKEND],
          selectedRegion: RegionPreference.BOTH,
          selectedExperience: 'MID',
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('confirmation');
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ملخص إعدادات الـ Pipeline'),
        expect.anything(),
      );
    });
  });
});


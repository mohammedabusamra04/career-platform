import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import {
  registerRegionHandler,
  getRegionPromptMessage,
} from '../../src/bot/handlers/region.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import {
  RegionPreference,
  Specialization,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-35.1: Region Preference Selection (Arab, International, Both) (#103)', () => {
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

    registerRegionHandler(mockBot as unknown as Bot<BotContext>);
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
    it('returns prompt in Arabic when language is ar', () => {
      const msg = getRegionPromptMessage('ar');
      expect(msg).toContain('الخطوة 2:');
      expect(msg).toContain('السوق الجغرافي');
    });

    it('returns prompt in English when language is en', () => {
      const msg = getRegionPromptMessage('en');
      expect(msg).toContain('Step 2:');
      expect(msg).toContain('geographic market');
    });
  });

  describe('Region Selection Logic', () => {
    it.each([
      [RegionPreference.ARAB, 'region_select:ARAB'],
      [RegionPreference.INTERNATIONAL, 'region_select:INTERNATIONAL'],
      [RegionPreference.BOTH, 'region_select:BOTH'],
    ])('selects %s region and updates reply markup with checkmark', async (expectedRegion, callbackData) => {
      const route = getHandlerFor(callbackData);
      expect(route).not.toBeNull();

      const mockCtx = {
        match: route!.match,
        session: {
          step: 'region',
          language: 'ar',
          selectedSpecializations: [Specialization.BACKEND],
          selectedRegion: RegionPreference.BOTH,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.selectedRegion).toBe(expectedRegion);
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageReplyMarkup).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_markup: expect.anything(),
        }),
      );
    });
  });

  describe('Navigation: Back to Specializations (region_back)', () => {
    it('returns user to Step 1: Specializations and renders specialization keyboard', async () => {
      const route = getHandlerFor('region_back');
      expect(route).not.toBeNull();

      const mockCtx = {
        from: { first_name: 'Zaid' },
        session: {
          step: 'region',
          language: 'ar',
          selectedSpecializations: [Specialization.FRONTEND, Specialization.UIUX],
          selectedRegion: RegionPreference.ARAB,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('specializations');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('SmartJobsBot'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });
  });

  describe('Navigation: Submit Region (region_submit)', () => {
    it('advances user to Step 3: Confirmation and defaults to BOTH if unset', async () => {
      const route = getHandlerFor('region_submit');
      expect(route).not.toBeNull();

      const mockCtx = {
        session: {
          step: 'region',
          language: 'ar',
          selectedSpecializations: [Specialization.DEVOPS],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('confirmation');
      expect(mockCtx.session.selectedRegion).toBe(RegionPreference.BOTH);
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ملخص تفضيلات تنبيهات الوظائف'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('advances user with English confirmation prompt when language is en', async () => {
      const route = getHandlerFor('region_submit');

      const mockCtx = {
        session: {
          step: 'region',
          language: 'en',
          selectedSpecializations: [Specialization.AI_ENGINEER],
          selectedRegion: RegionPreference.INTERNATIONAL,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('confirmation');
      expect(mockCtx.session.selectedRegion).toBe(RegionPreference.INTERNATIONAL);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Review Your Job Alert Preferences'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });
  });
});


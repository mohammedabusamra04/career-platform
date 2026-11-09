import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import {
  registerSettingsHandler,
  formatSettingsDashboard,
} from '../../src/bot/handlers/settings.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import {
  RegionPreference,
  Specialization,
} from '../../src/modules/preferences/preference.taxonomy.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('TASK-36.1: /settings Interactive Preference Editor (#105)', () => {
  type CommandHandler = (ctx: BotContext) => Promise<void>;
  type CallbackHandler = (ctx: BotContext) => Promise<void>;

  let settingsCommandHandler: CommandHandler | undefined;
  const callbackQueryHandlers: Array<{ pattern: RegExp | string; handler: CallbackHandler }> = [];

  let mockBot: {
    command: ReturnType<typeof vi.fn>;
    callbackQuery: ReturnType<typeof vi.fn>;
  };

  const mockUserRepo = {
    findByTelegramId: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    markAsDeleted: vi.fn(),
    findActiveRecipients: vi.fn(),
  };

  const mockPrefRepo = {
    savePreferences: vi.fn(),
    findByUserId: vi.fn(),
    findByPreferenceHash: vi.fn(),
    findEquivalenceGroups: vi.fn(),
    deleteByUserId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callbackQueryHandlers.length = 0;
    settingsCommandHandler = undefined;

    mockBot = {
      command: vi.fn((cmd: string, handler: CommandHandler) => {
        if (cmd === 'settings') {
          settingsCommandHandler = handler;
        }
      }),
      callbackQuery: vi.fn((pattern: RegExp | string, handler: CallbackHandler) => {
        callbackQueryHandlers.push({ pattern, handler });
      }),
    };

    registerSettingsHandler(mockBot as unknown as Bot<BotContext>, {
      userRepository: mockUserRepo,
      preferenceRepository: mockPrefRepo,
    });
  });

  const getCallbackHandlerFor = (data: string) => {
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

  describe('formatSettingsDashboard', () => {
    it('formats settings dashboard in Arabic with active status and chosen fields', () => {
      const dashboard = formatSettingsDashboard(
        [Specialization.BACKEND, Specialization.FULLSTACK],
        RegionPreference.BOTH,
        UserStatus.ACTIVE,
        'ar',
      );

      expect(dashboard).toContain('إعدادات تنبيهات الوظائف الخاصة بك');
      expect(dashboard).toContain('نشط ومفعل');
      expect(dashboard).toContain('BACKEND, FULLSTACK');
      expect(dashboard).toContain('السوق العربي والدولي معاً');
    });

    it('formats settings dashboard in English with paused status', () => {
      const dashboard = formatSettingsDashboard(
        [Specialization.AI_ENGINEER],
        RegionPreference.INTERNATIONAL,
        UserStatus.PAUSED,
        'en',
      );

      expect(dashboard).toContain('Your Career Alert Settings');
      expect(dashboard).toContain('Paused');
      expect(dashboard).toContain('AI_ENGINEER');
      expect(dashboard).toContain('International & Global Remote Only');
    });
  });

  describe('/settings command', () => {
    it('fetches user preferences from DB and renders dashboard with inline keyboard', async () => {
      expect(settingsCommandHandler).toBeDefined();

      mockUserRepo.findByTelegramId.mockResolvedValue({
        id: 'usr-1',
        telegramId: 100200,
        status: UserStatus.ACTIVE,
      });

      mockPrefRepo.findByUserId.mockResolvedValue({
        id: 'pref-1',
        userId: 'usr-1',
        specializations: [Specialization.FRONTEND, Specialization.UIUX],
        regionPreference: RegionPreference.ARAB,
      });

      const mockCtx = {
        from: { id: 100200 },
        session: { language: 'ar' },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await settingsCommandHandler!(mockCtx);

      expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(100200);
      expect(mockPrefRepo.findByUserId).toHaveBeenCalledWith('usr-1');

      expect(mockCtx.session.selectedSpecializations).toEqual([
        Specialization.FRONTEND,
        Specialization.UIUX,
      ]);
      expect(mockCtx.session.selectedRegion).toBe(RegionPreference.ARAB);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('إعدادات تنبيهات الوظائف'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('prompts user to run /start if profile does not exist in database', async () => {
      mockUserRepo.findByTelegramId.mockResolvedValue(null);

      const mockCtx = {
        from: { id: 999999 },
        session: { language: 'en' },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await settingsCommandHandler!(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Profile not found. Please type /start'),
      );
    });
  });

  describe('settings callbacks', () => {
    it('settings_edit_specs navigates user to specialization keyboard without losing state', async () => {
      const route = getCallbackHandlerFor('settings_edit_specs');
      expect(route).not.toBeNull();

      const mockCtx = {
        from: { first_name: 'Ziad' },
        session: {
          language: 'ar',
          selectedSpecializations: [Specialization.DEVOPS],
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

    it('settings_edit_region navigates user to region keyboard', async () => {
      const route = getCallbackHandlerFor('settings_edit_region');
      expect(route).not.toBeNull();

      const mockCtx = {
        session: {
          language: 'ar',
          selectedRegion: RegionPreference.INTERNATIONAL,
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.step).toBe('region');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('الخطوة 2:'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('settings_toggle_lang switches language between ar and en instantly in dashboard', async () => {
      const route = getCallbackHandlerFor('settings_toggle_lang');
      expect(route).not.toBeNull();

      mockUserRepo.findByTelegramId.mockResolvedValue({
        id: 'usr-1',
        telegramId: 100200,
        status: UserStatus.ACTIVE,
      });

      const mockCtx = {
        from: { id: 100200 },
        session: {
          language: 'ar',
          selectedSpecializations: [Specialization.DATA],
          selectedRegion: RegionPreference.BOTH,
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        editMessageText: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockCtx.session.language).toBe('en');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Your Career Alert Settings'),
        expect.anything(),
      );
    });
  });
});

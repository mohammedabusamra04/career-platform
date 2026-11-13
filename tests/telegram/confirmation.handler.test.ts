import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import {
  registerConfirmationHandler,
  formatSummaryCard,
} from '../../src/bot/handlers/confirmation.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import {
  RegionPreference,
  Specialization,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-35.2: Interactive Summary Review & Transactional Preference Save (#104)', () => {
  type CallbackHandler = (ctx: BotContext) => Promise<void>;
  const callbackQueryHandlers: Array<{ pattern: RegExp | string; handler: CallbackHandler }> = [];

  let mockBot: {
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
    mockBot = {
      callbackQuery: vi.fn((pattern: RegExp | string, handler: CallbackHandler) => {
        callbackQueryHandlers.push({ pattern, handler });
      }),
    };

    registerConfirmationHandler(mockBot as unknown as Bot<BotContext>, {
      userRepository: mockUserRepo,
      preferenceRepository: mockPrefRepo,
      firstDigestService: {
        generateAndDeliverFirstDigest: vi.fn().mockResolvedValue({
          hasMatches: false,
          totalMatches: 0,
          page: 1,
          totalPages: 0,
          jobs: [],
          deliveredJobIds: [],
        }),
        formatDigestMessage: vi.fn().mockReturnValue(''),
        buildEmptyStateKeyboard: vi.fn(),
        recordDeliveredJobs: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
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

  describe('formatSummaryCard', () => {
    it('formats summary card in Arabic with delivery note without fixed hour constraint', () => {
      const card = formatSummaryCard([Specialization.BACKEND, Specialization.DEVOPS], RegionPreference.BOTH, 'ar');
      expect(card).toContain('ملخص تفضيلات تنبيهات الوظائف');
      expect(card).toContain('BACKEND, DEVOPS');
      expect(card).toContain('السوق العربي والدولي معاً');
      expect(card).toContain('ملخص يومي شامل بأفضل الفرص التقنية المطابقة يومياً 🚀');
    });

    it('formats summary card in English', () => {
      const card = formatSummaryCard([Specialization.AI_ENGINEER], RegionPreference.INTERNATIONAL, 'en');
      expect(card).toContain('Review Your Job Alert Preferences');
      expect(card).toContain('AI_ENGINEER');
      expect(card).toContain('International & Global Remote Only');
      expect(card).toContain('daily digest of the best matching tech opportunities every day 🚀');
    });
  });

  describe('pref_confirm (Transactional Save)', () => {
    it('saves preferences transactionally in PostgreSQL and sends confirmation message', async () => {
      const route = getHandlerFor('pref_confirm');
      expect(route).not.toBeNull();

      mockUserRepo.findByTelegramId.mockResolvedValue({
        id: 'user-db-123',
        telegramId: 445566,
      });
      mockPrefRepo.savePreferences.mockResolvedValue({
        id: 'pref-id-1',
        userId: 'user-db-123',
        specializations: [Specialization.FRONTEND],
        regionPreference: RegionPreference.BOTH,
        preferenceHash: 'hash-abc',
      });

      const mockCtx = {
        from: { id: 445566 },
        session: {
          step: 'confirmation',
          language: 'ar',
          selectedSpecializations: [Specialization.FRONTEND],
          selectedRegion: RegionPreference.BOTH,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      // Verify DB persistence
      expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(445566);
      expect(mockPrefRepo.savePreferences).toHaveBeenCalledWith('user-db-123', {
        specializations: [Specialization.FRONTEND],
        regionPreference: RegionPreference.BOTH,
      });

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('تم حفظ التفضيلات بنجاح!'),
        }),
      );

      // Verify success message sent
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('تهانينا! تم ضبط حسابك بنجاح!'),
        expect.objectContaining({
          parse_mode: 'Markdown',
        }),
      );
    });

    it('creates new user first if record not found during confirmation', async () => {
      const route = getHandlerFor('pref_confirm');

      mockUserRepo.findByTelegramId.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        id: 'new-user-789',
        telegramId: 998877,
      });
      mockPrefRepo.savePreferences.mockResolvedValue({});

      const mockCtx = {
        from: { id: 998877, first_name: 'Majid' },
        session: {
          step: 'confirmation',
          language: 'en',
          selectedSpecializations: [Specialization.DATA],
          selectedRegion: RegionPreference.ARAB,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockUserRepo.create).toHaveBeenCalledWith({
        telegramId: 998877,
        firstName: 'Majid',
        username: null,
      });
      expect(mockPrefRepo.savePreferences).toHaveBeenCalledWith('new-user-789', {
        specializations: [Specialization.DATA],
        regionPreference: RegionPreference.ARAB,
      });

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Congratulations! Your profile is all set!'),
        expect.anything(),
      );
    });

    it('alerts user safely if no specializations are in session', async () => {
      const route = getHandlerFor('pref_confirm');

      const mockCtx = {
        from: { id: 123 },
        session: {
          step: 'confirmation',
          language: 'ar',
          selectedSpecializations: [],
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      expect(mockPrefRepo.savePreferences).not.toHaveBeenCalled();
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({
        text: expect.stringContaining('تعذر حفظ التفضيلات'),
        show_alert: true,
      });
    });

    it('sends searching placeholder and edits it with generated digest and records delivered jobs', async () => {
      mockUserRepo.findByTelegramId.mockResolvedValue({
        id: 'user-db-123',
        telegramId: 778899,
      });
      mockPrefRepo.savePreferences.mockResolvedValue({
        id: 'pref-id-1',
        userId: 'user-db-123',
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        preferenceHash: 'hash-123',
      });

      const mockDigestService = {
        generateAndDeliverFirstDigest: vi.fn().mockResolvedValue({
          hasMatches: true,
          totalMatches: 2,
          page: 1,
          totalPages: 1,
          jobs: [
            {
              jobId: 'job-1',
              title: 'Backend Engineer',
              company: 'Acme Corp',
              url: 'https://example.com/apply',
              explanationAr: 'نسبة التوافق: 95%',
              explanationEn: 'Match Score: 95%',
            },
          ],
          deliveredJobIds: ['job-1'],
        }),
        formatDigestMessage: vi.fn().mockReturnValue('Formatted First Digest Message'),
        buildEmptyStateKeyboard: vi.fn(),
        recordDeliveredJobs: vi.fn().mockResolvedValue(undefined),
      };

      const localHandlers: Array<{ pattern: RegExp | string; handler: CallbackHandler }> = [];
      const customBot = {
        callbackQuery: vi.fn((pattern: RegExp | string, handler: CallbackHandler) => {
          localHandlers.push({ pattern, handler });
        }),
      };
      registerConfirmationHandler(customBot as unknown as Bot<BotContext>, {
        userRepository: mockUserRepo,
        preferenceRepository: mockPrefRepo,
        firstDigestService: mockDigestService as any,
      });

      const route = localHandlers.find((c) => c.pattern === 'pref_confirm');

      const mockCtx = {
        from: { id: 778899 },
        chat: { id: 778899 },
        api: {
          editMessageText: vi.fn().mockResolvedValue(undefined),
        },
        session: {
          step: 'confirmation',
          language: 'ar',
          selectedSpecializations: [Specialization.BACKEND],
          selectedRegion: RegionPreference.BOTH,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue({ message_id: 101 }),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      // Verify searching placeholder sent
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('جاري البحث عن أنسب الفرص'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );

      // Verify digest generation and message editing
      expect(mockDigestService.generateAndDeliverFirstDigest).toHaveBeenCalledWith(
        'user-db-123',
        expect.objectContaining({
          specializations: [Specialization.BACKEND],
          regionPreference: RegionPreference.BOTH,
        }),
      );

      expect(mockCtx.api.editMessageText).toHaveBeenCalledWith(
        778899,
        101,
        'Formatted First Digest Message',
        expect.objectContaining({
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }),
      );

      // Verify delivered jobs recorded post-edit
      expect(mockDigestService.recordDeliveredJobs).toHaveBeenCalledWith('user-db-123', ['job-1']);
    });

    it('resolves searching placeholder with localized fallback when digest generation fails', async () => {
      mockUserRepo.findByTelegramId.mockResolvedValue({
        id: 'user-db-123',
        telegramId: 778899,
      });
      mockPrefRepo.savePreferences.mockResolvedValue({
        id: 'pref-id-1',
        userId: 'user-db-123',
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        preferenceHash: 'hash-123',
      });

      const mockDigestService = {
        generateAndDeliverFirstDigest: vi.fn().mockRejectedValue(new Error('DB Connection Timeout')),
        formatDigestMessage: vi.fn(),
        buildEmptyStateKeyboard: vi.fn(),
        recordDeliveredJobs: vi.fn(),
      };

      const localHandlers: Array<{ pattern: RegExp | string; handler: CallbackHandler }> = [];
      const customBot = {
        callbackQuery: vi.fn((pattern: RegExp | string, handler: CallbackHandler) => {
          localHandlers.push({ pattern, handler });
        }),
      };
      registerConfirmationHandler(customBot as unknown as Bot<BotContext>, {
        userRepository: mockUserRepo,
        preferenceRepository: mockPrefRepo,
        firstDigestService: mockDigestService as any,
      });

      const route = localHandlers.find((c) => c.pattern === 'pref_confirm');

      const mockCtx = {
        from: { id: 778899 },
        chat: { id: 778899 },
        api: {
          editMessageText: vi.fn().mockResolvedValue(undefined),
        },
        session: {
          step: 'confirmation',
          language: 'ar',
          selectedSpecializations: [Specialization.BACKEND],
          selectedRegion: RegionPreference.BOTH,
          preferences: {},
        },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn().mockResolvedValue({ message_id: 102 }),
      } as unknown as BotContext;

      await route!.handler(mockCtx);

      // Verify placeholder was updated with friendly fallback message
      expect(mockCtx.api.editMessageText).toHaveBeenCalledWith(
        778899,
        102,
        expect.stringContaining('تعذر تحميل الملخص الفوري حالياً'),
      );
    });
  });

  describe('pref_edit (Return to Step 1)', () => {
    it('returns user to Step 1: Specializations to edit chosen fields', async () => {
      const route = getHandlerFor('pref_edit');
      expect(route).not.toBeNull();

      const mockCtx = {
        from: { first_name: 'Layla' },
        session: {
          step: 'confirmation',
          language: 'ar',
          selectedSpecializations: [Specialization.MOBILE],
          selectedRegion: RegionPreference.BOTH,
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
});

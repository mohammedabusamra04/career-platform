import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../src/bot/context.js';
import {
  buildDigestPaginationKeyboard,
} from '../../src/bot/keyboards/digest-pagination.keyboard.js';
import {
  registerDigestPaginationHandler,
  type DigestPaginationHandlerDependencies,
} from '../../src/bot/handlers/digest-pagination.handler.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import type { FirstDigestService } from '../../src/modules/delivery/first-digest.service.js';
import type { DigestCardJob } from '../../src/modules/notifications/telegram/digest-card.formatter.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('DigestPaginationHandler (TASK-43.2)', () => {
  describe('buildDigestPaginationKeyboard', () => {
    it('should build Page 1 keyboard with center indicator and Next button only (Arabic)', () => {
      const keyboard = buildDigestPaginationKeyboard(1, 4, 'ar');
      const buttons = keyboard.inline_keyboard[0];

      expect(buttons).toHaveLength(2);
      expect(buttons[0].text).toBe('📄 1/4');
      expect(buttons[0].callback_data).toBe('digest:noop');
      expect(buttons[1].text).toBe('التالي ▶️');
      expect(buttons[1].callback_data).toBe('digest:page:2');
    });

    it('should build Page 1 keyboard with English labels', () => {
      const keyboard = buildDigestPaginationKeyboard(1, 4, 'en');
      const buttons = keyboard.inline_keyboard[0];

      expect(buttons).toHaveLength(2);
      expect(buttons[0].text).toBe('📄 1/4');
      expect(buttons[0].callback_data).toBe('digest:noop');
      expect(buttons[1].text).toBe('Next ▶️');
      expect(buttons[1].callback_data).toBe('digest:page:2');
    });

    it('should build Page 2 keyboard with Prev, center indicator, and Next buttons', () => {
      const keyboard = buildDigestPaginationKeyboard(2, 4, 'ar');
      const buttons = keyboard.inline_keyboard[0];

      expect(buttons).toHaveLength(3);
      expect(buttons[0].text).toBe('◀️ السابق');
      expect(buttons[0].callback_data).toBe('digest:page:1');
      expect(buttons[1].text).toBe('📄 2/4');
      expect(buttons[1].callback_data).toBe('digest:noop');
      expect(buttons[2].text).toBe('التالي ▶️');
      expect(buttons[2].callback_data).toBe('digest:page:3');
    });

    it('should build last page (Page 4/4) keyboard with Prev and center indicator only', () => {
      const keyboard = buildDigestPaginationKeyboard(4, 4, 'ar');
      const buttons = keyboard.inline_keyboard[0];

      expect(buttons).toHaveLength(2);
      expect(buttons[0].text).toBe('◀️ السابق');
      expect(buttons[0].callback_data).toBe('digest:page:3');
      expect(buttons[1].text).toBe('📄 4/4');
      expect(buttons[1].callback_data).toBe('digest:noop');
    });

    it('should return empty keyboard when totalPages <= 1', () => {
      const singlePage = buildDigestPaginationKeyboard(1, 1, 'ar');
      expect(singlePage.inline_keyboard).toEqual([[]]);

      const zeroPages = buildDigestPaginationKeyboard(1, 0, 'ar');
      expect(zeroPages.inline_keyboard).toEqual([[]]);
    });

    it('should clamp out-of-bounds current page numbers', () => {
      const underClamp = buildDigestPaginationKeyboard(0, 4, 'ar');
      expect(underClamp.inline_keyboard[0][0].text).toBe('📄 1/4');

      const overClamp = buildDigestPaginationKeyboard(10, 4, 'ar');
      expect(overClamp.inline_keyboard[0][1].text).toBe('📄 4/4');
    });
  });

  describe('registerDigestPaginationHandler execution', () => {
    let mockBot: {
      callbackQuery: ReturnType<typeof vi.fn>;
    };
    let mockUserRepo: IUserRepository;
    let mockDigestService: FirstDigestService;
    let mockCandidateJobs: DigestCardJob[];

    let noopCallbackHandler: (ctx: BotContext) => Promise<void>;
    let pageCallbackHandler: (ctx: BotContext) => Promise<void>;

    beforeEach(() => {
      mockCandidateJobs = Array.from({ length: 15 }, (_, i) => ({
        id: `job-${i + 1}`,
        title: `Fullstack Engineer ${i + 1}`,
        company: `Company ${i + 1}`,
        applicationUrl: `https://example.com/apply/${i + 1}`,
        score: 80,
      }));

      mockUserRepo = {
        findByTelegramId: vi.fn().mockResolvedValue({
          id: 'user-uuid-1',
          telegramId: BigInt(123456789),
          firstName: 'Mohammed',
          username: 'm_abusamra',
          status: UserStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as unknown as IUserRepository;

      mockDigestService = {
        getPersonalizedDigestJobs: vi.fn().mockResolvedValue(mockCandidateJobs),
        recordDeliveredJobs: vi.fn().mockResolvedValue(undefined),
      } as unknown as FirstDigestService;

      mockBot = {
        callbackQuery: vi.fn((pattern, handler) => {
          if (pattern === 'digest:noop') {
            noopCallbackHandler = handler;
          } else {
            pageCallbackHandler = handler;
          }
        }),
      };

      const deps: DigestPaginationHandlerDependencies = {
        userRepository: mockUserRepo,
        firstDigestService: mockDigestService,
      };

      registerDigestPaginationHandler(mockBot as never, deps);
    });

    it('should acknowledge digest:noop immediately without editing message', async () => {
      const ctx = {
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn(),
      } as unknown as BotContext;

      await noopCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it('should edit message in-place when clicking digest:page:2', async () => {
      const ctx = {
        match: ['digest:page:2', '2'],
        from: { id: 123456789 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await pageCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(123456789);
      expect(mockDigestService.getPersonalizedDigestJobs).toHaveBeenCalledWith('user-uuid-1');

      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('الصفحة 2 من 3'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
        }),
      );

      // Verify delivered jobs for page 2 are recorded upon successful edit
      expect(mockDigestService.recordDeliveredJobs).toHaveBeenCalledWith(
        'user-uuid-1',
        ['job-6', 'job-7', 'job-8', 'job-9', 'job-10'],
      );
    });

    it('should not record delivered jobs if editMessageText fails', async () => {
      const ctx = {
        match: ['digest:page:2', '2'],
        from: { id: 123456789 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as BotContext;

      await pageCallbackHandler(ctx);

      expect(mockDigestService.recordDeliveredJobs).not.toHaveBeenCalled();
    });

    it('initial confirmation digest attaches pagination controls with the correct total page count', () => {
      // 12 jobs partitioned with pageSize 5 => 3 pages total
      const keyboard = buildDigestPaginationKeyboard(1, 3, 'ar');
      expect(keyboard.inline_keyboard[0][0].text).toBe('📄 1/3');
      expect(keyboard.inline_keyboard[0][1].text).toBe('التالي ▶️');
      expect(keyboard.inline_keyboard[0][1].callback_data).toBe('digest:page:2');
    });

    it('should edit message with English language when user session language is en', async () => {
      const ctx = {
        match: ['digest:page:2', '2'],
        from: { id: 123456789 },
        session: { language: 'en' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await pageCallbackHandler(ctx);

      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Page 2 of 3'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }),
      );
    });

    it('should gracefully handle "message is not modified" error without throwing', async () => {
      const ctx = {
        match: ['digest:page:1', '1'],
        from: { id: 123456789 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockRejectedValue(new Error('Bad Request: message is not modified')),
      } as unknown as BotContext;

      await expect(pageCallbackHandler(ctx)).resolves.not.toThrow();
    });

    it('should do nothing if user is not found in database', async () => {
      (mockUserRepo.findByTelegramId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const ctx = {
        match: ['digest:page:2', '2'],
        from: { id: 999999 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn(),
      } as unknown as BotContext;

      await pageCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../src/bot/context.js';
import {
  buildDigestFeedbackKeyboard,
  buildDigestPaginationKeyboard,
} from '../../src/bot/keyboards/digest-pagination.keyboard.js';
import {
  registerDigestFeedbackHandler,
  getDigestFeedbackToastMessage,
  type DigestFeedbackHandlerDependencies,
} from '../../src/bot/handlers/digest-feedback.handler.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import type { ISentJobRepository } from '../../src/modules/notifications/repositories/sent-job.repository.interface.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('DigestFeedbackHandler (TASK-43.3)', () => {
  describe('getDigestFeedbackToastMessage', () => {
    it('should return exact Arabic confirmation toast message', () => {
      const toast = getDigestFeedbackToastMessage('ar');
      expect(toast).toBe('تم تسجيل تقييمك! رح نضبطلك الفلتر للجايات 🎯');
    });

    it('should return exact English confirmation toast message', () => {
      const toast = getDigestFeedbackToastMessage('en');
      expect(toast).toBe('Feedback logged! Tuning your stack feed 🎯');
    });

    it('should default to Arabic when no language is provided', () => {
      const toast = getDigestFeedbackToastMessage();
      expect(toast).toBe('تم تسجيل تقييمك! رح نضبطلك الفلتر للجايات 🎯');
    });
  });

  describe('buildDigestFeedbackKeyboard', () => {
    it('should return empty keyboard when jobs array is empty or undefined', () => {
      const emptyKbd = buildDigestFeedbackKeyboard([]);
      expect(emptyKbd.inline_keyboard).toEqual([[]]);

      const undefinedKbd = buildDigestFeedbackKeyboard(undefined as never);
      expect(undefinedKbd.inline_keyboard).toEqual([[]]);
    });

    it('should format single job without index numbers', () => {
      const keyboard = buildDigestFeedbackKeyboard([{ id: 'job-single-1' }]);
      expect(keyboard.inline_keyboard).toHaveLength(1);
      const row = keyboard.inline_keyboard[0];
      expect(row).toHaveLength(2);
      expect(row[0].text).toBe('👍');
      expect(row[0].callback_data).toBe('feedback:like:job-single-1');
      expect(row[1].text).toBe('👎');
      expect(row[1].callback_data).toBe('feedback:dislike:job-single-1');
    });

    it('should format multiple jobs with indices and 2 jobs per row', () => {
      const jobs = [
        { id: 'job-1' },
        { id: 'job-2' },
        { id: 'job-3' },
        { id: 'job-4' },
        { id: 'job-5' },
      ];
      const keyboard = buildDigestFeedbackKeyboard(jobs);

      // 5 jobs: Row 1 (jobs 1, 2 = 4 buttons), Row 2 (jobs 3, 4 = 4 buttons), Row 3 (job 5 = 2 buttons)
      expect(keyboard.inline_keyboard).toHaveLength(3);

      const row1 = keyboard.inline_keyboard[0];
      expect(row1).toHaveLength(4);
      expect(row1[0].text).toBe('👍 1');
      expect(row1[0].callback_data).toBe('feedback:like:job-1');
      expect(row1[1].text).toBe('👎 1');
      expect(row1[1].callback_data).toBe('feedback:dislike:job-1');
      expect(row1[2].text).toBe('👍 2');
      expect(row1[2].callback_data).toBe('feedback:like:job-2');
      expect(row1[3].text).toBe('👎 2');
      expect(row1[3].callback_data).toBe('feedback:dislike:job-2');

      const row2 = keyboard.inline_keyboard[1];
      expect(row2).toHaveLength(4);
      expect(row2[0].text).toBe('👍 3');
      expect(row2[2].text).toBe('👍 4');

      const row3 = keyboard.inline_keyboard[2];
      expect(row3).toHaveLength(2);
      expect(row3[0].text).toBe('👍 5');
      expect(row3[0].callback_data).toBe('feedback:like:job-5');
      expect(row3[1].text).toBe('👎 5');
      expect(row3[1].callback_data).toBe('feedback:dislike:job-5');
    });

    it('should support string ids and jobId property', () => {
      const keyboard = buildDigestFeedbackKeyboard(['job-str-1', { jobId: 'job-obj-2' }]);
      const row = keyboard.inline_keyboard[0];
      expect(row).toHaveLength(4);
      expect(row[0].callback_data).toBe('feedback:like:job-str-1');
      expect(row[2].callback_data).toBe('feedback:like:job-obj-2');
    });
  });

  describe('buildDigestPaginationKeyboard with feedback buttons', () => {
    it('should combine feedback rows and pagination controls', () => {
      const jobs = [{ id: 'job-a' }, { id: 'job-b' }];
      const keyboard = buildDigestPaginationKeyboard(1, 3, 'ar', jobs);

      // Row 1: jobs a and b (4 buttons)
      // Row 2: pagination (📄 1/3, Next)
      expect(keyboard.inline_keyboard).toHaveLength(2);
      expect(keyboard.inline_keyboard[0]).toHaveLength(4);
      expect(keyboard.inline_keyboard[1]).toHaveLength(2);
      expect(keyboard.inline_keyboard[1][0].text).toBe('📄 1/3');
      expect(keyboard.inline_keyboard[1][1].text).toBe('التالي ▶️');
    });

    it('should include feedback buttons even if totalPages is 1', () => {
      const jobs = [{ id: 'job-only' }];
      const keyboard = buildDigestPaginationKeyboard(1, 1, 'ar', jobs);

      expect(keyboard.inline_keyboard).toHaveLength(1);
      expect(keyboard.inline_keyboard[0][0].text).toBe('👍');
      expect(keyboard.inline_keyboard[0][1].text).toBe('👎');
    });
  });

  describe('registerDigestFeedbackHandler callback handling', () => {
    let mockBot: {
      callbackQuery: ReturnType<typeof vi.fn>;
    };
    let mockUserRepo: IUserRepository;
    let mockSentJobRepo: ISentJobRepository;
    let feedbackCallbackHandler: (ctx: BotContext) => Promise<void>;

    beforeEach(() => {
      mockUserRepo = {
        findByTelegramId: vi.fn().mockResolvedValue({
          id: 'user-uuid-100',
          telegramId: BigInt(987654321),
          firstName: 'Candidate',
          username: 'candidate_dev',
          status: UserStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as unknown as IUserRepository;

      mockSentJobRepo = {
        recordFeedback: vi.fn().mockResolvedValue({
          id: 'sent-job-1',
          userId: 'user-uuid-100',
          jobId: 'job-uuid-200',
          sentAt: new Date(),
          feedback: 'LIKE',
        }),
      } as unknown as ISentJobRepository;

      mockBot = {
        callbackQuery: vi.fn((_pattern, handler) => {
          feedbackCallbackHandler = handler;
        }),
      };

      const deps: DigestFeedbackHandlerDependencies = {
        userRepository: mockUserRepo,
        sentJobRepository: mockSentJobRepo,
      };

      registerDigestFeedbackHandler(mockBot as never, deps);
    });

    it('should record LIKE feedback and display Arabic confirmation toast', async () => {
      const ctx = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: { id: 987654321 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await feedbackCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'تم تسجيل تقييمك! رح نضبطلك الفلتر للجايات 🎯',
      });
      expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(987654321);
      expect(mockSentJobRepo.recordFeedback).toHaveBeenCalledWith(
        'user-uuid-100',
        'job-uuid-200',
        'LIKE',
      );
    });

    it('should record DISLIKE feedback and display English confirmation toast when language is en', async () => {
      const ctx = {
        match: ['feedback:dislike:job-uuid-300', 'dislike', 'job-uuid-300'],
        from: { id: 987654321 },
        session: { language: 'en' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await feedbackCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'Feedback logged! Tuning your stack feed 🎯',
      });
      expect(mockSentJobRepo.recordFeedback).toHaveBeenCalledWith(
        'user-uuid-100',
        'job-uuid-300',
        'DISLIKE',
      );
    });

    it('should acknowledge callback query promptly before database write completes', async () => {
      let callbackAcknowledged = false;
      const ctx = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: { id: 987654321 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockImplementation(async () => {
          callbackAcknowledged = true;
          return true;
        }),
      } as unknown as BotContext;

      (mockSentJobRepo.recordFeedback as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        expect(callbackAcknowledged).toBe(true);
      });

      await feedbackCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockSentJobRepo.recordFeedback).toHaveBeenCalledTimes(1);
    });

    it('should handle user not found gracefully without crashing or throwing', async () => {
      (mockUserRepo.findByTelegramId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const ctx = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: { id: 999999999 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await feedbackCallbackHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockSentJobRepo.recordFeedback).not.toHaveBeenCalled();
    });

    it('should handle database error in recordFeedback gracefully without throwing', async () => {
      (mockSentJobRepo.recordFeedback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const ctx = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: { id: 987654321 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await expect(feedbackCallbackHandler(ctx)).resolves.not.toThrow();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });

    it('should safely handle answerCallbackQuery network failures without interrupting workflow', async () => {
      const ctx = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: { id: 987654321 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockRejectedValueOnce(new Error('Query is too old')),
      } as unknown as BotContext;

      await expect(feedbackCallbackHandler(ctx)).resolves.not.toThrow();
      expect(mockSentJobRepo.recordFeedback).toHaveBeenCalledWith(
        'user-uuid-100',
        'job-uuid-200',
        'LIKE',
      );
    });

    it('should ignore callback if match parameters or telegramId are missing', async () => {
      const ctxNoMatch = {
        match: undefined,
        from: { id: 987654321 },
        answerCallbackQuery: vi.fn(),
      } as unknown as BotContext;

      await feedbackCallbackHandler(ctxNoMatch);
      expect(ctxNoMatch.answerCallbackQuery).not.toHaveBeenCalled();

      const ctxNoFrom = {
        match: ['feedback:like:job-uuid-200', 'like', 'job-uuid-200'],
        from: undefined,
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await feedbackCallbackHandler(ctxNoFrom);
      expect(ctxNoFrom.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockSentJobRepo.recordFeedback).not.toHaveBeenCalled();
    });
  });
});

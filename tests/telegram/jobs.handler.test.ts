import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../src/bot/context.js';
import {
  registerJobsHandler,
  type JobsHandlerDependencies,
} from '../../src/bot/handlers/jobs.handler.js';
import type { JobExplorerService, JobExplorerResult } from '../../src/modules/jobs/jobExplorer.service.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('JobsHandler (TASK-44.1)', () => {
  let mockBot: {
    command: ReturnType<typeof vi.fn>;
    callbackQuery: ReturnType<typeof vi.fn>;
  };
  let mockUserRepo: IUserRepository;
  let mockExplorerService: JobExplorerService;

  let commandHandler: (ctx: BotContext) => Promise<void>;
  let noopHandler: (ctx: BotContext) => Promise<void>;
  let pageHandler: (ctx: BotContext) => Promise<void>;
  let sortHandler: (ctx: BotContext) => Promise<void>;

  const sampleResult: JobExplorerResult = {
    hasMatches: true,
    totalMatches: 47,
    currentPage: 1,
    totalPages: 10,
    pageSize: 5,
    sort: 'BEST_MATCH',
    jobs: [
      {
        id: 'job-1',
        title: 'Fullstack Developer',
        company: 'InnovateHub',
        url: 'https://example.com/apply/1',
        applicationUrl: 'https://example.com/apply/1',
        score: 88,
      },
      {
        id: 'job-2',
        title: 'Backend Lead',
        company: 'CloudCore',
        url: 'https://example.com/apply/2',
        applicationUrl: 'https://example.com/apply/2',
        score: 82,
      },
    ],
    executionTimeMs: 25,
  };

  beforeEach(() => {
    mockUserRepo = {
      findByTelegramId: vi.fn().mockResolvedValue({
        id: 'user-uuid-1',
        telegramId: BigInt(123456789),
        firstName: 'Ahmed',
        username: 'ahmed_dev',
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as unknown as IUserRepository;

    mockExplorerService = {
      getJobsForUser: vi.fn().mockResolvedValue(sampleResult),
      formatJobsExplorerMessage: vi.fn().mockReturnValue('🎯 **وجدنا 47 وظيفة نشطة تناسب تخصصاتك!**\n\nJob list here...'),
    } as unknown as JobExplorerService;

    mockBot = {
      command: vi.fn((_cmd, handler) => {
        commandHandler = handler;
      }),
      callbackQuery: vi.fn((pattern, handler) => {
        if (pattern === 'jobs:noop') {
          noopHandler = handler;
        } else if (typeof pattern !== 'string' && pattern.toString().includes('page')) {
          pageHandler = handler;
        } else if (typeof pattern !== 'string' && pattern.toString().includes('sort')) {
          sortHandler = handler;
        }
      }),
    };

    const deps: JobsHandlerDependencies = {
      userRepository: mockUserRepo,
      jobExplorerService: mockExplorerService,
    };

    registerJobsHandler(mockBot as never, deps);
  });

  describe('Command: /jobs', () => {
    it('should prompt user to configure profile via /start if user does not exist', async () => {
      (mockUserRepo.findByTelegramId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const ctx = {
        from: { id: 999999 },
        session: { language: 'ar' },
        reply: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await commandHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('لسا ما ضبطت الـ Stack تبعك! ابعت /start'),
      );
      expect(mockExplorerService.getJobsForUser).not.toHaveBeenCalled();
    });

    it('should display active matching jobs with keyboard when matches are found', async () => {
      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar', jobsSort: 'BEST_MATCH' },
        reply: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await commandHandler(ctx);

      expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(123456789);
      expect(mockExplorerService.getJobsForUser).toHaveBeenCalledWith('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('وجدنا 47 وظيفة نشطة'),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.any(Object),
        }),
      );
    });

    it('should render empty state keyboard when 0 active matches found', async () => {
      (mockExplorerService.getJobsForUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hasMatches: false,
        totalMatches: 0,
        currentPage: 1,
        totalPages: 0,
        pageSize: 5,
        sort: 'BEST_MATCH',
        jobs: [],
        executionTimeMs: 10,
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'en' },
        reply: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await commandHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reply_markup: expect.any(Object),
        }),
      );
    });
  });

  describe('Callback Query: jobs:noop', () => {
    it('should acknowledge noop callback immediately', async () => {
      const ctx = {
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await noopHandler(ctx);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('Callback Query: jobs:page:<targetPage>', () => {
    it('should acknowledge callback and edit message in-place for target page statelessly from callback query', async () => {
      const ctx = {
        match: ['jobs:page:BEST_MATCH:2', 'BEST_MATCH', '2'],
        from: { id: 123456789 },
        session: { language: 'ar' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await pageHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockExplorerService.getJobsForUser).toHaveBeenCalledWith('user-uuid-1', {
        page: 2,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.any(Object),
        }),
      );
    });

    it('should support legacy page format without sort in callback data', async () => {
      const ctx = {
        match: ['jobs:page:3', undefined, '3'],
        from: { id: 123456789 },
        session: { language: 'en', jobsSort: 'LATEST' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await pageHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(mockExplorerService.getJobsForUser).toHaveBeenCalledWith('user-uuid-1', {
        page: 3,
        pageSize: 5,
        sort: 'LATEST',
      });
    });
  });

  describe('Callback Query: jobs:sort:(BEST_MATCH|LATEST)', () => {
    it('should switch sorting order to LATEST, show localized toast, and edit message in-place without restarting flow', async () => {
      const sessionObj = { language: 'ar' as const, jobsSort: 'BEST_MATCH' as const };
      const ctx = {
        match: ['jobs:sort:LATEST', 'LATEST'],
        from: { id: 123456789 },
        session: sessionObj,
        reply: vi.fn(),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await sortHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '⏱️ الترتيب: الأحدث نزولاً',
        }),
      );
      expect(sessionObj.jobsSort).toBe('LATEST');
      expect(mockExplorerService.getJobsForUser).toHaveBeenCalledWith('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'LATEST',
      });
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
      // Verify conversation flow was NOT restarted (reply never called)
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('should switch sorting order to BEST_MATCH, show English toast, and edit message in-place', async () => {
      const sessionObj = { language: 'en' as const, jobsSort: 'LATEST' as const };
      const ctx = {
        match: ['jobs:sort:BEST_MATCH', 'BEST_MATCH'],
        from: { id: 123456789 },
        session: sessionObj,
        reply: vi.fn(),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      } as unknown as BotContext;

      await sortHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '🎯 Sorted by: Best Stack Fit',
        }),
      );
      expect(sessionObj.jobsSort).toBe('BEST_MATCH');
      expect(mockExplorerService.getJobsForUser).toHaveBeenCalledWith('user-uuid-1', {
        page: 1,
        pageSize: 5,
        sort: 'BEST_MATCH',
      });
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('should safely ignore "message is not modified" error from Telegram API', async () => {
      const ctx = {
        match: ['jobs:sort:LATEST', 'LATEST'],
        from: { id: 123456789 },
        session: { language: 'ar', jobsSort: 'BEST_MATCH' },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockRejectedValue(new Error('Bad Request: message is not modified')),
      } as unknown as BotContext;

      await expect(sortHandler(ctx)).resolves.not.toThrow();
    });
  });
});


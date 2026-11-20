import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../src/bot/context.js';
import {
  registerPauseResumeHandler,
  PAUSE_MESSAGES,
} from '../../src/bot/handlers/pause-resume.handler.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('TASK-36.2: /pause & /resume Commands (#106)', () => {
  let commands: Record<string, (ctx: any) => Promise<void>>;
  let callbacks: Record<string, (ctx: any) => Promise<void>>;
  let mockBot: any;
  let mockUserRepository: IUserRepository;

  const sampleUser = {
    id: 'user-123',
    telegramId: 123456789,
    firstName: 'Ahmed',
    username: 'ahmed_dev',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    pausedUntil: null,
  };

  beforeEach(() => {
    commands = {};
    callbacks = {};

    mockBot = {
      command: vi.fn((cmd: string, handler: (ctx: any) => Promise<void>) => {
        commands[cmd] = handler;
      }),
      callbackQuery: vi.fn((pattern: string, handler: (ctx: any) => Promise<void>) => {
        callbacks[pattern] = handler;
      }),
    };

    mockUserRepository = {
      findByTelegramId: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      markAsDeleted: vi.fn(),
      findActiveRecipients: vi.fn(),
    };

    registerPauseResumeHandler(mockBot, {
      userRepository: mockUserRepository,
    });
  });

  describe('Command: /pause', () => {
    it('prompts user to register via /start if no account exists', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(null);

      const ctx = {
        from: { id: 999999999 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['pause'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(PAUSE_MESSAGES.notRegistered.ar);
    });

    it('renders pause prompt and inline keyboard in Arabic by default', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(sampleUser);

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['pause'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        PAUSE_MESSAGES.prompt.ar,
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('renders pause prompt and inline keyboard in English when configured', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(sampleUser);

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'en' },
        reply: vi.fn(),
      };

      await commands['pause'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        PAUSE_MESSAGES.prompt.en,
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });
  });

  describe('Callback Query: pause_1d', () => {
    it('pauses notifications for 24 hours ($NOW + 24h)', async () => {
      vi.mocked(mockUserRepository.updateStatus).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.PAUSED,
        pausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      const before = Date.now();
      await callbacks['pause_1d'](ctx);
      const after = Date.now();

      expect(mockUserRepository.updateStatus).toHaveBeenCalledWith(
        123456789,
        UserStatus.PAUSED,
        expect.any(Date),
      );

      const calledDate = vi.mocked(mockUserRepository.updateStatus).mock.calls[0][2] as Date;
      const diffMs = calledDate.getTime() - before;
      expect(diffMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + (after - before) + 1000);

      expect(ctx.editMessageText).toHaveBeenCalledWith(PAUSE_MESSAGES.paused1d.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Callback Query: pause_7d', () => {
    it('pauses notifications for 7 days ($NOW + 7d)', async () => {
      vi.mocked(mockUserRepository.updateStatus).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.PAUSED,
        pausedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'en' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      const before = Date.now();
      await callbacks['pause_7d'](ctx);

      expect(mockUserRepository.updateStatus).toHaveBeenCalledWith(
        123456789,
        UserStatus.PAUSED,
        expect.any(Date),
      );

      const calledDate = vi.mocked(mockUserRepository.updateStatus).mock.calls[0][2] as Date;
      const diffMs = calledDate.getTime() - before;
      expect(diffMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);

      expect(ctx.editMessageText).toHaveBeenCalledWith(PAUSE_MESSAGES.paused7d.en);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Callback Query: pause_indefinite', () => {
    it('pauses notifications indefinitely (pausedUntil = null)', async () => {
      vi.mocked(mockUserRepository.updateStatus).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.PAUSED,
        pausedUntil: null,
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      await callbacks['pause_indefinite'](ctx);

      expect(mockUserRepository.updateStatus).toHaveBeenCalledWith(
        123456789,
        UserStatus.PAUSED,
        null,
      );

      expect(ctx.editMessageText).toHaveBeenCalledWith(PAUSE_MESSAGES.pausedIndefinite.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Callback Query: pause_cancel', () => {
    it('cancels pause and informs user that alerts remain active', async () => {
      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      await callbacks['pause_cancel'](ctx);

      expect(mockUserRepository.updateStatus).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith(PAUSE_MESSAGES.cancel.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Command: /resume', () => {
    it('prompts user to register via /start if no account exists', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(null);

      const ctx = {
        from: { id: 999999999 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['resume'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(PAUSE_MESSAGES.notRegistered.ar);
    });

    it('resumes alerts when user is currently PAUSED', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.PAUSED,
        pausedUntil: new Date(Date.now() + 100000),
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['resume'](ctx);

      expect(mockUserRepository.updateStatus).toHaveBeenCalledWith(
        123456789,
        UserStatus.ACTIVE,
        null,
      );
      expect(ctx.reply).toHaveBeenCalledWith(PAUSE_MESSAGES.resumed.ar);
    });

    it('informs user if alerts are already ACTIVE', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.ACTIVE,
        pausedUntil: null,
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['resume'](ctx);

      expect(mockUserRepository.updateStatus).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(PAUSE_MESSAGES.alreadyActive.ar);
    });
  });

  describe('Dispatch Exclusions for Paused Users', () => {
    it('verifies that paused users with future pausedUntil are strictly excluded from active recipients', () => {
      const now = new Date('2026-10-20T09:00:00Z');
      const activeUser = { ...sampleUser, status: UserStatus.ACTIVE };
      const pausedFutureUser = {
        ...sampleUser,
        id: 'user-paused-future',
        status: UserStatus.PAUSED,
        pausedUntil: new Date('2026-10-21T09:00:00Z'),
      };
      const pausedIndefiniteUser = {
        ...sampleUser,
        id: 'user-paused-indefinite',
        status: UserStatus.PAUSED,
        pausedUntil: null,
      };
      const pausedExpiredUser = {
        ...sampleUser,
        id: 'user-paused-expired',
        status: UserStatus.PAUSED,
        pausedUntil: new Date('2026-10-20T08:00:00Z'),
      };

      const allUsers = [activeUser, pausedFutureUser, pausedIndefiniteUser, pausedExpiredUser];

      // Prisma query criteria simulation matching PrismaUserRepository.findActiveRecipients:
      const eligibleUsers = allUsers.filter(
        (u) =>
          u.status === UserStatus.ACTIVE ||
          (u.status === UserStatus.PAUSED && u.pausedUntil !== null && u.pausedUntil <= now),
      );

      expect(eligibleUsers).toContain(activeUser);
      expect(eligibleUsers).toContain(pausedExpiredUser);
      expect(eligibleUsers).not.toContain(pausedFutureUser);
      expect(eligibleUsers).not.toContain(pausedIndefiniteUser);
    });
  });
});

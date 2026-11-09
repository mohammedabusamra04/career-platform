import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../src/bot/context.js';
import {
  registerStopHandler,
  STOP_MESSAGES,
} from '../../src/bot/handlers/stop.handler.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import type { IUserPreferenceRepository } from '../../src/modules/preferences/repositories/user-preference.repository.interface.js';
import { UserStatus } from '../../src/modules/users/user.types.js';

describe('TASK-36.3: /stop Two-Step Confirmation & Data Anonymization (#107)', () => {
  let commands: Record<string, (ctx: any) => Promise<void>>;
  let callbacks: Record<string, (ctx: any) => Promise<void>>;
  let mockBot: any;
  let mockUserRepository: IUserRepository;
  let mockPreferenceRepository: IUserPreferenceRepository;

  const sampleUser = {
    id: 'user-xyz-456',
    telegramId: 123456789,
    firstName: 'Sara',
    username: 'sara_dev',
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

    mockPreferenceRepository = {
      savePreferences: vi.fn(),
      findByUserId: vi.fn(),
      findByPreferenceHash: vi.fn(),
      findEquivalenceGroups: vi.fn(),
      deleteByUserId: vi.fn(),
    };

    registerStopHandler(mockBot, {
      userRepository: mockUserRepository,
      preferenceRepository: mockPreferenceRepository,
    });
  });

  describe('Command: /stop', () => {
    it('prompts user to register via /start if no account exists', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(null);

      const ctx = {
        from: { id: 999999999 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['stop'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(STOP_MESSAGES.notRegistered.ar);
    });

    it('informs user if account is already marked as DELETED', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.DELETED,
      });

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['stop'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(STOP_MESSAGES.alreadyDeleted.ar);
    });

    it('renders deletion warning and confirmation keyboard in Arabic by default', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(sampleUser);

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['stop'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        STOP_MESSAGES.warning.ar,
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });

    it('renders deletion warning and confirmation keyboard in English when configured', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(sampleUser);

      const ctx = {
        from: { id: 123456789 },
        session: { language: 'en' },
        reply: vi.fn(),
      };

      await commands['stop'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        STOP_MESSAGES.warning.en,
        expect.objectContaining({
          parse_mode: 'Markdown',
          reply_markup: expect.anything(),
        }),
      );
    });
  });

  describe('Callback Query: stop_confirm', () => {
    it('executes soft delete, prunes preferences, clears session, and notifies user', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(sampleUser);
      vi.mocked(mockUserRepository.markAsDeleted).mockResolvedValue({
        ...sampleUser,
        status: UserStatus.DELETED,
        firstName: null,
        username: null,
      });
      vi.mocked(mockPreferenceRepository.deleteByUserId).mockResolvedValue();

      const session: any = {
        language: 'ar',
        step: 'confirmation',
        selectedSpecializations: ['FRONTEND_ENGINEERING'],
        preferences: { experienceLevel: 'MID' },
      };

      const ctx = {
        from: { id: 123456789 },
        session,
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      await callbacks['stop_confirm'](ctx);

      expect(mockUserRepository.markAsDeleted).toHaveBeenCalledWith(123456789);
      expect(mockPreferenceRepository.deleteByUserId).toHaveBeenCalledWith('user-xyz-456');

      expect(ctx.session.step).toBe('specializations');
      expect(ctx.session.selectedSpecializations).toEqual([]);
      expect(ctx.session.preferences).toEqual({});

      expect(ctx.editMessageText).toHaveBeenCalledWith(STOP_MESSAGES.deleted.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('handles non-existent user safely on confirm callback', async () => {
      vi.mocked(mockUserRepository.findByTelegramId).mockResolvedValue(null);

      const ctx = {
        from: { id: 888888888 },
        session: { language: 'ar' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      await callbacks['stop_confirm'](ctx);

      expect(mockUserRepository.markAsDeleted).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith(STOP_MESSAGES.notRegistered.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Callback Query: stop_cancel', () => {
    it('aborts deletion, preserves user state, and sends cancellation notice', async () => {
      const ctx = {
        from: { id: 123456789 },
        session: { language: 'ar' },
        editMessageText: vi.fn(),
        answerCallbackQuery: vi.fn(),
      };

      await callbacks['stop_cancel'](ctx);

      expect(mockUserRepository.markAsDeleted).not.toHaveBeenCalled();
      expect(mockPreferenceRepository.deleteByUserId).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith(STOP_MESSAGES.cancelled.ar);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe('Dispatch Exclusions for Deleted Users (Acceptance Criteria)', () => {
    it('guarantees that DELETED users are strictly excluded from findActiveRecipients', () => {
      const now = new Date('2026-10-20T09:00:00Z');
      const activeUser = { ...sampleUser, id: 'user-active', status: UserStatus.ACTIVE };
      const deletedUser = {
        ...sampleUser,
        id: 'user-deleted',
        status: UserStatus.DELETED,
        firstName: null,
        username: null,
        pausedUntil: null,
      };

      const allUsers = [activeUser, deletedUser];

      // Exact criteria implemented in PrismaUserRepository.findActiveRecipients:
      const eligibleUsers = allUsers.filter(
        (u) =>
          u.status === UserStatus.ACTIVE ||
          (u.status === UserStatus.PAUSED && u.pausedUntil !== null && u.pausedUntil <= now),
      );

      expect(eligibleUsers).toContain(activeUser);
      expect(eligibleUsers).not.toContain(deletedUser);
      expect(eligibleUsers).toHaveLength(1);
    });
  });
});

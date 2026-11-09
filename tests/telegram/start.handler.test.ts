import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import { registerStartHandler, getWelcomeMessage } from '../../src/bot/handlers/start.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import { UserStatus } from '../../src/modules/users/user.types.js';
import { Specialization } from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-34.1: Welcome & State Initialization on /start (#101)', () => {
  let mockBot: {
    command: ReturnType<typeof vi.fn>;
    hears: ReturnType<typeof vi.fn>;
    callbackQuery: ReturnType<typeof vi.fn>;
  };
  let commandHandler: ((ctx: BotContext) => Promise<void>) | undefined;

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
    mockBot = {
      command: vi.fn((cmd: string, handler: (ctx: BotContext) => Promise<void>) => {
        if (cmd === 'start') {
          commandHandler = handler;
        }
      }),
      hears: vi.fn(),
      callbackQuery: vi.fn(),
    };

    registerStartHandler(mockBot as unknown as Bot<BotContext>, {
      userRepository: mockUserRepo,
      preferenceRepository: mockPrefRepo,
    });
  });

  it('registers /start command handler with bot', () => {
    expect(mockBot.command).toHaveBeenCalledWith('start', expect.any(Function));
  });

  it('creates a new user when non-existent telegramId sends /start', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({
      id: 'user-123',
      telegramId: 987654321,
      firstName: 'Ahmad',
      username: 'ahmad_dev',
      status: UserStatus.ACTIVE,
    });

    const mockCtx = {
      from: {
        id: 987654321,
        first_name: 'Ahmad',
        username: 'ahmad_dev',
      },
      session: undefined as unknown,
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotContext;

    await commandHandler!(mockCtx);

    // Verify user creation
    expect(mockUserRepo.findByTelegramId).toHaveBeenCalledWith(987654321);
    expect(mockUserRepo.create).toHaveBeenCalledWith({
      telegramId: 987654321,
      firstName: 'Ahmad',
      username: 'ahmad_dev',
      status: UserStatus.ACTIVE,
    });

    // Verify session state initialization
    expect(mockCtx.session).toEqual({
      step: 'specializations',
      language: 'ar',
      selectedSpecializations: [],
      preferences: {},
    });

    // Verify welcome message and keyboard
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('مرحباً بك في **SmartJobsBot** Ahmad!'),
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: expect.anything(),
      }),
    );
  });

  it('loads existing user preferences when existing user sends /start', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-existing-1',
      telegramId: 11223344,
      firstName: 'Sarah',
      status: UserStatus.ACTIVE,
    });

    mockPrefRepo.findByUserId.mockResolvedValue({
      id: 'pref-1',
      userId: 'user-existing-1',
      specializations: [Specialization.FRONTEND, Specialization.UIUX],
    });

    const mockCtx = {
      from: {
        id: 11223344,
        first_name: 'Sarah',
      },
      session: {
        language: 'ar',
      },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotContext;

    await commandHandler!(mockCtx);

    expect(mockUserRepo.create).not.toHaveBeenCalled();
    expect(mockPrefRepo.findByUserId).toHaveBeenCalledWith('user-existing-1');

    // Verify draft populated with existing preferences
    expect(mockCtx.session).toEqual({
      step: 'specializations',
      language: 'ar',
      selectedSpecializations: [Specialization.FRONTEND, Specialization.UIUX],
      preferences: {},
    });
  });

  it('supports English welcome greeting when language is en', () => {
    const enGreeting = getWelcomeMessage('en', 'John');
    expect(enGreeting).toContain('Welcome to **SmartJobsBot** John!');
    expect(enGreeting).toContain('**Step 1:** Select between');

    const arGreeting = getWelcomeMessage('ar', 'علي');
    expect(arGreeting).toContain('مرحباً بك في **SmartJobsBot** علي!');
    expect(arGreeting).toContain('**الخطوة 1:** اختر من');
  });

  it('ensures idempotency on repeated /start commands without error', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({
      id: 'user-999',
      telegramId: 999,
      status: UserStatus.ACTIVE,
    });
    mockPrefRepo.findByUserId.mockResolvedValue(null);

    const mockCtx = {
      from: { id: 999, first_name: 'Omar' },
      session: { step: 'confirmation', preferences: { jobTitle: 'Node.js' } },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotContext;

    // Send /start multiple times
    await commandHandler!(mockCtx);
    await commandHandler!(mockCtx);

    // Verify session reset cleanly back to step 1
    expect(mockCtx.session).toEqual({
      step: 'specializations',
      language: 'ar',
      selectedSpecializations: [],
      preferences: {},
    });
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
  });
});

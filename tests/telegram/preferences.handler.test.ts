import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Bot } from 'grammy';
import { registerPreferencesHandler } from '../../src/bot/handlers/preferences.handler.js';
import type { BotContext } from '../../src/bot/context.js';
import type { UserPreferences } from '../../src/modules/preferences/preference.types.js';
import { preferenceService } from '../../src/modules/preferences/preference.service.js';
import { subscriptionService } from '../../src/modules/subscriptions/subscription.service.js';
import { WorkType, ExperienceLevel } from '../../src/shared/types/job.js';

vi.mock('../../src/modules/preferences/preference.service.js', () => ({
  preferenceService: {
    createPreferences: vi.fn(),
    savePreferences: vi.fn(),
  },
}));

vi.mock('../../src/modules/subscriptions/subscription.service.js', () => ({
  subscriptionService: {
    subscribe: vi.fn(),
  },
}));

describe('registerPreferencesHandler', () => {
  type HandlerFn = (ctx: unknown) => Promise<void>;
  let textHandler: HandlerFn;
  const callbackHandlers: { [pattern: string]: HandlerFn } = {};

  beforeEach(() => {
    vi.clearAllMocks();

    const mockBot = {
      on: vi.fn((event: string, handler: HandlerFn) => {
        if (event === 'message:text') {
          textHandler = handler;
        }
      }),
      callbackQuery: vi.fn((pattern: string | RegExp, handler: HandlerFn) => {
        callbackHandlers[pattern.toString()] = handler;
      }),
    };

    registerPreferencesHandler(mockBot as unknown as Bot<BotContext>);
  });

  it('should process job-title input and transition to work-type step', async () => {
    const mockCtx = {
      session: {
        step: 'job-title',
        preferences: {} as Partial<UserPreferences>,
      },
      message: { text: 'Backend Developer' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await textHandler(mockCtx);

    expect(mockCtx.session.step).toBe('work-type');
    expect(mockCtx.session.preferences.jobTitle).toBe('Backend Developer');
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('What work setup do you prefer?'),
      expect.any(Object),
    );
  });

  it('should reject invalid job title in job-title step', async () => {
    const mockCtx = {
      session: {
        step: 'job-title',
        preferences: {} as Partial<UserPreferences>,
      },
      message: { text: 'A' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await textHandler(mockCtx);

    expect(mockCtx.session.step).toBe('job-title');
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Please enter a valid job title'),
    );
  });

  it('should process location and transition to skills step', async () => {
    const mockCtx = {
      session: {
        step: 'location',
        preferences: { jobTitle: 'Backend Developer' } as Partial<UserPreferences>,
      },
      message: { text: 'Gaza, Palestine' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await textHandler(mockCtx);

    expect(mockCtx.session.step).toBe('skills');
    expect(mockCtx.session.preferences.location).toBe('Gaza, Palestine');
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Location saved'));
  });

  it('should process skills and transition to confirmation step', async () => {
    const mockCtx = {
      session: {
        step: 'skills',
        preferences: {
          jobTitle: 'Backend Developer',
          workType: WorkType.REMOTE,
          experienceLevel: ExperienceLevel.MID,
          location: 'Remote',
        } as Partial<UserPreferences>,
      },
      message: { text: 'Node.js, TypeScript, Redis' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await textHandler(mockCtx);

    expect(mockCtx.session.step).toBe('confirmation');
    expect(mockCtx.session.preferences.skills).toEqual(['Node.js', 'TypeScript', 'Redis']);
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Review your DeployMe pipeline config'),
      expect.any(Object),
    );
  });

  it('should confirm preferences and subscribe user on preferences:confirm callback', async () => {
    const confirmHandler = callbackHandlers['preferences:confirm'];
    expect(confirmHandler).toBeDefined();

    const mockSavedPreferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.MID,
      location: 'Remote',
      skills: ['Node.js'],
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '18:00'],
    };

    vi.mocked(preferenceService.createPreferences).mockReturnValue(mockSavedPreferences);
    vi.mocked(preferenceService.savePreferences).mockResolvedValue(undefined);
    vi.mocked(subscriptionService.subscribe).mockResolvedValue(undefined);

    const mockCtx = {
      session: {
        step: 'confirmation',
        preferences: {
          jobTitle: 'Backend Developer',
          workType: WorkType.REMOTE,
          experienceLevel: ExperienceLevel.MID,
          location: 'Remote',
          skills: ['Node.js'],
        },
      },
      from: { id: 123456 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await confirmHandler(mockCtx);

    expect(preferenceService.createPreferences).toHaveBeenCalled();
    expect(preferenceService.savePreferences).toHaveBeenCalledWith(123456, mockSavedPreferences);
    expect(subscriptionService.subscribe).toHaveBeenCalledWith(123456);
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Config saved — your DeployMe pipeline is live!'),
    );
  });
});

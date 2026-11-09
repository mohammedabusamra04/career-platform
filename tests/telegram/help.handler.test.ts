import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerHelpHandler, HELP_MESSAGES } from '../../src/bot/handlers/help.handler.js';

describe('TASK-36.4: /help Arabic Command Directory & Usage Guide (#108)', () => {
  let commands: Record<string, (ctx: any) => Promise<void>>;
  let mockBot: any;

  beforeEach(() => {
    commands = {};

    mockBot = {
      command: vi.fn((cmd: string, handler: (ctx: any) => Promise<void>) => {
        commands[cmd] = handler;
      }),
    };

    registerHelpHandler(mockBot);
  });

  it('registers the /help command on the bot instance', () => {
    expect(mockBot.command).toHaveBeenCalledWith('help', expect.any(Function));
  });

  describe('Arabic Command Directory (Default)', () => {
    it('replies with complete Arabic guide and markdown formatting', async () => {
      const ctx = {
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['help'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        HELP_MESSAGES.ar,
        expect.objectContaining({
          parse_mode: 'Markdown',
        }),
      );
    });

    it('contains all required platform commands: /jobs, /settings, /pause, /resume, /stop, /help, /start', async () => {
      const ctx = {
        session: { language: 'ar' },
        reply: vi.fn(),
      };

      await commands['help'](ctx);

      const message = ctx.reply.mock.calls[0][0];
      expect(message).toContain('/jobs');
      expect(message).toContain('/settings');
      expect(message).toContain('/pause');
      expect(message).toContain('/resume');
      expect(message).toContain('/stop');
      expect(message).toContain('/help');
      expect(message).toContain('/start');
    });
  });

  describe('English Command Directory', () => {
    it('replies with complete English guide when language is "en"', async () => {
      const ctx = {
        session: { language: 'en' },
        reply: vi.fn(),
      };

      await commands['help'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        HELP_MESSAGES.en,
        expect.objectContaining({
          parse_mode: 'Markdown',
        }),
      );

      const message = ctx.reply.mock.calls[0][0];
      expect(message).toContain('/jobs');
      expect(message).toContain('/settings');
      expect(message).toContain('/pause');
      expect(message).toContain('/resume');
      expect(message).toContain('/stop');
      expect(message).toContain('/help');
      expect(message).toContain('/start');
    });
  });

  describe('Fallback behavior', () => {
    it('defaults to Arabic when session.language is undefined', async () => {
      const ctx = {
        session: {},
        reply: vi.fn(),
      };

      await commands['help'](ctx);

      expect(ctx.reply).toHaveBeenCalledWith(HELP_MESSAGES.ar, expect.anything());
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSubscriptionHandler } from '../../src/bot/handlers/subscription.handler.js';
import { subscriptionService } from '../../src/modules/subscriptions/subscription.service.js';

vi.mock('../../src/modules/subscriptions/subscription.service.js', () => ({
  subscriptionService: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isSubscribed: vi.fn(),
  },
}));

describe('SubscriptionHandler', () => {
  const commandHandlers = new Map<string, (ctx: TestContext) => Promise<void>>();

  const bot = {
    command: vi.fn((command: string, handler: (ctx: TestContext) => Promise<void>) => {
      commandHandlers.set(command, handler);
    }),
  };

  type TestContext = {
    from?: {
      id: number;
    };
    reply: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    commandHandlers.clear();

    registerSubscriptionHandler(bot as never);
  });

  it('should subscribe the user', async () => {
    const ctx: TestContext = {
      from: { id: 123 },
      session: { language: 'en' } as any,
      reply: vi.fn(),
    };

    const handler = commandHandlers.get('subscribe');

    expect(handler).toBeDefined();

    await handler!(ctx);

    expect(subscriptionService.subscribe).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(
      '✅ Subscribed — your DeployMe pipeline is now live!\n\n' +
        '📡 You will automatically receive job pings tailored to your stack.',
    );
  });

  it('should unsubscribe the user', async () => {
    const ctx: TestContext = {
      from: { id: 123 },
      session: { language: 'en' } as any,
      reply: vi.fn(),
    };

    const handler = commandHandlers.get('unsubscribe');

    expect(handler).toBeDefined();

    await handler!(ctx);

    expect(subscriptionService.unsubscribe).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(
      '🔕 Unsubscribed from DeployMe job pings.\n\n' +
        'Automated pipeline alerts are now off. Send /subscribe anytime to re-enable.',
    );
  });

  it('should show subscribed status', async () => {
    vi.mocked(subscriptionService.isSubscribed).mockResolvedValue(true);

    const ctx: TestContext = {
      from: { id: 123 },
      session: { language: 'en' } as any,
      reply: vi.fn(),
    };

    const handler = commandHandlers.get('subscription');

    expect(handler).toBeDefined();

    await handler!(ctx);

    expect(subscriptionService.isSubscribed).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(
      '📡 *Pipeline Status:* Live ✅\n\n' +
        'Your DeployMe radar is actively scanning roles for your stack.\n' +
        'Use /pause to take a break or /unsubscribe to turn off alerts.',
      { parse_mode: 'Markdown' },
    );
  });

  it('should show unsubscribed status', async () => {
    vi.mocked(subscriptionService.isSubscribed).mockResolvedValue(false);

    const ctx: TestContext = {
      from: { id: 123 },
      session: { language: 'en' } as any,
      reply: vi.fn(),
    };

    const handler = commandHandlers.get('subscription');

    expect(handler).toBeDefined();

    await handler!(ctx);

    expect(subscriptionService.isSubscribed).toHaveBeenCalledWith(123);
    expect(ctx.reply).toHaveBeenCalledWith(
      '🔕 *Pipeline Status:* Inactive\n\n' +
        'You are currently unsubscribed from job pings.\n' +
        'Send /subscribe to activate your radar and receive matching roles.',
      { parse_mode: 'Markdown' },
    );
  });

  it('should handle missing user id when subscribing', async () => {
    const ctx: TestContext = {
      session: { language: 'en' } as any,
      reply: vi.fn(),
    };

    const handler = commandHandlers.get('subscribe');

    expect(handler).toBeDefined();

    await handler!(ctx);

    expect(subscriptionService.subscribe).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('❌ Unable to identify your Telegram account.');
  });
});

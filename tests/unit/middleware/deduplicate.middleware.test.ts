import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotContext } from '../../../src/bot/context.js';
import { deduplicateMiddleware, clearDeduplicationCache } from '../../../src/bot/middleware/deduplicate.middleware.js';

describe('DeduplicateMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDeduplicationCache();
  });

  it('drops actual retry duplicates that have the exact same callbackQuery.id', async () => {
    const next1 = vi.fn().mockResolvedValue(undefined);
    const next2 = vi.fn().mockResolvedValue(undefined);

    const ctx1 = {
      chat: { id: 123456 },
      callbackQuery: {
        id: 'query-id-999',
        data: 'spec_toggle:BACKEND',
        message: { message_id: 888 },
      },
      update: { update_id: 1001 },
    } as unknown as BotContext;

    // First delivery (Telegram sends query)
    await deduplicateMiddleware(ctx1, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    // Telegram retries the exact same callback update with the same callbackQuery.id
    const ctxRetry = {
      chat: { id: 123456 },
      callbackQuery: {
        id: 'query-id-999',
        data: 'spec_toggle:BACKEND',
        message: { message_id: 888 },
      },
      update: { update_id: 1001 },
    } as unknown as BotContext;

    await deduplicateMiddleware(ctxRetry, next2);
    expect(next2).not.toHaveBeenCalled();
  });

  it('allows distinct user clicks on the same message and data within 10 seconds (e.g. select and deselect)', async () => {
    const nextClick1 = vi.fn().mockResolvedValue(undefined);
    const nextClick2 = vi.fn().mockResolvedValue(undefined);

    // User clicks button to toggle BACKEND (first click: unique callbackQuery.id)
    const firstClickCtx = {
      chat: { id: 123456 },
      callbackQuery: {
        id: 'query-id-click-1',
        data: 'spec_toggle:BACKEND',
        message: { message_id: 888 },
      },
      update: { update_id: 2001 },
    } as unknown as BotContext;

    await deduplicateMiddleware(firstClickCtx, nextClick1);
    expect(nextClick1).toHaveBeenCalledTimes(1);

    // User clicks the same button 1 second later to deselect/toggle (second click: new unique callbackQuery.id)
    const secondClickCtx = {
      chat: { id: 123456 },
      callbackQuery: {
        id: 'query-id-click-2',
        data: 'spec_toggle:BACKEND',
        message: { message_id: 888 },
      },
      update: { update_id: 2002 },
    } as unknown as BotContext;

    await deduplicateMiddleware(secondClickCtx, nextClick2);
    expect(nextClick2).toHaveBeenCalledTimes(1);
  });
});

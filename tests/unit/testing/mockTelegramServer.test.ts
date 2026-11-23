import { describe, it, expect, beforeEach } from 'vitest';
import ms from 'ms';
import { MockTelegramServer } from '../../../src/testing/mockTelegramServer.js';

describe('TASK-47.1: MockTelegramServer Unit Tests (#132)', () => {
  let server: MockTelegramServer;

  beforeEach(() => {
    server = new MockTelegramServer();
  });

  it('records sent messages and correctly calculates unique recipients and counts', async () => {
    await server.sendMessage('user_1', 'Hello User 1');
    await server.sendMessage('user_2', 'Hello User 2');
    await server.sendMessage('user_3', 'Hello User 3');

    const stats = server.getStats();
    expect(stats.totalSent).toBe(3);
    expect(stats.uniqueRecipients).toBe(3);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.droppedCount).toBe(0);

    const messages = server.getRecordedMessages();
    expect(messages).toHaveLength(3);
    expect(messages[0]!.chatId).toBe('user_1');
    expect(messages[0]!.text).toBe('Hello User 1');
  });

  it('accurately flags duplicate dispatches when sent to the same user more than once', async () => {
    await server.sendMessage('user_repeat', 'Message 1');
    await server.sendMessage('user_repeat', 'Message 2 - Duplicate');

    const stats = server.getStats();
    expect(stats.totalSent).toBe(2);
    expect(stats.uniqueRecipients).toBe(1);
    expect(stats.duplicateCount).toBe(1);
    expect(server.getRecipientCount('user_repeat')).toBe(2);
  });

  it('resets all counters and recorded messages cleanly', async () => {
    await server.sendMessage('user_1', 'Test');
    expect(server.getStats().totalSent).toBe(1);

    server.reset();
    const stats = server.getStats();
    expect(stats.totalSent).toBe(0);
    expect(stats.uniqueRecipients).toBe(0);
    expect(stats.duplicateCount).toBe(0);
    expect(server.getRecordedMessages()).toHaveLength(0);
  });

  it('simulates network drop chaos and respects ms string formatting', async () => {
    server.injectNetworkDrop('500ms');
    await expect(server.sendMessage('user_1', 'msg')).rejects.toThrow('ETIMEDOUT');
  });

  it('simulates 429 rate limit errors with retry-after header simulation', async () => {
    server.inject429s(1, 2);
    await expect(server.sendMessage('user_1', 'msg')).rejects.toThrow('Too Many Requests');
    // Next call succeeds once remaining 429 count is exhausted
    const res = await server.sendMessage('user_1', 'msg');
    expect(res.success).toBe(true);
  });

  it('simulates transient server errors (502 Bad Gateway)', async () => {
    server.injectServerError(1);
    await expect(server.sendMessage('user_1', 'msg')).rejects.toThrow('502 Bad Gateway');
    const res = await server.sendMessage('user_1', 'msg');
    expect(res.success).toBe(true);
  });
});

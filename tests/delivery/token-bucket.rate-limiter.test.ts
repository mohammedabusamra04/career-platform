import { describe, it, expect, vi, beforeEach } from 'vitest';
import ms from 'ms';
import { TokenBucketRateLimiter } from '../../src/modules/delivery/token-bucket.rate-limiter.js';

describe('TokenBucketRateLimiter (TASK-41.2 Rate Pacing)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with specified capacity and refill rate', () => {
    const limiter = new TokenBucketRateLimiter({ refillRatePerSecond: 25 });
    expect(limiter.getAvailableTokens()).toBe(25);
  });

  it('tryAcquire consumes available window capacity without waiting', () => {
    const limiter = new TokenBucketRateLimiter({ refillRatePerSecond: 25 });
    expect(limiter.tryAcquire(5)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(20);
    expect(limiter.tryAcquire(20)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);
  });

  it('refills capacity after 1000ms sliding window elapses', async () => {
    const limiter = new TokenBucketRateLimiter({ refillRatePerSecond: 5 });
    expect(limiter.tryAcquire(5)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);

    // Wait for the 1000ms window to clear
    await new Promise((resolve) => setTimeout(resolve, ms('1.05s')));

    expect(limiter.getAvailableTokens()).toBe(5);
    expect(limiter.tryAcquire(5)).toBe(true);
  });

  it('strictly bounds message dispatch rate to <= 25 msgs/second in a fast loop', async () => {
    const limiter = new TokenBucketRateLimiter({ refillRatePerSecond: 25 });
    const timestamps: number[] = [];

    const totalMessages = 35;
    for (let i = 0; i < totalMessages; i++) {
      await limiter.acquire(1);
      timestamps.push(Date.now());
    }

    // In any rolling 1000ms window, sends must never exceed 25
    for (let i = 0; i < timestamps.length; i++) {
      const windowStart = timestamps[i];
      const windowEnd = windowStart + ms('1s');
      const countInWindow = timestamps.filter((t) => t >= windowStart && t < windowEnd).length;
      expect(countInWindow).toBeLessThanOrEqual(25);
    }
  });
});

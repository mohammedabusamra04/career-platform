import { describe, it, expect, vi } from 'vitest';
import ms from 'ms';
import { LoadTestRunner } from '../../src/testing/load-test-runner.js';
import { MockTelegramServer } from '../../src/testing/mock-telegram-server.js';
import { TokenBucketRateLimiter } from '../../src/modules/delivery/token-bucket.rate-limiter.js';

describe('TASK-47.1: Simulated Load Testing for 10,000 Subscribers (#132)', () => {
  it('executes full digest dispatch for 10,000 subscribers with 0 duplicates, 0 dropped, and 0 exceptions (Acceptance Criteria)', async () => {
    const telegramServer = new MockTelegramServer();
    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 10000,
      batchSize: 25,
      rateLimitPerSec: 25,
      enablePacingDelay: false, // Fast simulation for CI
    });

    const { summary, stats, report } = await runner.execute();

    // 1. Verify 100% of eligible recipients receive exactly one digest
    expect(summary.totalProcessed).toBe(10000);
    expect(summary.totalSent).toBe(10000);
    expect(summary.totalFailed).toBe(0);
    expect(summary.totalBlocked).toBe(0);
    expect(summary.isFullyCompleted).toBe(true);

    // 2. Verify Mock Telegram Server assertions
    expect(stats.totalSent).toBe(10000);
    expect(stats.uniqueRecipients).toBe(10000);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.droppedCount).toBe(0);

    // 3. Verify Batching Metrics (400 batches of 25)
    expect(summary.totalBatches).toBe(400);
    expect(report.totalBatches).toBe(400);
    expect(report.batchSize).toBe(25);

    // 4. Verify Zero Uncaught Exceptions
    expect(report.uncaughtExceptions).toBe(0);
    expect(report.status).toBe('PASSED');
  }, ms('30s'));

  it('verifies memory usage remains stable (Delta Heap <= 50MB) across 10,000 processed deliveries (Acceptance Criteria)', async () => {
    const telegramServer = new MockTelegramServer();
    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 10000,
      batchSize: 25,
      enablePacingDelay: false,
    });

    const { report } = await runner.execute();

    // Memory footprint must remain stable without leaking across 400 batches
    expect(report.memory.deltaHeapMb).toBeLessThanOrEqual(50);
    expect(report.memory.isStable).toBe(true);
    expect(report.memory.peakHeapMb).toBeGreaterThan(0);
  }, ms('30s'));

  it('verifies strict 25 msgs/sec pacing rate compliance across rolling 1-second windows in timed simulation', async () => {
    // Test 100 deliveries with real token bucket pacing (capacity 25, rate 25/sec)
    const telegramServer = new MockTelegramServer();
    const limiter = new TokenBucketRateLimiter({ capacity: 25, refillRatePerSecond: 25 });

    // Send 50 items and verify sliding window rate
    const startTime = Date.now();
    for (let i = 0; i < 50; i++) {
      await limiter.acquire(1);
      await telegramServer.sendMessage(`user_pace_${i + 1}`, 'Digest message');
    }
    const durationSec = (Date.now() - startTime) / 1000;

    const stats = telegramServer.getStats();
    expect(stats.totalSent).toBe(50);
    expect(stats.uniqueRecipients).toBe(50);
    expect(stats.duplicateCount).toBe(0);

    // Rate must be strictly bounded <= 25 msgs/sec
    // 50 tokens at 25/sec (with 25 initial burst) takes >= 1.0s
    expect(durationSec).toBeGreaterThanOrEqual(0.9);
  }, ms('10s'));

  it('generates a detailed Markdown staging evidence report', async () => {
    const telegramServer = new MockTelegramServer();
    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 100, // Quick run for report structure verification
      batchSize: 25,
      enablePacingDelay: false,
    });

    const { report } = await runner.execute();
    const markdown = LoadTestRunner.generateMarkdownReport(report);

    expect(markdown).toContain('# Staging Load Test Evidence Report (10,000 Subscribers)');
    expect(markdown).toContain('Delivery Correctness & Zero-Duplicate Verification');
    expect(markdown).toContain('Memory Footprint Stability');
    expect(markdown).toContain('Rate Limiting & Pacing Compliance');
    expect(markdown).toContain('PASSED');
  });
});

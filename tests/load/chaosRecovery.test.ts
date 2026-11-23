import { describe, it, expect } from 'vitest';
import ms from 'ms';
import { LoadTestRunner, InMemoryDeliverySlotRepository } from '../../src/testing/loadTestRunner.js';
import { MockTelegramServer } from '../../src/testing/mockTelegramServer.js';
import { ChunkedCursorDispatcher } from '../../src/modules/delivery/chunkedCursor.dispatcher.js';
import { SubscriberLoadSeeder } from '../../src/testing/subscriberLoadSeeder.js';
import { TokenBucketRateLimiter } from '../../src/modules/delivery/tokenBucket.rateLimiter.js';
import type { IUserRepository } from '../../src/modules/users/user-repository.interface.js';

describe('TASK-47.2: Fault Injection & Chaos Recovery Scenarios (#133)', () => {
  it('simulates 10-second DB drop mid-run: verifies automated reconnect and resumed execution without lost batches or duplicates (Acceptance Criteria 1)', async () => {
    const telegramServer = new MockTelegramServer();

    // Set up runner with 1,000 subscribers, batch size 25 (40 batches)
    // Inject a 10-second DB connection drop at batch 2
    // We provide a fast simulated sleep function so the test doesn't block for 10 full seconds in CI
    let simulatedDowntimePassedMs = 0;
    const requiredOutageMs = ms('10s'); // 10,000ms

    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 1000,
      batchSize: 25,
      rateLimitPerSec: 25,
      enablePacingDelay: false,
      chaos: {
        dbDropDuration: requiredOutageMs,
        dbDropTriggerBatch: 2,
        dbRetryDelayMs: 20, // Fast retry cadence
        sleepFn: async (sleepDurationMs: number) => {
          simulatedDowntimePassedMs += sleepDurationMs;
          // Yield execution to allow retry loop progression
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      },
    });

    const { summary, stats, report } = await runner.execute();

    // 1. Delivery Correctness under 10s DB outage
    expect(summary.totalSent).toBe(1000);
    expect(summary.totalProcessed).toBe(1000);
    expect(summary.totalFailed).toBe(0);
    expect(summary.totalBlocked).toBe(0);
    expect(summary.isFullyCompleted).toBe(true);

    // 2. Telegram assertions - exactly 0 duplicates, 0 dropped
    expect(stats.totalSent).toBe(1000);
    expect(stats.uniqueRecipients).toBe(1000);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.droppedCount).toBe(0);

    // 3. Chaos report verification
    expect(report.status).toBe('PASSED');
    expect(report.chaos?.dbReconnectSuccess).toBe(true);
    expect(report.chaos?.zeroDuplicatesUnderChaos).toBe(true);
    expect(report.chaos?.zeroLostUnderChaos).toBe(true);
    expect(report.uncaughtExceptions).toBe(0);
  }, ms('30s'));

  it('injects 50 consecutive Telegram 429s: verifies dynamic backoff pauses and recovers cleanly without lost records (Acceptance Criteria 2)', async () => {
    const telegramServer = new MockTelegramServer();

    // Inject 50 consecutive 429 errors from Telegram server with retry-after header
    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 200,
      batchSize: 25,
      rateLimitPerSec: 25,
      enablePacingDelay: false,
      chaos: {
        telegram429FloodCount: 50,
        telegram429RetryAfterSec: 0.01, // Fast sub-second retry-after simulation
        sleepFn: async (_durationMs: number) => {
          // Fast sleep to avoid slowing down CI while verifying backoff execution
          await new Promise((resolve) => setTimeout(resolve, 2));
        },
      },
    });

    const { summary, stats, report } = await runner.execute();

    // 1. Verification of 429 handling & recovery
    expect(stats.rateLimitHits).toBe(50);
    expect(stats.totalSent).toBe(200);
    expect(stats.uniqueRecipients).toBe(200);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.droppedCount).toBe(0);

    // 2. Summary completion verification
    expect(summary.totalSent).toBe(200);
    expect(summary.totalFailed).toBe(0);
    expect(summary.isFullyCompleted).toBe(true);

    // 3. Zero unhandled errors
    expect(report.status).toBe('PASSED');
    expect(report.uncaughtExceptions).toBe(0);
    expect(report.chaos?.consecutive429sHandled).toBe(50);
    expect(report.chaos?.telegram429FloodRecovered).toBe(true);
  }, ms('30s'));

  it('compound chaos scenario: simultaneous network drop and 429 flood with memory delta <= 50MB', async () => {
    const telegramServer = new MockTelegramServer();

    const runner = new LoadTestRunner(telegramServer, {
      subscribersCount: 500,
      batchSize: 25,
      rateLimitPerSec: 25,
      enablePacingDelay: false,
      chaos: {
        dbDropDuration: ms('1s'),
        dbDropTriggerBatch: 3,
        telegram429FloodCount: 25,
        telegram429RetryAfterSec: 0.01,
        dbRetryDelayMs: 10,
        sleepFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
        },
      },
    });

    const { summary, stats, report } = await runner.execute();

    // Assert 100% delivered with 0 duplicates
    expect(summary.totalSent).toBe(500);
    expect(stats.totalSent).toBe(500);
    expect(stats.uniqueRecipients).toBe(500);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.droppedCount).toBe(0);

    // Assert memory remains strictly <= 50MB
    expect(report.memory.deltaHeapMb).toBeLessThanOrEqual(50);
    expect(report.memory.isStable).toBe(true);
    expect(report.status).toBe('PASSED');
  }, ms('30s'));

  it('crash recovery: safely resumes unfinished deliveries across container crash without duplicate messages', async () => {
    const { slot, deliveries } = SubscriberLoadSeeder.generateDeliverySlotWithRecipients(
      'digest:2026-11-20:chaos-resume',
      100,
    );

    // Mark the first 30 deliveries as already 'SENT' (simulating crash after batch 1 & partial batch 2)
    for (let i = 0; i < 30; i++) {
      deliveries[i]!.status = 'SENT';
      deliveries[i]!.deliveredAt = new Date();
    }
    slot.sentCount = 30;

    const memorySlotRepo = new InMemoryDeliverySlotRepository(slot, deliveries);
    const mockUserRepo: IUserRepository = {
      updateStatusById: async () => ({} as any),
    } as any;
    const telegramServer = new MockTelegramServer();

    const limiter = new TokenBucketRateLimiter({
      capacity: 25,
      refillRatePerSecond: 100000,
    });

    const dispatcher = new ChunkedCursorDispatcher({
      deliverySlotRepository: memorySlotRepo,
      userRepository: mockUserRepo,
      rateLimiter: limiter,
      sender: async (userId: string) => {
        await telegramServer.sendMessage(userId, 'Resumed digest');
        return { success: true };
      },
    });

    // Run recovery
    const summaries = await dispatcher.recoverUnfinishedSlots(
      { batchSize: 25 },
      undefined,
      [slot],
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.totalSent).toBe(70); // Only the remaining 70 sent
    expect(summaries[0]!.totalProcessed).toBe(70);
    expect(summaries[0]!.isFullyCompleted).toBe(true);

    const stats = telegramServer.getStats();
    expect(stats.totalSent).toBe(70);
    expect(stats.uniqueRecipients).toBe(70);
    expect(stats.duplicateCount).toBe(0); // ZERO duplicates sent to previously processed users
  }, ms('10s'));
});


import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChunkedCursorDispatcher,
  parseTelegramError,
  type DigestSendHandler,
} from '../../src/modules/delivery/chunked-cursor.dispatcher.js';
import { TokenBucketRateLimiter } from '../../src/modules/delivery/token-bucket.rate-limiter.js';
import { UserStatus } from '../../src/modules/users/user.types.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
  DigestDeliveryEntity,
} from '../../src/modules/notifications/repositories/delivery-slot.repository.interface.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';

describe('TASK-42.1: Telegram 429 Retry-After Handling & Blocked User Flagging (#120)', () => {
  let mockSlotRepo: {
    findSlotById: ReturnType<typeof vi.fn>;
    findSlotByKey: ReturnType<typeof vi.fn>;
    findUnfinishedSlots: ReturnType<typeof vi.fn>;
    getOrCreateSlot: ReturnType<typeof vi.fn>;
    initializeDeliveries: ReturnType<typeof vi.fn>;
    getPendingDeliveries: ReturnType<typeof vi.fn>;
    getPendingDeliveriesChunk: ReturnType<typeof vi.fn>;
    updateDeliveryStatus: ReturnType<typeof vi.fn>;
    updateBatchDeliveryStatus: ReturnType<typeof vi.fn>;
    completeSlot: ReturnType<typeof vi.fn>;
  };

  let mockUserRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByTelegramId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    updateStatusById: ReturnType<typeof vi.fn>;
    markAsDeleted: ReturnType<typeof vi.fn>;
    findActiveRecipients: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockSlotRepo = {
      findSlotById: vi.fn().mockResolvedValue({
        id: 'slot-421',
        slotKey: 'digest:2026-11-15:2100',
        scheduledTime: new Date(),
        status: 'PENDING',
        totalRecipients: 10,
        sentCount: 0,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: null,
      } as DeliverySlotEntity),
      findSlotByKey: vi.fn(),
      findUnfinishedSlots: vi.fn().mockResolvedValue([]),
      getOrCreateSlot: vi.fn(),
      initializeDeliveries: vi.fn(),
      getPendingDeliveries: vi.fn(),
      getPendingDeliveriesChunk: vi.fn().mockResolvedValue([]),
      updateDeliveryStatus: vi.fn(),
      updateBatchDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      completeSlot: vi.fn().mockResolvedValue({
        id: 'slot-421',
        status: 'SENT',
      } as DeliverySlotEntity),
    };

    mockUserRepo = {
      findById: vi.fn(),
      findByTelegramId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      updateStatusById: vi.fn().mockResolvedValue({}),
      markAsDeleted: vi.fn(),
      findActiveRecipients: vi.fn().mockResolvedValue([]),
    };
  });

  describe('parseTelegramError Utility', () => {
    it('accurately parses Telegram 429 rate limit with retry_after parameter', () => {
      const err = {
        error_code: 429,
        parameters: { retry_after: 5 },
        message: 'Too Many Requests: retry after 5',
      };
      const parsed = parseTelegramError(err);
      expect(parsed.isRateLimit).toBe(true);
      expect(parsed.retryAfterSeconds).toBe(5);
      expect(parsed.isBlocked).toBe(false);
      expect(parsed.errorCode).toBe(429);
    });

    it('extracts retry after duration from error message string regex fallback', () => {
      const err = new Error('Telegram API call failed: 429 Too Many Requests: retry after 3');
      const parsed = parseTelegramError(err);
      expect(parsed.isRateLimit).toBe(true);
      expect(parsed.retryAfterSeconds).toBe(3);
      expect(parsed.isBlocked).toBe(false);
    });

    it('accurately identifies Telegram 403 bot blocked error', () => {
      const err = {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
        message: 'Forbidden: bot was blocked by the user',
      };
      const parsed = parseTelegramError(err);
      expect(parsed.isBlocked).toBe(true);
      expect(parsed.isRateLimit).toBe(false);
      expect(parsed.errorCode).toBe(403);
    });
  });

  describe('HTTP 429 Dynamic Backoff & Retry Handling', () => {
    it('catches Telegram 429 error, pauses dispatch loop for retry_after duration, and retries successfully', async () => {
      const singleItem: DigestDeliveryEntity[] = [
        {
          id: 'delivery-429',
          slotId: 'slot-421',
          userId: 'user-rate-limited',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(singleItem)
        .mockResolvedValueOnce([]);

      let attempts = 0;
      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          // Throw Telegram 429 on first try with 1s retry_after
          throw {
            error_code: 429,
            parameters: { retry_after: 1 },
            message: 'Too Many Requests: retry after 1',
          };
        }
        return { success: true };
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const startTime = Date.now();
      const summary = await dispatcher.dispatchSlot('slot-421', { batchSize: 25 });
      const durationMs = Date.now() - startTime;

      // 1. Send handler was invoked twice: failed with 429 first, then retried
      expect(attempts).toBe(2);
      expect(sendHandler).toHaveBeenCalledTimes(2);

      // 2. Loop paused for at least ~1000ms due to retry_after: 1
      expect(durationMs).toBeGreaterThanOrEqual(950);

      // 3. Successfully marked as SENT in batch update
      expect(summary.totalSent).toBe(1);
      expect(summary.totalFailed).toBe(0);
      expect(mockSlotRepo.updateBatchDeliveryStatus).toHaveBeenCalledWith(
        'slot-421',
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-rate-limited', status: 'SENT' }),
        ]),
      );
    });

    it('pauses and retries when sender returns retryAfterSeconds directly in response', async () => {
      const singleItem: DigestDeliveryEntity[] = [
        {
          id: 'delivery-direct-429',
          slotId: 'slot-421',
          userId: 'user-direct-rate-limited',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(singleItem)
        .mockResolvedValueOnce([]);

      let calls = 0;
      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          return {
            success: false,
            retryAfterSeconds: 1,
            errorCode: 429,
            error: 'Too many requests',
          };
        }
        return { success: true };
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const summary = await dispatcher.dispatchSlot('slot-421');

      expect(calls).toBe(2);
      expect(summary.totalSent).toBe(1);
      expect(summary.totalFailed).toBe(0);
    });
  });

  describe('HTTP 403 Bot Blocked by User Flagging', () => {
    it('catches HTTP 403, marks user BLOCKED in PostgreSQL, and marks DigestDelivery BLOCKED while loop continues', async () => {
      const items: DigestDeliveryEntity[] = [
        {
          id: 'delivery-blocked-1',
          slotId: 'slot-421',
          userId: 'user-who-blocked-bot',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
        {
          id: 'delivery-ok-2',
          slotId: 'slot-421',
          userId: 'user-normal-active',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce([]);

      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async (userId: string) => {
        if (userId === 'user-who-blocked-bot') {
          throw {
            error_code: 403,
            message: 'Forbidden: bot was blocked by the user',
          };
        }
        return { success: true };
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const summary = await dispatcher.dispatchSlot('slot-421');

      // Acceptance Criteria 1: User updated to BLOCKED in PostgreSQL
      expect(mockUserRepo.updateStatusById).toHaveBeenCalledWith(
        'user-who-blocked-bot',
        UserStatus.BLOCKED,
      );

      // Acceptance Criteria 2: DigestDelivery updated to BLOCKED
      expect(mockSlotRepo.updateBatchDeliveryStatus).toHaveBeenCalledWith(
        'slot-421',
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-who-blocked-bot',
            status: 'BLOCKED',
          }),
          expect.objectContaining({
            userId: 'user-normal-active',
            status: 'SENT',
          }),
        ]),
      );

      // Acceptance Criteria 3: Loop continues smoothly without crashing
      expect(summary.totalProcessed).toBe(2);
      expect(summary.totalSent).toBe(1);
      expect(summary.totalBlocked).toBe(1);
      expect(summary.totalFailed).toBe(0);
    });
  });

  describe('Transient Errors & 3-Retry Bound', () => {
    it('retries transient failures up to 3 times before succeeding', async () => {
      const items: DigestDeliveryEntity[] = [
        {
          id: 'delivery-flaky',
          slotId: 'slot-421',
          userId: 'user-flaky',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce([]);

      let attempts = 0;
      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient connection reset');
        }
        return { success: true };
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const summary = await dispatcher.dispatchSlot('slot-421');

      expect(attempts).toBe(3);
      expect(summary.totalSent).toBe(1);
      expect(summary.totalFailed).toBe(0);
      expect(mockSlotRepo.updateBatchDeliveryStatus).toHaveBeenCalledWith(
        'slot-421',
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-flaky', status: 'SENT' }),
        ]),
      );
    });

    it('marks delivery as FAILED when retries exceed 3 attempts', async () => {
      const items: DigestDeliveryEntity[] = [
        {
          id: 'delivery-permanent-fail',
          slotId: 'slot-421',
          userId: 'user-broken',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce([]);

      let attempts = 0;
      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async () => {
        attempts++;
        throw new Error('Telegram server 500 internal error');
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const summary = await dispatcher.dispatchSlot('slot-421');

      // Acceptance Criteria: Retries exceed 3, marked as FAILED
      expect(attempts).toBe(3);
      expect(summary.totalSent).toBe(0);
      expect(summary.totalFailed).toBe(1);
      expect(mockSlotRepo.updateBatchDeliveryStatus).toHaveBeenCalledWith(
        'slot-421',
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-broken',
            status: 'FAILED',
            lastError: 'Telegram server 500 internal error',
          }),
        ]),
      );
    });
  });

  describe('Comprehensive Resiliency: Mixed Batch', () => {
    it('successfully processes mixed batch with normal, 429-paused, 403-blocked, and 3-retry failed users', async () => {
      const mixedItems: DigestDeliveryEntity[] = [
        { id: 'd-1', slotId: 'slot-421', userId: 'u-success', status: 'PENDING', lastError: null, deliveredAt: null, attempts: 0 },
        { id: 'd-2', slotId: 'slot-421', userId: 'u-429', status: 'PENDING', lastError: null, deliveredAt: null, attempts: 0 },
        { id: 'd-3', slotId: 'slot-421', userId: 'u-403', status: 'PENDING', lastError: null, deliveredAt: null, attempts: 0 },
        { id: 'd-4', slotId: 'slot-421', userId: 'u-fail', status: 'PENDING', lastError: null, deliveredAt: null, attempts: 0 },
      ];

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(mixedItems)
        .mockResolvedValueOnce([]);

      let u429Tries = 0;
      const sendHandler: DigestSendHandler = vi.fn().mockImplementation(async (userId: string) => {
        if (userId === 'u-success') {
          return { success: true };
        }
        if (userId === 'u-429') {
          u429Tries++;
          if (u429Tries === 1) {
            return { success: false, retryAfterSeconds: 1, errorCode: 429 };
          }
          return { success: true };
        }
        if (userId === 'u-403') {
          throw { error_code: 403, message: 'Forbidden: bot was blocked by the user' };
        }
        if (userId === 'u-fail') {
          throw new Error('Telegram gateway timeout');
        }
        return { success: true };
      });

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 1000 });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        rateLimiter: fastLimiter,
        sender: sendHandler,
      });

      const summary = await dispatcher.dispatchSlot('slot-421');

      expect(summary.totalProcessed).toBe(4);
      expect(summary.totalSent).toBe(2); // u-success and u-429
      expect(summary.totalBlocked).toBe(1); // u-403
      expect(summary.totalFailed).toBe(1); // u-fail

      expect(mockUserRepo.updateStatusById).toHaveBeenCalledWith('u-403', UserStatus.BLOCKED);
      expect(mockSlotRepo.updateBatchDeliveryStatus).toHaveBeenCalledWith(
        'slot-421',
        expect.arrayContaining([
          expect.objectContaining({ userId: 'u-success', status: 'SENT' }),
          expect.objectContaining({ userId: 'u-429', status: 'SENT' }),
          expect.objectContaining({ userId: 'u-403', status: 'BLOCKED' }),
          expect.objectContaining({ userId: 'u-fail', status: 'FAILED' }),
        ]),
      );
    });
  });
});


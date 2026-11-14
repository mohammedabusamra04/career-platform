import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChunkedCursorDispatcher,
} from '../../src/modules/delivery/chunked-cursor.dispatcher.js';
import { ScheduledDigestRunner } from '../../src/modules/delivery/scheduled-digest.runner.js';
import { TokenBucketRateLimiter } from '../../src/modules/delivery/token-bucket.rate-limiter.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
  DigestDeliveryEntity,
  DeliveryStatusUpdate,
} from '../../src/modules/notifications/repositories/delivery-slot.repository.interface.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import type { IAdvisoryLockService } from '../../src/shared/database/advisory-lock.service.js';

describe('TASK-41.3: Idempotent State Machine & Crash Recovery (#119)', () => {
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
    findActiveRecipients: ReturnType<typeof vi.fn>;
  };

  let mockAdvisoryLock: {
    withLock: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockSlotRepo = {
      findSlotById: vi.fn(),
      findSlotByKey: vi.fn(),
      findUnfinishedSlots: vi.fn(),
      getOrCreateSlot: vi.fn(),
      initializeDeliveries: vi.fn(),
      getPendingDeliveries: vi.fn(),
      getPendingDeliveriesChunk: vi.fn().mockResolvedValue([]),
      updateDeliveryStatus: vi.fn(),
      updateBatchDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      completeSlot: vi.fn().mockImplementation(async (id: string) => ({
        id,
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: new Date(),
        status: 'SENT',
        totalRecipients: 100,
        sentCount: 100,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      })),
    };

    mockUserRepo = {
      findActiveRecipients: vi.fn().mockResolvedValue([]),
    };

    mockAdvisoryLock = {
      withLock: vi.fn().mockImplementation(async (_lockId: number, fn: () => Promise<unknown>) => {
        const result = await fn();
        return { executed: true, result };
      }),
    };
  });

  describe('Crash Recovery & Resumption (Acceptance Criteria)', () => {
    it('aborts dispatch worker after 50 out of 100 users, restarts worker, and verifies 50 remaining users receive digests while first 50 receive 0 duplicates', async () => {
      // 100 total deliveries for slot
      const allDeliveries: DigestDeliveryEntity[] = Array.from({ length: 100 }, (_, i) => ({
        id: `delivery-${i + 1}`,
        slotId: 'slot-crash-100',
        userId: `user-${i + 1}`,
        status: 'PENDING',
        lastError: null,
        deliveredAt: null,
        attempts: 0,
      }));

      // In-memory state tracking to simulate real PostgreSQL table updates
      const sentUserIds = new Set<string>();
      const dispatchCounts: Record<string, number> = {};

      mockSlotRepo.updateBatchDeliveryStatus.mockImplementation(
        async (_slotId: string, updates: DeliveryStatusUpdate[]) => {
          for (const u of updates) {
            if (u.status === 'SENT') {
              sentUserIds.add(u.userId);
              const found = allDeliveries.find((d) => d.userId === u.userId);
              if (found) {
                found.status = 'SENT';
                found.deliveredAt = new Date();
              }
            }
          }
        },
      );

      mockSlotRepo.findSlotById.mockResolvedValue({
        id: 'slot-crash-100',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: new Date(),
        status: 'PENDING',
        totalRecipients: 100,
        sentCount: 0,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: null,
      } as DeliverySlotEntity);

      // Simulates DB query: WHERE slotId = ... AND status IN ('PENDING', 'FAILED')
      mockSlotRepo.getPendingDeliveriesChunk.mockImplementation(
        async (_slotId: string, limit: number = 25, cursorId?: string) => {
          const pending = allDeliveries.filter((d) => d.status === 'PENDING' || d.status === 'FAILED');
          if (!cursorId) {
            return pending.slice(0, limit);
          }
          const cursorIdx = pending.findIndex((d) => d.id === cursorId);
          if (cursorIdx === -1) {
            return pending.slice(0, limit);
          }
          return pending.slice(cursorIdx + 1, cursorIdx + 1 + limit);
        },
      );

      const fastLimiter = new TokenBucketRateLimiter({ capacity: 1000, refillRatePerSecond: 1000 });

      // Worker 1: Starts running, but aborts after processing 50 users (2 batches of 25)
      const worker1Dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        rateLimiter: fastLimiter,
        sender: async (userId: string) => {
          dispatchCounts[userId] = (dispatchCounts[userId] ?? 0) + 1;
          return { success: true };
        },
      });

      // Worker 1 processes 50 deliveries and simulated crash occurs (e.g. maxDeliveries: 50 / container killed)
      const worker1Summary = await worker1Dispatcher.dispatchSlot('slot-crash-100', {
        batchSize: 25,
        maxDeliveries: 50,
      });

      expect(worker1Summary.totalProcessed).toBe(50);
      expect(worker1Summary.totalSent).toBe(50);
      expect(worker1Summary.isFullyCompleted).toBe(false);
      expect(sentUserIds.size).toBe(50);
      expect(mockSlotRepo.completeSlot).not.toHaveBeenCalled();

      // Worker 2 (Container Restart): Starts up fresh and resumes unfinished slot
      mockSlotRepo.findUnfinishedSlots.mockResolvedValue([
        {
          id: 'slot-crash-100',
          slotKey: 'digest:2026-11-14:2100',
          scheduledTime: new Date(),
          status: 'PENDING',
          totalRecipients: 100,
          sentCount: 50,
          failedCount: 0,
          startedAt: new Date(),
          completedAt: null,
        } as DeliverySlotEntity,
      ]);

      const worker2Dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        rateLimiter: fastLimiter,
        sender: async (userId: string) => {
          dispatchCounts[userId] = (dispatchCounts[userId] ?? 0) + 1;
          return { success: true };
        },
      });

      const recoverySummaries = await worker2Dispatcher.recoverUnfinishedSlots({
        batchSize: 25,
      });

      expect(recoverySummaries).toHaveLength(1);
      const worker2Summary = recoverySummaries[0];

      // Verification of Acceptance Criteria:
      // 1. Worker 2 processed the 50 remaining users
      expect(worker2Summary.totalProcessed).toBe(50);
      expect(worker2Summary.totalSent).toBe(50);
      expect(worker2Summary.isFullyCompleted).toBe(true);

      // 2. All 100 users are now marked SENT
      expect(sentUserIds.size).toBe(100);

      // 3. Exactly 0 duplicates: Every single user from user-1 to user-100 received EXACTLY 1 message
      for (let i = 1; i <= 100; i++) {
        const uId = `user-${i}`;
        expect(dispatchCounts[uId]).toBe(1);
      }

      // 4. Delivery slot is finalized and marked completed
      expect(mockSlotRepo.completeSlot).toHaveBeenCalledWith('slot-crash-100');
    });

    it('skips slots that are already completed with completedAt or SENT status (Idempotency)', async () => {
      const completedSlot: DeliverySlotEntity = {
        id: 'slot-done',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: new Date(),
        status: 'SENT',
        totalRecipients: 50,
        sentCount: 50,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      };

      mockSlotRepo.findSlotById.mockResolvedValue(completedSlot);
      mockSlotRepo.findUnfinishedSlots.mockResolvedValue([]);

      const mockSender = vi.fn();
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        sender: mockSender,
      });

      // Resume on already completed slot returns immediately without sending
      const summary = await dispatcher.resumeUnfinishedSlot('slot-done');
      expect(summary.totalProcessed).toBe(0);
      expect(summary.isFullyCompleted).toBe(true);
      expect(mockSender).not.toHaveBeenCalled();

      // recoverUnfinishedSlots does nothing when no unfinished slots exist
      const recoveries = await dispatcher.recoverUnfinishedSlots();
      expect(recoveries).toHaveLength(0);
      expect(mockSender).not.toHaveBeenCalled();
    });

    it('retries deliveries marked FAILED on crash recovery alongside PENDING deliveries', async () => {
      // 2 deliveries: 1 FAILED from previous crash, 1 PENDING
      const deliveries: DigestDeliveryEntity[] = [
        {
          id: 'delivery-1',
          slotId: 'slot-with-failed',
          userId: 'user-retry',
          status: 'FAILED',
          lastError: 'Network timeout',
          deliveredAt: null,
          attempts: 1,
        },
        {
          id: 'delivery-2',
          slotId: 'slot-with-failed',
          userId: 'user-new',
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        },
      ];

      mockSlotRepo.findSlotById.mockResolvedValue({
        id: 'slot-with-failed',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: new Date(),
        status: 'PENDING',
        totalRecipients: 2,
        sentCount: 0,
        failedCount: 1,
        startedAt: new Date(),
        completedAt: null,
      } as DeliverySlotEntity);

      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce(deliveries)
        .mockResolvedValueOnce([]);

      const sentUsers: string[] = [];
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        rateLimiter: new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 100 }),
        sender: async (userId: string) => {
          sentUsers.push(userId);
          return { success: true };
        },
      });

      const summary = await dispatcher.resumeUnfinishedSlot('slot-with-failed');

      expect(summary.totalProcessed).toBe(2);
      expect(summary.totalSent).toBe(2);
      expect(sentUsers).toEqual(['user-retry', 'user-new']);
      expect(mockSlotRepo.completeSlot).toHaveBeenCalledWith('slot-with-failed');
    });

    it('ScheduledDigestRunner automatically executes crash recovery under advisory lock on startup', async () => {
      const unfinishedSlot: DeliverySlotEntity = {
        id: 'slot-auto-recover',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: new Date(),
        status: 'PENDING',
        totalRecipients: 10,
        sentCount: 0,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: null,
      };

      mockSlotRepo.findUnfinishedSlots.mockResolvedValue([unfinishedSlot]);
      mockSlotRepo.findSlotById.mockResolvedValue(unfinishedSlot);
      mockSlotRepo.getPendingDeliveriesChunk
        .mockResolvedValueOnce([
          {
            id: 'd-1',
            slotId: 'slot-auto-recover',
            userId: 'user-1',
            status: 'PENDING',
            lastError: null,
            deliveredAt: null,
            attempts: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      const mockSender = vi.fn().mockResolvedValue({ success: true });
      const dispatcher = new ChunkedCursorDispatcher({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        rateLimiter: new TokenBucketRateLimiter({ capacity: 100, refillRatePerSecond: 100 }),
        sender: mockSender,
      });

      const runner = new ScheduledDigestRunner({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        dispatcher,
      });

      const recovered = await runner.recoverUnfinishedSlots(mockSender);

      expect(recovered).toHaveLength(1);
      expect(recovered[0].totalSent).toBe(1);
      expect(mockAdvisoryLock.withLock).toHaveBeenCalled();
    });

    it('safely skips recovery if another worker holds the advisory lock', async () => {
      mockAdvisoryLock.withLock.mockResolvedValue({
        executed: false,
        reason: 'Lock already held by container worker 1',
      });

      const runner = new ScheduledDigestRunner({
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
      });

      const results = await runner.recoverUnfinishedSlots();
      expect(results).toEqual([]);
      expect(mockSlotRepo.findUnfinishedSlots).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import ms from 'ms';
import {
  MissedSlotWatchdogService,
  type WatchdogCheckResult,
} from '../../src/modules/delivery/missed-slot-watchdog.service.js';
import {
  ScheduledDigestRunner,
  type ScheduledSlotExecutionResult,
} from '../../src/modules/delivery/scheduled-digest.runner.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
} from '../../src/modules/notifications/repositories/delivery-slot.repository.interface.js';
import { PrismaDeliverySlotRepository } from '../../src/modules/notifications/repositories/prisma-delivery-slot.repository.js';
import type { PrismaClient } from '@prisma/client';
import type { IAdvisoryLockService } from '../../src/shared/database/advisory-lock.service.js';

describe('TASK-42.2: Missed Slot Detection & Watchdog Recovery (#121)', () => {
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
    markSlotSkippedExpired: ReturnType<typeof vi.fn>;
  };

  let mockScheduledRunner: {
    generateSlotKey: ReturnType<typeof vi.fn>;
    getNextScheduledTime: ReturnType<typeof vi.fn>;
    executeScheduledSlot: ReturnType<typeof vi.fn>;
    recoverUnfinishedSlots: ReturnType<typeof vi.fn>;
  };

  let mockAdvisoryLock: {
    withLock: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockSlotRepo = {
      findSlotById: vi.fn(),
      findSlotByKey: vi.fn().mockResolvedValue(null),
      findUnfinishedSlots: vi.fn().mockResolvedValue([]),
      getOrCreateSlot: vi.fn(),
      initializeDeliveries: vi.fn(),
      getPendingDeliveries: vi.fn(),
      getPendingDeliveriesChunk: vi.fn().mockResolvedValue([]),
      updateDeliveryStatus: vi.fn(),
      updateBatchDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      completeSlot: vi.fn(),
      markSlotSkippedExpired: vi.fn().mockImplementation(async (slotKey: string, scheduledTime: Date) => ({
        id: 'slot-expired-id',
        slotKey,
        scheduledTime,
        status: 'SKIPPED_EXPIRED',
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        startedAt: null,
        completedAt: new Date(),
      })),
    };

    mockScheduledRunner = {
      generateSlotKey: vi.fn().mockImplementation((dt: Date) => {
        const l = DateTime.fromJSDate(dt).setZone('Asia/Gaza');
        return `digest:${l.toFormat('yyyy-MM-dd:HHmm')}`;
      }),
      getNextScheduledTime: vi.fn(),
      executeScheduledSlot: vi.fn().mockResolvedValue({
        executed: true,
        slotKey: 'digest:2026-11-15:2100',
        slotId: 'slot-recovered-id',
        scheduledTime: new Date(),
        recipientCount: 50,
        status: 'SCHEDULED',
        slot: {
          id: 'slot-recovered-id',
          slotKey: 'digest:2026-11-15:2100',
          scheduledTime: new Date(),
          status: 'PENDING',
          totalRecipients: 50,
          sentCount: 0,
          failedCount: 0,
          startedAt: new Date(),
          completedAt: null,
        },
      } as ScheduledSlotExecutionResult),
      recoverUnfinishedSlots: vi.fn().mockResolvedValue([]),
    };

    mockAdvisoryLock = {
      withLock: vi.fn().mockImplementation(async (_lockId: number, fn: () => Promise<unknown>) => {
        const result = await fn();
        return { executed: true, result };
      }),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Watchdog Grace Period & Expiration (Acceptance Criteria)', () => {
    it('simulates server reboot 30 minutes after scheduled 21:00 slot and automatically triggers slot recovery (within 2h grace period)', async () => {
      // 21:30 in Asia/Gaza: exactly 30 minutes after the scheduled 21:00 slot
      const rebootTime = DateTime.fromISO('2026-11-15T21:30:00.000', { zone: 'Asia/Gaza' }).toJSDate();

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
        {
          timezone: 'Asia/Gaza',
          dispatchTime: '21:00',
          gracePeriodMs: ms('2h'),
        },
      );

      const result: WatchdogCheckResult = await watchdog.checkAndRecoverMissedSlots(rebootTime);

      // Verify Recovery Triggered
      expect(result.checked).toBe(true);
      expect(result.action).toBe('RECOVERED_EXECUTION');
      expect(result.slotKey).toBe('digest:2026-11-15:2100');
      expect(result.elapsedMs).toBe(ms('30m'));

      // Verify executeScheduledSlot was invoked with the 21:00 scheduled timestamp
      expect(mockScheduledRunner.executeScheduledSlot).toHaveBeenCalledTimes(1);
      const calledArg = mockScheduledRunner.executeScheduledSlot.mock.calls[0][0] as Date;
      const calledDt = DateTime.fromJSDate(calledArg).setZone('Asia/Gaza');
      expect(calledDt.hour).toBe(21);
      expect(calledDt.minute).toBe(0);

      // Verify not marked expired
      expect(mockSlotRepo.markSlotSkippedExpired).not.toHaveBeenCalled();
    });

    it('resumes unfinished slot if slot was initialized but not completed within 2h grace period', async () => {
      const rebootTime = DateTime.fromISO('2026-11-15T21:45:00.000', { zone: 'Asia/Gaza' }).toJSDate();

      const existingUnfinishedSlot: DeliverySlotEntity = {
        id: 'slot-uncompleted',
        slotKey: 'digest:2026-11-15:2100',
        scheduledTime: DateTime.fromISO('2026-11-15T21:00:00.000', { zone: 'Asia/Gaza' }).toJSDate(),
        status: 'PENDING',
        totalRecipients: 100,
        sentCount: 30,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: null,
      };

      mockSlotRepo.findSlotByKey.mockResolvedValue(existingUnfinishedSlot);

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
        {
          timezone: 'Asia/Gaza',
          dispatchTime: '21:00',
          gracePeriodMs: ms('2h'),
        },
      );

      const result = await watchdog.checkAndRecoverMissedSlots(rebootTime);

      expect(result.action).toBe('RESUMED_UNFINISHED');
      expect(mockScheduledRunner.recoverUnfinishedSlots).toHaveBeenCalledWith(
        undefined,
        [existingUnfinishedSlot],
      );
      expect(mockScheduledRunner.executeScheduledSlot).not.toHaveBeenCalled();
    });

    it('marks slot as SKIPPED_EXPIRED when reboot happens >2 hours late to avoid disturbing users at night', async () => {
      // 23:30 in Asia/Gaza: 2.5 hours after 21:00 (> 2h grace period)
      const lateTime = DateTime.fromISO('2026-11-15T23:30:00.000', { zone: 'Asia/Gaza' }).toJSDate();

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
        {
          timezone: 'Asia/Gaza',
          dispatchTime: '21:00',
          gracePeriodMs: ms('2h'),
        },
      );

      const result = await watchdog.checkAndRecoverMissedSlots(lateTime);

      // Verify marked as SKIPPED_EXPIRED
      expect(result.checked).toBe(true);
      expect(result.action).toBe('MARKED_SKIPPED_EXPIRED');
      expect(result.slotKey).toBe('digest:2026-11-15:2100');
      expect(result.elapsedMs).toBe(ms('2.5h'));

      expect(mockSlotRepo.markSlotSkippedExpired).toHaveBeenCalledWith(
        'digest:2026-11-15:2100',
        expect.any(Date),
      );
      expect(mockScheduledRunner.executeScheduledSlot).not.toHaveBeenCalled();
      expect(mockScheduledRunner.recoverUnfinishedSlots).not.toHaveBeenCalled();
    });

    it('skips check if slot was already successfully completed (ALREADY_COMPLETED)', async () => {
      const now = DateTime.fromISO('2026-11-15T21:15:00.000', { zone: 'Asia/Gaza' }).toJSDate();

      mockSlotRepo.findSlotByKey.mockResolvedValue({
        id: 'slot-done',
        slotKey: 'digest:2026-11-15:2100',
        scheduledTime: new Date(),
        status: 'SENT',
        totalRecipients: 50,
        sentCount: 50,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      } as DeliverySlotEntity);

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
        {
          timezone: 'Asia/Gaza',
          dispatchTime: '21:00',
        },
      );

      const result = await watchdog.checkAndRecoverMissedSlots(now);

      expect(result.action).toBe('ALREADY_COMPLETED');
      expect(mockScheduledRunner.executeScheduledSlot).not.toHaveBeenCalled();
      expect(mockSlotRepo.markSlotSkippedExpired).not.toHaveBeenCalled();
    });

    it('skips check when another worker holds the PostgreSQL advisory lock', async () => {
      mockAdvisoryLock.withLock.mockResolvedValue({
        executed: false,
        reason: 'Lock held by container worker B',
      });

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
      );

      const result = await watchdog.checkAndRecoverMissedSlots();

      expect(result.checked).toBe(false);
      expect(result.action).toBe('LOCKED_BY_ANOTHER_WORKER');
      expect(mockSlotRepo.findSlotByKey).not.toHaveBeenCalled();
    });
  });

  describe('Watchdog Lifecycle (start / stop)', () => {
    it('initializes periodic 15-minute timer and stops cleanly', () => {
      vi.useFakeTimers();

      const watchdog = new MissedSlotWatchdogService(
        {
          deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
          scheduledRunner: mockScheduledRunner as unknown as ScheduledDigestRunner,
          advisoryLockService: mockAdvisoryLock as unknown as IAdvisoryLockService,
        },
        {
          checkIntervalMs: ms('15m'),
        },
      );

      expect(watchdog.getStatus().isRunning).toBe(false);
      expect(watchdog.getStatus().checkIntervalMs).toBe(ms('15m'));

      watchdog.start();
      expect(watchdog.getStatus().isRunning).toBe(true);

      watchdog.stop();
      expect(watchdog.getStatus().isRunning).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Boundary and Concurrency Edge Cases', () => {
    it('calculates the latest scheduled slot correctly across dispatch-time and day boundaries', () => {
      const watchdog = new MissedSlotWatchdogService(undefined, {
        timezone: 'Asia/Gaza',
        dispatchTime: '21:00',
      });

      // 1. Before 21:00 (e.g., 20:30 on Nov 15) -> latest scheduled slot was yesterday (Nov 14 at 21:00)
      const beforeDispatch = DateTime.fromISO('2026-11-15T20:30:00.000', { zone: 'Asia/Gaza' }).toJSDate();
      const slotBefore = watchdog.getLatestScheduledSlotTime(beforeDispatch);
      const dtBefore = DateTime.fromJSDate(slotBefore).setZone('Asia/Gaza');
      expect(dtBefore.day).toBe(14);
      expect(dtBefore.hour).toBe(21);
      expect(dtBefore.minute).toBe(0);

      // 2. After 21:00 (e.g., 21:15 on Nov 15) -> latest scheduled slot was today (Nov 15 at 21:00)
      const afterDispatch = DateTime.fromISO('2026-11-15T21:15:00.000', { zone: 'Asia/Gaza' }).toJSDate();
      const slotAfter = watchdog.getLatestScheduledSlotTime(afterDispatch);
      const dtAfter = DateTime.fromJSDate(slotAfter).setZone('Asia/Gaza');
      expect(dtAfter.day).toBe(15);
      expect(dtAfter.hour).toBe(21);
      expect(dtAfter.minute).toBe(0);
    });

    it('avoids overwriting a slot that is already completed when marking expiration', async () => {
      const mockDb = {
        deliverySlot: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'slot-already-sent',
            slotKey: 'digest:2026-11-15:2100',
            scheduledTime: new Date(),
            status: 'SENT',
            completedAt: new Date(),
            totalRecipients: 50,
            sentCount: 50,
            failedCount: 0,
            startedAt: new Date(),
          }),
          updateMany: vi.fn(),
          create: vi.fn(),
        },
      };

      const repo = new PrismaDeliverySlotRepository(mockDb as unknown as PrismaClient);
      const result = await repo.markSlotSkippedExpired(
        'digest:2026-11-15:2100',
        new Date(),
      );

      // Verify that updateMany was NOT called because slot is already completed (SENT)
      expect(mockDb.deliverySlot.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe('SENT');
    });
  });
});


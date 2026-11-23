import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  ScheduledDigestRunner,
  type ScheduledDigestRunnerDependencies,
} from '../../src/modules/delivery/scheduledDigest.runner.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
} from '../../src/modules/notifications/repositories/deliverySlot.repository.interface.js';
import type { IUserRepository } from '../../src/modules/users/repositories/user.repository.interface.js';
import type { IAdvisoryLockService } from '../../src/shared/database/advisoryLock.service.js';

describe('TASK-41.1: Timezone-Aware Scheduled Cron Trigger (Single Evening Slot 21:00 Asia/Gaza) (#117)', () => {
  let mockSlotRepo: {
    getOrCreateSlot: ReturnType<typeof vi.fn>;
    findSlotByKey: ReturnType<typeof vi.fn>;
    findSlotById: ReturnType<typeof vi.fn>;
    findUnfinishedSlots: ReturnType<typeof vi.fn>;
    initializeDeliveries: ReturnType<typeof vi.fn>;
    getPendingDeliveries: ReturnType<typeof vi.fn>;
    getPendingDeliveriesChunk: ReturnType<typeof vi.fn>;
    updateDeliveryStatus: ReturnType<typeof vi.fn>;
    updateBatchDeliveryStatus: ReturnType<typeof vi.fn>;
    completeSlot: ReturnType<typeof vi.fn>;
  };

  let mockUserRepo: {
    findActiveRecipients: ReturnType<typeof vi.fn>;
    findByTelegramId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    markAsDeleted: ReturnType<typeof vi.fn>;
  };

  let mockLockService: {
    tryAcquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    withLock: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockSlotRepo = {
      getOrCreateSlot: vi.fn(),
      findSlotByKey: vi.fn(),
      findSlotById: vi.fn(),
      findUnfinishedSlots: vi.fn().mockResolvedValue([]),
      initializeDeliveries: vi.fn(),
      getPendingDeliveries: vi.fn(),
      getPendingDeliveriesChunk: vi.fn().mockResolvedValue([]),
      updateDeliveryStatus: vi.fn(),
      updateBatchDeliveryStatus: vi.fn(),
      completeSlot: vi.fn(),
    };

    mockUserRepo = {
      findActiveRecipients: vi.fn().mockResolvedValue([
        { id: 'user-1', telegramId: 111 },
        { id: 'user-2', telegramId: 222 },
      ]),
      findByTelegramId: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      markAsDeleted: vi.fn(),
    };

    mockLockService = {
      tryAcquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      withLock: vi.fn(async (_lockId: number, action: () => Promise<unknown>) => {
        const result = await action();
        return { executed: true, result };
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createRunner = (
    deps?: Partial<ScheduledDigestRunnerDependencies>,
    config?: { timezone?: string; dispatchTime?: string; lockId?: number },
  ) => {
    return new ScheduledDigestRunner(
      {
        deliverySlotRepository: mockSlotRepo as unknown as IDeliverySlotRepository,
        userRepository: mockUserRepo as unknown as IUserRepository,
        advisoryLockService: mockLockService as unknown as IAdvisoryLockService,
        ...deps,
      },
      config,
    );
  };

  describe('Slot Key Generation (digest:YYYY-MM-DD:HHmm in Asia/Gaza)', () => {
    it('generates deterministic slot key in Asia/Gaza timezone format at 21:00', () => {
      const runner = createRunner();
      // 2026-11-14 19:00:00 UTC corresponds to 21:00:00 in Asia/Gaza (UTC+2 in winter)
      const dateUtc = new Date(Date.UTC(2026, 10, 14, 19, 0, 0));
      const slotKey = runner.generateSlotKey(dateUtc);

      expect(slotKey).toBe('digest:2026-11-14:2100');
    });

    it('handles summer daylight saving time (DST UTC+3) in Gaza seamlessly', () => {
      const runner = createRunner();
      // Mid-summer: 2026-07-15 18:00:00 UTC = 21:00:00 Asia/Gaza (UTC+3)
      const dateUtc = new Date(Date.UTC(2026, 6, 15, 18, 0, 0));
      const slotKey = runner.generateSlotKey(dateUtc);

      expect(slotKey).toBe('digest:2026-07-15:2100');
    });
  });

  describe('Single Evening Daily Run Scheduling (21:00 Asia/Gaza)', () => {
    it('calculates 21:00 today when current time is earlier in the day', () => {
      const runner = createRunner(undefined, {
        timezone: 'Asia/Gaza',
        dispatchTime: '21:00',
      });

      // 10:00 morning Gaza time
      const gazaMorning = DateTime.fromObject(
        { year: 2026, month: 11, day: 14, hour: 10, minute: 0 },
        { zone: 'Asia/Gaza' },
      ).toJSDate();

      const nextRun = runner.getNextScheduledTime(gazaMorning);
      const nextGaza = DateTime.fromJSDate(nextRun).setZone('Asia/Gaza');

      expect(nextGaza.hour).toBe(21);
      expect(nextGaza.minute).toBe(0);
      expect(nextGaza.day).toBe(14);
    });

    it('calculates 21:00 tomorrow when current time is after 21:00 Gaza', () => {
      const runner = createRunner(undefined, {
        timezone: 'Asia/Gaza',
        dispatchTime: '21:00',
      });

      // 21:30 night Gaza time
      const gazaLate = DateTime.fromObject(
        { year: 2026, month: 11, day: 14, hour: 21, minute: 30 },
        { zone: 'Asia/Gaza' },
      ).toJSDate();

      const nextRun = runner.getNextScheduledTime(gazaLate);
      const nextGaza = DateTime.fromJSDate(nextRun).setZone('Asia/Gaza');

      expect(nextGaza.hour).toBe(21);
      expect(nextGaza.minute).toBe(0);
      expect(nextGaza.day).toBe(15);
    });
  });

  describe('executeScheduledSlot (Advisory Lock & Idempotent Slot Creation)', () => {
    it('creates PENDING DeliverySlot with unique slot key and recipient count under advisory lock', async () => {
      const runner = createRunner();

      const scheduledDate = new Date(Date.UTC(2026, 10, 14, 19, 0, 0)); // 21:00 Gaza
      mockSlotRepo.findSlotByKey.mockResolvedValue(null); // No existing slot
      mockSlotRepo.getOrCreateSlot.mockResolvedValue({
        id: 'slot-uuid-1',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: scheduledDate,
        status: 'PENDING',
        totalRecipients: 2,
        sentCount: 0,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: null,
      } as DeliverySlotEntity);

      const result = await runner.executeScheduledSlot(scheduledDate);

      expect(mockLockService.withLock).toHaveBeenCalledWith(824402, expect.any(Function));
      expect(mockSlotRepo.findSlotByKey).toHaveBeenCalledWith('digest:2026-11-14:2100');
      expect(mockUserRepo.findActiveRecipients).toHaveBeenCalled();
      expect(mockSlotRepo.getOrCreateSlot).toHaveBeenCalledWith(
        scheduledDate,
        2,
        'digest:2026-11-14:2100',
      );

      expect(result.executed).toBe(true);
      expect(result.status).toBe('SCHEDULED');
      expect(result.slotKey).toBe('digest:2026-11-14:2100');
      expect(result.recipientCount).toBe(2);
    });

    it('skips execution if slot is already marked SENT or has completedAt', async () => {
      const runner = createRunner();
      const scheduledDate = new Date(Date.UTC(2026, 10, 14, 19, 0, 0));

      mockSlotRepo.findSlotByKey.mockResolvedValue({
        id: 'slot-uuid-done',
        slotKey: 'digest:2026-11-14:2100',
        scheduledTime: scheduledDate,
        status: 'SENT',
        totalRecipients: 10,
        sentCount: 10,
        failedCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      } as DeliverySlotEntity);

      const result = await runner.executeScheduledSlot(scheduledDate);

      expect(result.executed).toBe(false);
      expect(result.status).toBe('ALREADY_COMPLETED');
      expect(result.slotKey).toBe('digest:2026-11-14:2100');
      expect(mockSlotRepo.getOrCreateSlot).not.toHaveBeenCalled();
    });

    it('safely handles concurrent execution lockout when another worker holds advisory lock', async () => {
      mockLockService.withLock.mockResolvedValueOnce({
        executed: false,
        reason: 'Advisory lock 824402 is already held by another worker',
      });

      const runner = createRunner();
      const scheduledDate = new Date(Date.UTC(2026, 10, 14, 19, 0, 0));

      const result = await runner.executeScheduledSlot(scheduledDate);

      expect(result.executed).toBe(false);
      expect(result.status).toBe('LOCKED_BY_ANOTHER_WORKER');
      expect(result.reason).toContain('already held by another worker');
      expect(mockSlotRepo.findSlotByKey).not.toHaveBeenCalled();
    });
  });

  describe('Scheduler Lifecycle (start, stop, getStatus)', () => {
    it('initializes scheduler with single evening slot (21:00) and reports status', () => {
      const runner = createRunner(undefined, {
        timezone: 'Asia/Gaza',
        dispatchTime: '21:00',
      });

      expect(runner.getStatus().isRunning).toBe(false);

      runner.start();
      const status = runner.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.timezone).toBe('Asia/Gaza');
      expect(status.dispatchTime).toBe('21:00');
      expect(status.nextRunTime).toBeInstanceOf(Date);

      runner.stop();
      expect(runner.getStatus().isRunning).toBe(false);
      expect(runner.getStatus().nextRunTime).toBeNull();
    });
  });
});

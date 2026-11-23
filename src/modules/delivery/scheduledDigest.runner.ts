import { DateTime } from 'luxon';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
} from '../notifications/repositories/deliverySlot.repository.interface.js';
import { PrismaDeliverySlotRepository } from '../notifications/repositories/prismaDeliverySlot.repository.js';
import type { IUserRepository } from '../users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../users/repositories/prismaUser.repository.js';
import {
  type IAdvisoryLockService,
  AdvisoryLockService,
} from '../../shared/database/advisoryLock.service.js';
import {
  ChunkedCursorDispatcher,
  type SlotDispatchSummary,
  type DigestSendHandler,
} from './chunkedCursor.dispatcher.js';
import env from '../../config/env.js';
import logger from '../../shared/utils/logger.js';

export interface ScheduledDigestRunnerDependencies {
  deliverySlotRepository?: IDeliverySlotRepository;
  userRepository?: IUserRepository;
  advisoryLockService?: IAdvisoryLockService;
  dispatcher?: ChunkedCursorDispatcher;
  db?: PrismaClient;
}

export interface ScheduledDigestRunnerConfig {
  timezone?: string;
  dispatchTime?: string;
  lockId?: number;
}

export interface ScheduledSlotExecutionResult {
  executed: boolean;
  slotKey: string;
  slotId?: string;
  scheduledTime: Date;
  recipientCount: number;
  status: 'SCHEDULED' | 'ALREADY_COMPLETED' | 'LOCKED_BY_ANOTHER_WORKER' | 'FAILED';
  slot?: DeliverySlotEntity;
  reason?: string;
}

export interface ScheduledRunnerStatus {
  isRunning: boolean;
  timezone: string;
  dispatchTime: string;
  nextRunTime: Date | null;
  lastRunTime: Date | null;
  lastExecutedSlotKey: string | null;
}

export class ScheduledDigestRunner {
  private readonly deliverySlotRepo: IDeliverySlotRepository;
  private readonly userRepo: IUserRepository;
  private readonly advisoryLock: IAdvisoryLockService;
  private readonly dispatcher: ChunkedCursorDispatcher;
  private readonly timezone: string;
  private readonly dispatchTime: string;
  private readonly lockId: number;

  private timeoutId?: NodeJS.Timeout;
  private recoveryTimeoutId?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private nextRunDate: Date | null = null;
  private lastRunDate: Date | null = null;
  private lastExecutedSlotKey: string | null = null;

  constructor(
    deps?: ScheduledDigestRunnerDependencies,
    config?: ScheduledDigestRunnerConfig,
  ) {
    const db = deps?.db ?? defaultPrisma;
    this.deliverySlotRepo = deps?.deliverySlotRepository ?? new PrismaDeliverySlotRepository(db);
    this.userRepo = deps?.userRepository ?? new PrismaUserRepository(db);
    this.advisoryLock = deps?.advisoryLockService ?? new AdvisoryLockService(db);
    this.dispatcher = deps?.dispatcher ?? new ChunkedCursorDispatcher({
      deliverySlotRepository: this.deliverySlotRepo,
      userRepository: this.userRepo,
      db,
    });

    this.timezone = this.validateTimezone(config?.timezone ?? env.timezone);
    this.dispatchTime = config?.dispatchTime ?? env.dailyDigestTime;
    this.lockId = config?.lockId ?? env.digestDeliveryLockId;
  }

  /**
   * Generates a deterministic, unique slot key matching the format:
   * digest:YYYY-MM-DD:HHmm in the specified target timezone (Asia/Gaza).
   */
  public generateSlotKey(scheduledTime: Date, timezone?: string): string {
    const tz = timezone ? this.validateTimezone(timezone) : this.timezone;
    const dt = DateTime.fromJSDate(scheduledTime).setZone(tz);
    return `digest:${dt.toFormat('yyyy-MM-dd:HHmm')}`;
  }

  /**
   * Calculates the next scheduled single daily notification time in Asia/Gaza timezone
   * (strictly 21:00 evening leisure time), accounting cleanly for daylight saving time (DST).
   */
  public getNextScheduledTime(now: Date = new Date()): Date {
    const current = DateTime.fromJSDate(now).setZone(this.timezone);
    const [hour, minute] = this.dispatchTime.split(':').map(Number);
    const targetHour = Number.isNaN(hour) ? 21 : hour;
    const targetMinute = Number.isNaN(minute) ? 0 : minute;

    let target = current.startOf('day').set({
      hour: targetHour,
      minute: targetMinute,
      second: 0,
      millisecond: 0,
    });

    if (target <= current) {
      target = target.plus({ days: 1 });
    }

    return target.toJSDate();
  }

  /**
   * Executes or initializes a scheduled delivery slot:
   * 1. Acquires PostgreSQL advisory lock to prevent concurrent worker runs.
   * 2. Formats deterministic timezone slotKey: digest:YYYY-MM-DD:HHmm.
   * 3. Checks existing DeliverySlot record for idempotency.
   * 4. Queries active recipients and creates/persists DeliverySlot with PENDING status.
   */
  public async executeScheduledSlot(
    targetTime?: Date,
  ): Promise<ScheduledSlotExecutionResult> {
    const scheduledDate = targetTime ?? new Date();
    const slotKey = this.generateSlotKey(scheduledDate);

    const lockResult = await this.advisoryLock.withLock(this.lockId, async () => {
      // 1. Check existing slot record for idempotency
      const existing = await this.deliverySlotRepo.findSlotByKey(slotKey);
      if (existing && (existing.completedAt !== null || existing.status === 'SENT')) {
        logger.info(`[ScheduledDigestRunner] Slot ${slotKey} already completed. Skipping.`);
        return {
          executed: false,
          slotKey,
          slotId: existing.id,
          scheduledTime: existing.scheduledTime,
          recipientCount: existing.totalRecipients,
          status: 'ALREADY_COMPLETED' as const,
          slot: existing,
          reason: 'Slot was already fully executed and completed',
        };
      }

      // 2. Count active subscribers eligible for this slot
      const activeRecipients = await this.userRepo.findActiveRecipients();
      const recipientCount = activeRecipients.length;

      // 3. Atomically get or create slot record with unique constraint
      const slot = await this.deliverySlotRepo.getOrCreateSlot(
        scheduledDate,
        recipientCount,
        slotKey,
      );

      this.lastRunDate = new Date();
      this.lastExecutedSlotKey = slotKey;

      logger.info(
        `[ScheduledDigestRunner] Successfully initialized delivery slot ${slotKey} with ${recipientCount} active recipients (Status: ${slot.status})`,
      );

      return {
        executed: true,
        slotKey,
        slotId: slot.id,
        scheduledTime: slot.scheduledTime,
        recipientCount,
        status: 'SCHEDULED' as const,
        slot,
      };
    });

    if (!lockResult.executed || !lockResult.result) {
      logger.warn(
        `[ScheduledDigestRunner] Concurrent execution blocked by advisory lock ${this.lockId} for slot ${slotKey}`,
      );
      return {
        executed: false,
        slotKey,
        scheduledTime: scheduledDate,
        recipientCount: 0,
        status: 'LOCKED_BY_ANOTHER_WORKER',
        reason: lockResult.reason ?? 'Advisory lock held by another process',
      };
    }

    return lockResult.result;
  }

  /**
   * Starts the cron scheduler loop.
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info(
      `[ScheduledDigestRunner] Started (Timezone: ${this.timezone}, Single Evening Slot: ${this.dispatchTime})`,
    );

    this.scheduleNext();
    this.scheduleStartupRecovery();
  }

  /**
   * Recovers and resumes all unfinished delivery slots across container restarts:
   * Guarded by advisory lock to prevent concurrent recovery attempts.
   */
  public async recoverUnfinishedSlots(
    customSender?: DigestSendHandler,
    targetSlots?: DeliverySlotEntity[],
  ): Promise<SlotDispatchSummary[]> {
    const lockResult = await this.advisoryLock.withLock(this.lockId, async () => {
      return await this.dispatcher.recoverUnfinishedSlots(undefined, customSender, targetSlots);
    });

    if (!lockResult.executed || !lockResult.result) {
      logger.warn(
        `[ScheduledDigestRunner] Recovery skipped: Advisory lock ${this.lockId} held by another worker`,
      );
      return [];
    }

    return lockResult.result;
  }

  /**
   * Stops the cron scheduler loop.
   */
  public stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.recoveryTimeoutId) {
      clearTimeout(this.recoveryTimeoutId);
      this.recoveryTimeoutId = undefined;
    }
    this.isRunning = false;
    this.nextRunDate = null;
    logger.info('[ScheduledDigestRunner] Stopped scheduler');
  }

  public getStatus(): ScheduledRunnerStatus {
    return {
      isRunning: this.isRunning,
      timezone: this.timezone,
      dispatchTime: this.dispatchTime,
      nextRunTime: this.nextRunDate,
      lastRunTime: this.lastRunDate,
      lastExecutedSlotKey: this.lastExecutedSlotKey,
    };
  }

  private scheduleStartupRecovery(attempt: number = 1): void {
    if (!this.isRunning || attempt > 3) return;

    this.recoveryTimeoutId = setTimeout(() => {
      void (async () => {
        try {
          await this.recoverUnfinishedSlots();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[ScheduledDigestRunner] Error during crash recovery on startup: ${errMsg}`);
        }
      })();
    }, attempt === 1 ? 0 : 5000);
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;

    this.nextRunDate = this.getNextScheduledTime();
    const delayMs = Math.max(0, this.nextRunDate.getTime() - Date.now());

    logger.info(
      `[ScheduledDigestRunner] Next slot scheduled at ${this.nextRunDate.toISOString()} (in ${Math.round(delayMs / 60000)} minutes)`,
    );

    this.timeoutId = setTimeout(() => {
      void (async () => {
        try {
          if (this.nextRunDate) {
            await this.executeScheduledSlot(this.nextRunDate);
          }
        } catch (err) {
          logger.error(
            `[ScheduledDigestRunner] Uncaught error executing scheduled slot: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          this.scheduleNext();
        }
      })();
    }, delayMs);
  }

  private validateTimezone(tz: string): string {
    if (!tz || typeof tz !== 'string') {
      return 'Asia/Gaza';
    }
    const dt = DateTime.now().setZone(tz);
    return dt.isValid ? tz : 'Asia/Gaza';
  }
}

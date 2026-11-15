import { DateTime } from 'luxon';
import ms from 'ms';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
} from '../notifications/repositories/delivery-slot.repository.interface.js';
import { PrismaDeliverySlotRepository } from '../notifications/repositories/prisma-delivery-slot.repository.js';
import {
  type IAdvisoryLockService,
  AdvisoryLockService,
} from '../../shared/database/advisory-lock.service.js';
import {
  ScheduledDigestRunner,
  type ScheduledSlotExecutionResult,
} from './scheduled-digest.runner.js';
import type { SlotDispatchSummary } from './chunked-cursor.dispatcher.js';
import env from '../../config/env.js';
import logger from '../../shared/utils/logger.js';

export interface MissedSlotWatchdogDependencies {
  deliverySlotRepository?: IDeliverySlotRepository;
  scheduledRunner?: ScheduledDigestRunner;
  advisoryLockService?: IAdvisoryLockService;
  db?: PrismaClient;
}

export interface MissedSlotWatchdogConfig {
  timezone?: string;
  dispatchTime?: string;
  lockId?: number;
  checkIntervalMs?: number;
  gracePeriodMs?: number;
}

export type WatchdogAction =
  | 'ALREADY_COMPLETED'
  | 'RECOVERED_EXECUTION'
  | 'RESUMED_UNFINISHED'
  | 'MARKED_SKIPPED_EXPIRED'
  | 'LOCKED_BY_ANOTHER_WORKER';

export interface WatchdogCheckResult {
  checked: boolean;
  action: WatchdogAction;
  slotKey: string;
  scheduledTime: Date;
  elapsedMs: number;
  slot?: DeliverySlotEntity;
  executionResult?: ScheduledSlotExecutionResult;
  summaries?: SlotDispatchSummary[];
}

const DEFAULT_CHECK_INTERVAL_MS = ms('15m');
const DEFAULT_GRACE_PERIOD_MS = ms('2h');

/**
 * MissedSlotWatchdogService (TASK-42.2)
 *
 * Runs periodically every 15 minutes to inspect the latest scheduled evening slot:
 * - If current time is within 2 hours of a scheduled slot that was never initialized or unfinished,
 *   triggers automatic recovery execution.
 * - If the slot is >2 hours late, marks it as SKIPPED_EXPIRED to avoid disturbing users at night.
 * - Protects all executions with PostgreSQL advisory locking.
 */
export class MissedSlotWatchdogService {
  private readonly deliverySlotRepo: IDeliverySlotRepository;
  private readonly scheduledRunner: ScheduledDigestRunner;
  private readonly advisoryLock: IAdvisoryLockService;
  private readonly timezone: string;
  private readonly dispatchTime: string;
  private readonly lockId: number;
  private readonly checkIntervalMs: number;
  private readonly gracePeriodMs: number;

  private timerId?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(
    deps?: MissedSlotWatchdogDependencies,
    config?: MissedSlotWatchdogConfig,
  ) {
    const db = deps?.db ?? defaultPrisma;
    this.deliverySlotRepo = deps?.deliverySlotRepository ?? new PrismaDeliverySlotRepository(db);
    this.scheduledRunner = deps?.scheduledRunner ?? new ScheduledDigestRunner({ db });
    this.advisoryLock = deps?.advisoryLockService ?? new AdvisoryLockService(db);

    this.timezone = this.validateTimezone(config?.timezone ?? env.timezone);
    this.dispatchTime = config?.dispatchTime ?? env.dailyDigestTime;
    this.lockId = config?.lockId ?? env.digestDeliveryLockId;
    this.checkIntervalMs = config?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.gracePeriodMs = config?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  }

  /**
   * Calculates the latest scheduled evening slot time relative to a given timestamp.
   * If now is earlier in the day than dispatchTime (21:00), the latest scheduled slot was yesterday at 21:00.
   */
  public getLatestScheduledSlotTime(now: Date = new Date()): Date {
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

    if (current < target) {
      target = target.minus({ days: 1 });
    }

    return target.toJSDate();
  }

  /**
   * Executes a single inspection cycle for missed or delayed delivery slots.
   */
  public async checkAndRecoverMissedSlots(
    now: Date = new Date(),
  ): Promise<WatchdogCheckResult> {
    const lockResult = await this.advisoryLock.withLock(this.lockId, async () => {
      const scheduledTime = this.getLatestScheduledSlotTime(now);
      const slotKey = this.scheduledRunner.generateSlotKey(scheduledTime);
      const elapsedMs = Math.max(0, now.getTime() - scheduledTime.getTime());

      const slot = await this.deliverySlotRepo.findSlotByKey(slotKey);

      // Case 1: Slot was already completed successfully or expired
      if (slot && (slot.completedAt !== null || slot.status === 'SENT' || slot.status === 'SKIPPED_EXPIRED')) {
        return {
          checked: true,
          action: 'ALREADY_COMPLETED' as const,
          slotKey,
          scheduledTime,
          elapsedMs,
          slot,
        };
      }

      // Case 2: Slot is within the 2-hour grace period (<= 2h)
      if (elapsedMs <= this.gracePeriodMs) {
        logger.info(
          `[MissedSlotWatchdog] Missed slot ${slotKey} detected within 2h grace period (${ms(elapsedMs)} elapsed). Triggering recovery run...`,
        );

        if (!slot) {
          const runRes = await this.scheduledRunner.executeScheduledSlot(scheduledTime);
          return {
            checked: true,
            action: 'RECOVERED_EXECUTION' as const,
            slotKey,
            scheduledTime,
            elapsedMs,
            slot: runRes.slot,
            executionResult: runRes,
          };
        }

        // Restrict recovery specifically to this slotKey rather than resuming arbitrary historical slots
        const resumeRes = await this.scheduledRunner.recoverUnfinishedSlots(undefined, [slot]);
        return {
          checked: true,
          action: 'RESUMED_UNFINISHED' as const,
          slotKey,
          scheduledTime,
          elapsedMs,
          slot,
          summaries: resumeRes,
        };
      }

      // Case 3: Slot is >2 hours late. Mark as SKIPPED_EXPIRED to avoid disturbing users at night.
      logger.warn(
        `[MissedSlotWatchdog] Slot ${slotKey} is ${ms(elapsedMs)} late (>2h grace period). Marking as SKIPPED_EXPIRED.`,
      );

      const expiredSlot = await this.deliverySlotRepo.markSlotSkippedExpired(slotKey, scheduledTime);
      return {
        checked: true,
        action: 'MARKED_SKIPPED_EXPIRED' as const,
        slotKey,
        scheduledTime,
        elapsedMs,
        slot: expiredSlot,
      };
    });

    if (!lockResult.executed || !lockResult.result) {
      logger.info(
        `[MissedSlotWatchdog] Check skipped: Advisory lock ${this.lockId} held by another worker`,
      );
      return {
        checked: false,
        action: 'LOCKED_BY_ANOTHER_WORKER',
        slotKey: '',
        scheduledTime: now,
        elapsedMs: 0,
      };
    }

    return lockResult.result;
  }

  /**
   * Starts the periodic 15-minute watchdog timer.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(
      `[MissedSlotWatchdog] Started periodic watchdog (Interval: ${ms(this.checkIntervalMs)}, Grace Period: ${ms(this.gracePeriodMs)})`,
    );

    void (async () => {
      try {
        await this.checkAndRecoverMissedSlots();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[MissedSlotWatchdog] Error during initial check: ${errMsg}`);
      }
    })();

    this.timerId = setInterval(() => {
      void (async () => {
        try {
          await this.checkAndRecoverMissedSlots();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[MissedSlotWatchdog] Error during periodic check: ${errMsg}`);
        }
      })();
    }, this.checkIntervalMs);
  }

  /**
   * Stops the periodic watchdog timer.
   */
  public stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
    this.isRunning = false;
    logger.info('[MissedSlotWatchdog] Stopped periodic watchdog');
  }

  public getStatus(): { isRunning: boolean; timezone: string; checkIntervalMs: number; gracePeriodMs: number } {
    return {
      isRunning: this.isRunning,
      timezone: this.timezone,
      checkIntervalMs: this.checkIntervalMs,
      gracePeriodMs: this.gracePeriodMs,
    };
  }

  private validateTimezone(tz: string): string {
    if (!tz || typeof tz !== 'string') {
      return 'Asia/Gaza';
    }
    const dt = DateTime.now().setZone(tz);
    return dt.isValid ? tz : 'Asia/Gaza';
  }
}


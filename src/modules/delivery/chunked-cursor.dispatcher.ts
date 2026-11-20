import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';
import type {
  IDeliverySlotRepository,
  DeliveryStatusUpdate,
  DeliverySlotEntity,
} from '../notifications/repositories/delivery-slot.repository.interface.js';
import { PrismaDeliverySlotRepository } from '../notifications/repositories/prisma-delivery-slot.repository.js';
import { UserStatus } from '../users/user.types.js';
import type { IUserRepository } from '../users/repositories/user.repository.interface.js';
import { PrismaUserRepository } from '../users/repositories/prisma-user.repository.js';
import { TokenBucketRateLimiter } from './token-bucket.rate-limiter.js';
import logger from '../../shared/utils/logger.js';

export interface DigestDispatchResult {
  success: boolean;
  error?: string;
  isBlocked?: boolean;
  retryAfterSeconds?: number;
  errorCode?: number;
}

export interface ParsedTelegramError {
  isRateLimit: boolean;
  retryAfterSeconds?: number;
  isBlocked: boolean;
  errorCode?: number;
  message: string;
}

export function parseTelegramError(err: unknown): ParsedTelegramError {
  const errMsg = err instanceof Error ? err.message : String(err);
  let errorCode: number | undefined = undefined;
  let retryAfterSeconds: number | undefined = undefined;

  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.error_code === 'number') {
      errorCode = obj.error_code;
    }
    if (typeof obj.parameters === 'object' && obj.parameters !== null) {
      const params = obj.parameters as Record<string, unknown>;
      if (typeof params.retry_after === 'number') {
        retryAfterSeconds = params.retry_after;
      }
    }
  }

  if (!retryAfterSeconds) {
    const match = errMsg.match(/retry after (\d+)/i);
    if (match) {
      retryAfterSeconds = parseInt(match[1], 10);
    }
  }

  const isRateLimit =
    errorCode === 429 || errMsg.includes('429') || errMsg.toLowerCase().includes('too many requests');
  const isBlocked =
    errorCode === 403 ||
    errMsg.includes('403') ||
    errMsg.toLowerCase().includes('bot was blocked by the user') ||
    errMsg.toLowerCase().includes('forbidden');

  return {
    isRateLimit,
    retryAfterSeconds: retryAfterSeconds ?? (isRateLimit ? 1 : undefined),
    isBlocked,
    errorCode,
    message: errMsg,
  };
}

export type DigestSendHandler = (userId: string) => Promise<DigestDispatchResult>;

export interface ChunkedCursorDispatcherDependencies {
  deliverySlotRepository?: IDeliverySlotRepository;
  userRepository?: IUserRepository;
  rateLimiter?: TokenBucketRateLimiter;
  sender?: DigestSendHandler;
  db?: PrismaClient;
}

export interface DispatcherOptions {
  batchSize?: number;
  maxDeliveries?: number;
  maxRetriesPerDelivery?: number;
  dbMaxRetryAttempts?: number;
  dbRetryDelayMs?: number;
  sleepFn?: (msVal: number) => Promise<void>;
}

export interface SlotDispatchSummary {
  slotId: string;
  totalProcessed: number;
  totalSent: number;
  totalFailed: number;
  totalBlocked: number;
  totalBatches: number;
  durationMs: number;
  throughputMsgsPerSecond: number;
  isFullyCompleted: boolean;
}

export class ChunkedCursorDispatcher {
  private readonly deliverySlotRepo: IDeliverySlotRepository;
  private readonly userRepo: IUserRepository;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly sender?: DigestSendHandler;

  constructor(deps?: ChunkedCursorDispatcherDependencies) {
    const db = deps?.db ?? defaultPrisma;
    this.deliverySlotRepo = deps?.deliverySlotRepository ?? new PrismaDeliverySlotRepository(db);
    this.userRepo = deps?.userRepository ?? new PrismaUserRepository(db);
    this.rateLimiter = deps?.rateLimiter ?? new TokenBucketRateLimiter({ capacity: 25, refillRatePerSecond: 25 });
    this.sender = deps?.sender;
  }

  /**
   * Dispatches pending digest deliveries for a given slot in sequential cursor batches of 25,
   * strictly pacing sends at <= 25 msgs/second via the token bucket rate limiter.
   *
   * Complexity: O(U) time, O(1) space per batch (<50MB memory footprint).
   */
  public async dispatchSlot(
    slotId: string,
    options?: DispatcherOptions,
    customSender?: DigestSendHandler,
  ): Promise<SlotDispatchSummary> {
    const sendHandler = customSender ?? this.sender;
    if (!sendHandler) {
      throw new Error('No DigestSendHandler configured for ChunkedCursorDispatcher');
    }

    const slot = await this.executeWithDbRetry(
      () => this.deliverySlotRepo.findSlotById(slotId),
      'findSlotById',
      options,
    );
    if (!slot) {
      throw new Error(`DeliverySlot not found for id: ${slotId}`);
    }

    const batchSize = options?.batchSize ?? 25;
    const maxDeliveries = options?.maxDeliveries;
    const startTime = Date.now();

    let totalProcessed = 0;
    let totalSent = 0;
    let totalFailed = 0;
    let totalBlocked = 0;
    let totalBatches = 0;
    let cursorId: string | undefined = undefined;

    logger.info(
      `[ChunkedCursorDispatcher] Starting dispatch for slot ${slot.slotKey} (Batch Size: ${batchSize}, Max Rate: 25 msgs/sec)`,
    );

    let hasMoreBatches = true;
    while (hasMoreBatches) {
      const remainingAllowed = maxDeliveries ? Math.min(batchSize, maxDeliveries - totalProcessed) : batchSize;
      if (remainingAllowed <= 0) {
        hasMoreBatches = false;
      } else {
        // 1. Fetch sequential cursor batch of 25 pending deliveries
        const chunk = await this.executeWithDbRetry(
          () => this.deliverySlotRepo.getPendingDeliveriesChunk(slotId, remainingAllowed, cursorId),
          'getPendingDeliveriesChunk',
          options,
        );
        if (chunk.length === 0) {
          hasMoreBatches = false;
        } else {
          totalBatches++;
          const batchUpdates: DeliveryStatusUpdate[] = [];
          const itemsToProcess = maxDeliveries ? chunk.slice(0, maxDeliveries - totalProcessed) : chunk;
          const maxRetries = options?.maxRetriesPerDelivery ?? 3;

          // 2. Process deliveries paced by the TokenBucket rate limiter
          for (const item of itemsToProcess) {
            let deliveryAttempt = 0;
            let delivered = false;
            let isUserBlocked = false;
            let lastErrorMsg = 'Digest delivery failed';

            while (!delivered && deliveryAttempt < maxRetries) {
              deliveryAttempt++;
              await this.rateLimiter.acquire(1);

              try {
                const res = await sendHandler(item.userId);

                if (res.success) {
                  batchUpdates.push({
                    userId: item.userId,
                    status: 'SENT',
                  });
                  totalSent++;
                  delivered = true;
                } else if (res.isBlocked) {
                  isUserBlocked = true;
                  lastErrorMsg = res.error ?? 'Bot blocked by user';
                  break;
                } else if (res.retryAfterSeconds !== undefined || res.errorCode === 429) {
                  const waitSec = res.retryAfterSeconds ?? 1;
                  const waitMs = typeof waitSec === 'number' && waitSec < 1 ? Math.max(10, Math.round(waitSec * 1000)) : (ms as unknown as (v: string) => number)(`${waitSec}s`);
                  logger.warn(
                    `[ChunkedCursorDispatcher] Telegram 429 rate limit hit for user ${item.userId}. Pausing loop for ${waitSec}s`,
                  );
                  await this.sleep(waitMs, options?.sleepFn);
                  deliveryAttempt--;
                } else {
                  lastErrorMsg = res.error ?? 'Digest delivery failed';
                }
              } catch (err: unknown) {
                const parsed = parseTelegramError(err);

                if (parsed.isBlocked) {
                  isUserBlocked = true;
                  lastErrorMsg = parsed.message;
                  break;
                } else if (parsed.isRateLimit) {
                  const waitSec = parsed.retryAfterSeconds ?? 1;
                  const waitMs = typeof waitSec === 'number' && waitSec < 1 ? Math.max(10, Math.round(waitSec * 1000)) : (ms as unknown as (v: string) => number)(`${waitSec}s`);
                  logger.warn(
                    `[ChunkedCursorDispatcher] Telegram 429 rate limit error for user ${item.userId}. Pausing loop for ${waitSec}s`,
                  );
                  await this.sleep(waitMs, options?.sleepFn);
                  deliveryAttempt--;
                } else {
                  lastErrorMsg = parsed.message;
                }
              }
            }

            if (!delivered) {
              if (isUserBlocked) {
                batchUpdates.push({
                  userId: item.userId,
                  status: 'BLOCKED',
                  lastError: lastErrorMsg,
                });
                totalBlocked++;

                try {
                  await this.userRepo.updateStatusById(item.userId, UserStatus.BLOCKED);
                  logger.info(
                    `[ChunkedCursorDispatcher] Updated User ${item.userId} status to BLOCKED in database`,
                  );
                } catch (userErr: unknown) {
                  const errMsg = userErr instanceof Error ? userErr.message : String(userErr);
                  logger.warn(
                    `[ChunkedCursorDispatcher] Failed to update user ${item.userId} to BLOCKED: ${errMsg}`,
                  );
                }
              } else {
                batchUpdates.push({
                  userId: item.userId,
                  status: 'FAILED',
                  lastError: lastErrorMsg,
                });
                totalFailed++;
              }
            }

            totalProcessed++;
          }

          // 3. Atomically persist batch updates in PostgreSQL
          if (batchUpdates.length > 0) {
            await this.executeWithDbRetry(
              () => this.deliverySlotRepo.updateBatchDeliveryStatus(slotId, batchUpdates),
              'updateBatchDeliveryStatus',
              options,
            );
          }

          // 4. Advance cursor to last record in processed items
          const lastItem = itemsToProcess[itemsToProcess.length - 1];
          cursorId = lastItem.id;

          logger.info(
            `[ChunkedCursorDispatcher] Processed batch #${totalBatches} (${batchUpdates.length} items). Total sent: ${totalSent}, failed: ${totalFailed}`,
          );
        }
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const throughputMsgsPerSecond = Number(((totalProcessed / durationMs) * 1000).toFixed(2));

    // 5. Check if any pending deliveries remain, if not complete the slot
    const remainingCheck = await this.executeWithDbRetry(
      () => this.deliverySlotRepo.getPendingDeliveriesChunk(slotId, 1),
      'getPendingDeliveriesChunk:remainingCheck',
      options,
    );
    const isFullyCompleted = remainingCheck.length === 0;

    if (isFullyCompleted) {
      await this.executeWithDbRetry(
        () => this.deliverySlotRepo.completeSlot(slotId),
        'completeSlot',
        options,
      );
      logger.info(
        `[ChunkedCursorDispatcher] Successfully completed all deliveries for slot ${slot.slotKey}. Duration: ${ms(durationMs)}, Throughput: ${throughputMsgsPerSecond} msgs/sec`,
      );
    }

    return {
      slotId,
      totalProcessed,
      totalSent,
      totalFailed,
      totalBlocked,
      totalBatches,
      durationMs,
      throughputMsgsPerSecond,
      isFullyCompleted,
    };
  }

  /**
   * Resumes an interrupted or partially completed delivery slot:
   * 1. Checks if slot is already marked SENT or completed (idempotency guard).
   * 2. Automatically skips all recipients already marked 'SENT'.
   * 3. Dispatches remaining PENDING / FAILED recipients in cursor chunks.
   * 4. Completes the slot once all pending deliveries are delivered.
   */
  public async resumeUnfinishedSlot(
    slotId: string,
    options?: DispatcherOptions,
    customSender?: DigestSendHandler,
  ): Promise<SlotDispatchSummary> {
    const slot = await this.executeWithDbRetry(
      () => this.deliverySlotRepo.findSlotById(slotId),
      'findSlotById',
      options,
    );
    if (!slot) {
      throw new Error(`DeliverySlot not found for id: ${slotId}`);
    }

    if (slot.completedAt !== null || slot.status === 'SENT') {
      logger.info(
        `[ChunkedCursorDispatcher] Slot ${slot.slotKey} is already completed. Skipping resume.`,
      );
      return {
        slotId,
        totalProcessed: 0,
        totalSent: 0,
        totalFailed: 0,
        totalBlocked: 0,
        totalBatches: 0,
        durationMs: 0,
        throughputMsgsPerSecond: 0,
        isFullyCompleted: true,
      };
    }

    logger.info(
      `[ChunkedCursorDispatcher] Resuming unfinished slot ${slot.slotKey} (Progress: ${slot.sentCount} sent, ${slot.failedCount} failed of ${slot.totalRecipients})`,
    );

    return this.dispatchSlot(slotId, options, customSender);
  }

  /**
   * Crash Recovery: Queries and resumes all unfinished slots across container restarts:
   * - Queries slots where status IN ('PENDING', 'FAILED') and completedAt IS NULL.
   * - Sequentially dispatches remaining recipients for each slot without duplicate messages.
   */
  public async recoverUnfinishedSlots(
    options?: DispatcherOptions,
    customSender?: DigestSendHandler,
    targetSlots?: DeliverySlotEntity[],
  ): Promise<SlotDispatchSummary[]> {
    const unfinishedSlots =
      targetSlots ?? (await this.executeWithDbRetry(
        () => this.deliverySlotRepo.findUnfinishedSlots(),
        'findUnfinishedSlots',
        options,
      ));
    if (unfinishedSlots.length === 0) {
      logger.info('[ChunkedCursorDispatcher] No unfinished delivery slots to recover');
      return [];
    }

    logger.info(
      `[ChunkedCursorDispatcher] Found ${unfinishedSlots.length} unfinished delivery slot(s) to recover after restart`,
    );

    const summaries: SlotDispatchSummary[] = [];
    for (const slot of unfinishedSlots) {
      try {
        const summary = await this.resumeUnfinishedSlot(slot.id, options, customSender);
        summaries.push(summary);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          `[ChunkedCursorDispatcher] Error recovering slot ${slot.slotKey} (ID: ${slot.id}): ${errMsg}`,
        );
      }
    }

    return summaries;
  }

  /**
   * Resilient database retry wrapper providing automated backoff and reconnect probes
   * to survive transient network drops or mid-run database disconnections without batch loss.
   */
  private async executeWithDbRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options?: DispatcherOptions,
  ): Promise<T> {
    const maxAttempts = options?.dbMaxRetryAttempts ?? 3;
    const baseDelayMs = options?.dbRetryDelayMs ?? 50;
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (err: unknown) {
        attempt++;
        const errMsg = err instanceof Error ? err.message : String(err);
        const isDbConnectionIssue =
          errMsg.toLowerCase().includes('connect') ||
          errMsg.toLowerCase().includes('database') ||
          errMsg.toLowerCase().includes('timeout') ||
          errMsg.toLowerCase().includes('closed') ||
          errMsg.toLowerCase().includes('econnrefused') ||
          errMsg.toLowerCase().includes('etimedout') ||
          errMsg.toLowerCase().includes('terminat') ||
          errMsg.toLowerCase().includes('drop');

        if (!isDbConnectionIssue || attempt >= maxAttempts) {
          logger.error(
            `[ChunkedCursorDispatcher] Database operation '${operationName}' failed permanently after ${attempt} attempts: ${errMsg}`,
          );
          throw err;
        }

        const delay = Math.min(Math.round(baseDelayMs * Math.pow(1.15, attempt - 1)), 3000);
        logger.warn(
          `[ChunkedCursorDispatcher] Database connection issue during '${operationName}' (Attempt ${attempt}/${maxAttempts}). Retrying in ${ms(delay)}: ${errMsg}`,
        );

        if (typeof (this.deliverySlotRepo as any).reconnect === 'function') {
          try {
            await (this.deliverySlotRepo as any).reconnect();
          } catch (recErr: unknown) {
            const recErrMsg = recErr instanceof Error ? recErr.message : String(recErr);
            logger.warn(`[ChunkedCursorDispatcher] Database reconnect probe failed: ${recErrMsg}`);
          }
        }

        await this.sleep(delay, options?.sleepFn);
      }
    }
  }

  private sleep(sleepMs: number, customSleep?: (msVal: number) => Promise<void>): Promise<void> {
    if (customSleep) {
      return customSleep(sleepMs);
    }
    return new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

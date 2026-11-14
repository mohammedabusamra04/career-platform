import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { prisma as defaultPrisma } from '../../shared/database/prisma.service.js';
import type {
  IDeliverySlotRepository,
  DeliveryStatusUpdate,
} from '../notifications/repositories/delivery-slot.repository.interface.js';
import { PrismaDeliverySlotRepository } from '../notifications/repositories/prisma-delivery-slot.repository.js';
import { TokenBucketRateLimiter } from './token-bucket.rate-limiter.js';
import logger from '../../shared/utils/logger.js';

export interface DigestDispatchResult {
  success: boolean;
  error?: string;
  isBlocked?: boolean;
}

export type DigestSendHandler = (userId: string) => Promise<DigestDispatchResult>;

export interface ChunkedCursorDispatcherDependencies {
  deliverySlotRepository?: IDeliverySlotRepository;
  rateLimiter?: TokenBucketRateLimiter;
  sender?: DigestSendHandler;
  db?: PrismaClient;
}

export interface DispatcherOptions {
  batchSize?: number;
  maxDeliveries?: number;
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
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly sender?: DigestSendHandler;

  constructor(deps?: ChunkedCursorDispatcherDependencies) {
    const db = deps?.db ?? defaultPrisma;
    this.deliverySlotRepo = deps?.deliverySlotRepository ?? new PrismaDeliverySlotRepository(db);
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

    const slot = await this.deliverySlotRepo.findSlotById(slotId);
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
        const chunk = await this.deliverySlotRepo.getPendingDeliveriesChunk(slotId, remainingAllowed, cursorId);
        if (chunk.length === 0) {
          hasMoreBatches = false;
        } else {
          totalBatches++;
          const batchUpdates: DeliveryStatusUpdate[] = [];
          const itemsToProcess = maxDeliveries ? chunk.slice(0, maxDeliveries - totalProcessed) : chunk;

          // 2. Process deliveries paced by the TokenBucket rate limiter
          for (const item of itemsToProcess) {
            await this.rateLimiter.acquire(1);

            try {
              const res = await sendHandler(item.userId);

              if (res.success) {
                batchUpdates.push({
                  userId: item.userId,
                  status: 'SENT',
                });
                totalSent++;
              } else if (res.isBlocked) {
                batchUpdates.push({
                  userId: item.userId,
                  status: 'BLOCKED',
                  lastError: res.error ?? 'Bot blocked by user',
                });
                totalBlocked++;
              } else {
                batchUpdates.push({
                  userId: item.userId,
                  status: 'FAILED',
                  lastError: res.error ?? 'Digest delivery failed',
                });
                totalFailed++;
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              batchUpdates.push({
                userId: item.userId,
                status: 'FAILED',
                lastError: errMsg,
              });
              totalFailed++;
            }

            totalProcessed++;
          }

          // 3. Atomically persist batch updates in PostgreSQL
          if (batchUpdates.length > 0) {
            await this.deliverySlotRepo.updateBatchDeliveryStatus(slotId, batchUpdates);
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
    const remainingCheck = await this.deliverySlotRepo.getPendingDeliveriesChunk(slotId, 1);
    const isFullyCompleted = remainingCheck.length === 0;

    if (isFullyCompleted) {
      await this.deliverySlotRepo.completeSlot(slotId);
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
}

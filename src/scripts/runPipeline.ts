import { fileURLToPath } from 'node:url';
import { connectRedis } from '../config/redis.js';
import redisClient from '../config/redis.js';
import { jobPipelineService } from '../config/services.js';
import logger from '../shared/utils/logger.js';
import env from '../config/env.js';
import { NotificationScheduleService } from '../modules/notifications/notification.schedule.js';
import {
  advisoryLockService,
  JOB_PIPELINE_ADVISORY_LOCK_ID,
  type IAdvisoryLockService,
} from '../shared/database/advisoryLock.service.js';
import { prisma } from '../shared/database/prisma.service.js';

export const SLOT_KEY_PREFIX = 'pipeline:slot:';
export const SLOT_TTL_SECONDS = 36 * 60 * 60;
/** GitHub's cron can fire late; catch up on a missed slot for at most this long. */
export const MAX_CATCHUP_LAG_MINUTES = 5 * 60;

export async function exitCleanly(code: number = 0): Promise<never> {
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (err: unknown) {
    logger.warn(
      `Failed to close Redis during exitCleanly: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    if (typeof prisma.disconnect === 'function') {
      await prisma.disconnect();
    }
  } catch (err: unknown) {
    logger.warn(
      `Failed to disconnect Prisma during exitCleanly: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  process.exit(code);
}

export interface PipelineWorkerDeps {
  advisoryLock?: IAdvisoryLockService;
  pipelineService?: { run: (options?: { force?: boolean }) => Promise<unknown> };
  scheduleService?: NotificationScheduleService;
  forceRun?: boolean;
}

export interface PipelineWorkerExecutionOutcome {
  executed: boolean;
  reason?: string;
  result?: unknown;
}

/**
 * Executes a single pipeline worker cycle guarded by a distributed PostgreSQL advisory lock.
 * If another worker process holds the lock, cleanly exits without throwing.
 */
export async function executePipelineWorker(
  deps?: PipelineWorkerDeps,
): Promise<PipelineWorkerExecutionOutcome> {
  const lock = deps?.advisoryLock ?? advisoryLockService;
  const runner = deps?.pipelineService ?? jobPipelineService;
  const forceRun = deps?.forceRun ?? (process.env.FORCE_RUN === 'true');

  // 1. Guard against concurrent worker runs using PostgreSQL advisory locks
  const acquired = await lock.tryAcquire(JOB_PIPELINE_ADVISORY_LOCK_ID);
  if (!acquired && !forceRun) {
    logger.warn('Pipeline already running in another process');
    return {
      executed: false,
      reason: 'Pipeline already running in another process',
    };
  }

  try {
    logger.info('Daily job pipeline started');

    const scheduleService = deps?.scheduleService ?? new NotificationScheduleService();
    const slot = scheduleService.getLatestDueSlot(env.timezone, [
      env.dailyDigestTime,
    ]);

    await connectRedis();

    if (!redisClient.isOpen) {
      throw new Error('Redis is not connected. Check REDIS_URL secret.');
    }

    const slotKey = slot ? `${SLOT_KEY_PREFIX}${slot.key}` : null;
    let claimed = false;

    if (slot && slotKey) {
      if (forceRun) {
        await redisClient.set(slotKey, 'forced', { EX: SLOT_TTL_SECONDS });
        claimed = true;
      } else if (slot.lagMinutes > MAX_CATCHUP_LAG_MINUTES) {
        logger.info(
          `Latest slot ${slot.key} is ${slot.lagMinutes} min old (> ${MAX_CATCHUP_LAG_MINUTES}); skipping this trigger.`,
        );
        return {
          executed: false,
          reason: `Latest slot ${slot.key} is ${slot.lagMinutes} min old (> ${MAX_CATCHUP_LAG_MINUTES})`,
        };
      } else {
        const reply = await redisClient.set(slotKey, 'scheduled', {
          NX: true,
          EX: SLOT_TTL_SECONDS,
        });

        if (reply !== 'OK') {
          logger.info(`Slot ${slot.key} was already sent; skipping this trigger.`);
          return {
            executed: false,
            reason: `Slot ${slot.key} was already sent`,
          };
        }

        claimed = true;
        logger.info(`Running slot ${slot.key} (${slot.lagMinutes} min after its time).`);
      }
    }

    let result;

    try {
      result = await runner.run({ force: true });
    } catch (error: unknown) {
      // Release the slot so the next trigger can retry it.
      if (claimed && slotKey) {
        await redisClient.del(slotKey).catch((delErr: unknown) => {
          logger.warn(
            `Failed to release redis slot key ${slotKey}: ${
              delErr instanceof Error ? delErr.message : String(delErr)
            }`,
          );
        });
      }
      throw error;
    }

    logger.info(`Daily job pipeline finished: ${JSON.stringify(result)}`);

    if (result && typeof result === 'object' && 'subscribers' in result && result.subscribers === 0) {
      logger.warn('No subscribed users found in Redis. Nothing was sent.');
    }

    return {
      executed: true,
      result,
    };
  } finally {
    if (acquired) {
      await lock.release(JOB_PIPELINE_ADVISORY_LOCK_ID);
    }
  }
}

async function main(): Promise<void> {
  const outcome = await executePipelineWorker();
  if (!outcome.executed) {
    await exitCleanly(0);
  }
  await exitCleanly(0);
}

// Only run main() if invoked directly from CLI (e.g. node / tsx runPipeline.ts)
const isDirectCliExecution =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/').endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectCliExecution) {
  main().catch(async (error: unknown) => {
    logger.error(
      `Daily job pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    try {
      if (redisClient.isOpen) {
        await redisClient.quit();
      }
    } catch (quitError: unknown) {
      logger.warn(
        `Failed to close Redis connection during exit: ${
          quitError instanceof Error ? quitError.message : String(quitError)
        }`,
      );
    }

    try {
      if (typeof prisma.disconnect === 'function') {
        await prisma.disconnect();
      }
    } catch (prismaError: unknown) {
      logger.warn(
        `Failed to disconnect Prisma during exit: ${
          prismaError instanceof Error ? prismaError.message : String(prismaError)
        }`,
      );
    }

    process.exit(1);
  });
}

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma.service.js';
import env from '../../config/env.js';
import logger from '../utils/logger.js';

export const JOB_COLLECTION_ADVISORY_LOCK_ID = 824401;
export const DIGEST_DELIVERY_ADVISORY_LOCK_ID = env.digestDeliveryLockId;

export interface IAdvisoryLockService {
  tryAcquire(lockId: number): Promise<boolean>;
  release(lockId: number): Promise<boolean>;
  withLock<T>(
    lockId: number,
    action: () => Promise<T>,
  ): Promise<{ executed: boolean; result?: T; reason?: string }>;
}

export class AdvisoryLockService implements IAdvisoryLockService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async tryAcquire(lockId: number): Promise<boolean> {
    try {
      const rows =
        typeof this.db.$queryRaw === 'function'
          ? await this.db.$queryRaw<Array<Record<string, unknown>>>`
              SELECT pg_try_advisory_lock(${lockId}::bigint) AS acquired;
            `
          : await (this.db as unknown as { $queryRawUnsafe: (q: string) => Promise<Array<Record<string, unknown>>> }).$queryRawUnsafe(
              `SELECT pg_try_advisory_lock(${lockId}) AS acquired;`,
            );

      if (!rows || rows.length === 0) {
        return false;
      }

      const val = rows[0].acquired ?? rows[0].pg_try_advisory_lock;
      return Boolean(val);
    } catch (error) {
      logger.error(
        `Failed to acquire advisory lock ${lockId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  public async release(lockId: number): Promise<boolean> {
    try {
      const rows =
        typeof this.db.$queryRaw === 'function'
          ? await this.db.$queryRaw<Array<Record<string, unknown>>>`
              SELECT pg_advisory_unlock(${lockId}::bigint) AS released;
            `
          : await (this.db as unknown as { $queryRawUnsafe: (q: string) => Promise<Array<Record<string, unknown>>> }).$queryRawUnsafe(
              `SELECT pg_advisory_unlock(${lockId}) AS released;`,
            );

      if (!rows || rows.length === 0) {
        return false;
      }

      const val = rows[0].released ?? rows[0].pg_advisory_unlock;
      return Boolean(val);
    } catch (error) {
      logger.error(
        `Failed to release advisory lock ${lockId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  public async withLock<T>(
    lockId: number,
    action: () => Promise<T>,
  ): Promise<{ executed: boolean; result?: T; reason?: string }> {
    const acquired = await this.tryAcquire(lockId);
    if (!acquired) {
      return {
        executed: false,
        reason: `Advisory lock ${lockId} is already held by another worker`,
      };
    }

    try {
      const result = await action();
      return {
        executed: true,
        result,
      };
    } finally {
      await this.release(lockId);
    }
  }
}

export const advisoryLockService = new AdvisoryLockService();

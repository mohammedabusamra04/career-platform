import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  AdvisoryLockService,
  JOB_COLLECTION_ADVISORY_LOCK_ID,
} from '../../../src/shared/database/advisory-lock.service.js';

describe('AdvisoryLockService - PostgreSQL Advisory Locks (TASK-26.1)', () => {
  let mockPrisma: any;
  let service: AdvisoryLockService;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: vi.fn(),
    };
    service = new AdvisoryLockService(mockPrisma as unknown as PrismaClient);
  });

  describe('tryAcquire', () => {
    it('returns true when PostgreSQL pg_try_advisory_lock succeeds', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: true }]);

      const acquired = await service.tryAcquire(JOB_COLLECTION_ADVISORY_LOCK_ID);

      expect(acquired).toBe(true);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        `SELECT pg_try_advisory_lock(${JOB_COLLECTION_ADVISORY_LOCK_ID}) AS acquired;`,
      );
    });

    it('returns false when PostgreSQL pg_try_advisory_lock is already held', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: false }]);

      const acquired = await service.tryAcquire(JOB_COLLECTION_ADVISORY_LOCK_ID);

      expect(acquired).toBe(false);
    });

    it('returns false safely when query fails or throws', async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Connection lost'));

      const acquired = await service.tryAcquire(JOB_COLLECTION_ADVISORY_LOCK_ID);

      expect(acquired).toBe(false);
    });
  });

  describe('release', () => {
    it('returns true when pg_advisory_unlock succeeds', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ released: true }]);

      const released = await service.release(JOB_COLLECTION_ADVISORY_LOCK_ID);

      expect(released).toBe(true);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        `SELECT pg_advisory_unlock(${JOB_COLLECTION_ADVISORY_LOCK_ID}) AS released;`,
      );
    });

    it('handles query rejection safely during unlock', async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('DB error'));

      const released = await service.release(JOB_COLLECTION_ADVISORY_LOCK_ID);

      expect(released).toBe(false);
    });
  });

  describe('withLock', () => {
    it('executes action when lock is acquired and releases in finally', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ acquired: true }]) // tryAcquire
        .mockResolvedValueOnce([{ released: true }]); // release in finally

      const action = vi.fn().mockResolvedValue('success-result');

      const outcome = await service.withLock(JOB_COLLECTION_ADVISORY_LOCK_ID, action);

      expect(outcome.executed).toBe(true);
      expect(outcome.result).toBe('success-result');
      expect(action).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('skips execution when lock cannot be acquired', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: false }]);

      const action = vi.fn();

      const outcome = await service.withLock(JOB_COLLECTION_ADVISORY_LOCK_ID, action);

      expect(outcome.executed).toBe(false);
      expect(outcome.reason).toContain('already held');
      expect(action).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('unconditionally releases lock even if action throws error', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ released: true }]);

      const action = vi.fn().mockRejectedValue(new Error('Action crash'));

      await expect(service.withLock(JOB_COLLECTION_ADVISORY_LOCK_ID, action)).rejects.toThrow(
        'Action crash',
      );

      // Verify release was still called in finally block
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
        2,
        `SELECT pg_advisory_unlock(${JOB_COLLECTION_ADVISORY_LOCK_ID}) AS released;`,
      );
    });
  });
});

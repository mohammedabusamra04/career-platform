import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaUserRepository,
  UserStatus,
  InvalidStateTransitionError,
} from '../../../src/modules/users/index.js';

describe('PrismaUserRepository', () => {
  let mockPrisma: any;
  let repository: PrismaUserRepository;

  const mockDbUser = {
    id: 'user-uuid-1',
    telegramId: BigInt(123456789),
    firstName: 'Ahmed',
    username: 'ahmed_dev',
    status: 'ACTIVE',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    pausedUntil: null,
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    };
    repository = new PrismaUserRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findByTelegramId', () => {
    it('returns mapped User domain entity when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);

      const result = await repository.findByTelegramId(123456789);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { telegramId: BigInt(123456789) },
      });
      expect(result).not.toBeNull();
      expect(result?.telegramId).toBe(123456789);
      expect(result?.status).toBe(UserStatus.ACTIVE);
      expect(result?.firstName).toBe('Ahmed');
    });

    it('returns null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await repository.findByTelegramId(999999);

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns mapped User when found by id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);

      const result = await repository.findById('user-uuid-1');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
      });
      expect(result?.id).toBe('user-uuid-1');
    });
  });

  describe('create', () => {
    it('upserts user with bigInt conversion and default status', async () => {
      mockPrisma.user.upsert.mockResolvedValue(mockDbUser);

      const result = await repository.create({
        telegramId: 123456789,
        firstName: 'Ahmed',
        username: 'ahmed_dev',
      });

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
        where: { telegramId: BigInt(123456789) },
        update: {
          firstName: 'Ahmed',
          username: 'ahmed_dev',
          status: 'ACTIVE',
          pausedUntil: null,
        },
        create: {
          telegramId: BigInt(123456789),
          firstName: 'Ahmed',
          username: 'ahmed_dev',
          status: 'ACTIVE',
        },
      });
      expect(result.telegramId).toBe(123456789);
    });
  });

  describe('updateStatus', () => {
    it('updates status and pausedUntil successfully on valid transition', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      const pauseDate = new Date('2026-11-01T00:00:00Z');
      const updatedUser = {
        ...mockDbUser,
        status: 'PAUSED',
        pausedUntil: pauseDate,
      };
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await repository.updateStatus(123456789, UserStatus.PAUSED, pauseDate);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { telegramId: BigInt(123456789) },
        data: {
          status: 'PAUSED',
          pausedUntil: pauseDate,
        },
      });
      expect(result.status).toBe(UserStatus.PAUSED);
      expect(result.pausedUntil).toEqual(pauseDate);
    });

    it('clears pausedUntil if transitioned to ACTIVE', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        status: 'PAUSED',
        pausedUntil: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue({
        ...mockDbUser,
        status: 'ACTIVE',
        pausedUntil: null,
      });

      const result = await repository.updateStatus(123456789, UserStatus.ACTIVE);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { telegramId: BigInt(123456789) },
        data: {
          status: 'ACTIVE',
          pausedUntil: null,
        },
      });
      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(result.pausedUntil).toBeNull();
    });

    it('throws error when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        repository.updateStatus(999999, UserStatus.PAUSED),
      ).rejects.toThrow('User with telegramId 999999 does not exist.');
    });

    it('throws InvalidStateTransitionError on illegal transition (BLOCKED -> PAUSED)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        status: 'BLOCKED',
      });

      await expect(
        repository.updateStatus(123456789, UserStatus.PAUSED),
      ).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe('markAsDeleted', () => {
    it('anonymizes PII data (firstName and username to null) and sets status to DELETED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      const deletedUser = {
        ...mockDbUser,
        firstName: null,
        username: null,
        status: 'DELETED',
        pausedUntil: null,
      };
      mockPrisma.user.update.mockResolvedValue(deletedUser);

      const result = await repository.markAsDeleted(123456789);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { telegramId: BigInt(123456789) },
        data: {
          firstName: null,
          username: null,
          status: 'DELETED',
          pausedUntil: null,
        },
      });
      expect(result.firstName).toBeNull();
      expect(result.username).toBeNull();
      expect(result.status).toBe(UserStatus.DELETED);
    });

    it('throws error when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.markAsDeleted(999999)).rejects.toThrow(
        'User with telegramId 999999 does not exist.',
      );
    });
  });

  describe('findActiveRecipients', () => {
    it('queries for ACTIVE users or PAUSED users where pausedUntil is <= now', async () => {
      const now = new Date('2026-10-25T12:00:00Z');
      mockPrisma.user.findMany.mockResolvedValue([mockDbUser]);

      const result = await repository.findActiveRecipients(now);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: 'ACTIVE' },
            {
              status: 'PAUSED',
              pausedUntil: {
                lte: now,
              },
            },
          ],
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].telegramId).toBe(123456789);
    });
  });
});

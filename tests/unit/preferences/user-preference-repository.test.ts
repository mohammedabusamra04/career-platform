import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaUserPreferenceRepository,
  Specialization,
  RegionPreference,
  ExperienceLevelPreference,
  computePreferenceHash,
} from '../../../src/modules/preferences/index.js';

describe('PrismaUserPreferenceRepository (TASK-21.3)', () => {
  let mockPrisma: any;
  let repository: PrismaUserPreferenceRepository;

  const mockRecord = {
    id: 'pref-uuid-1',
    userId: 'user-uuid-1',
    specializations: ['BACKEND', 'FRONTEND'],
    regionPreference: 'BOTH',
    experienceLevel: 'SENIOR',
    workType: null,
    preferenceHash: computePreferenceHash({
      specializations: [Specialization.BACKEND, Specialization.FRONTEND],
      regionPreference: RegionPreference.BOTH,
      experienceLevel: ExperienceLevelPreference.SENIOR,
    }),
    updatedAt: new Date('2026-10-25T12:00:00Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      userPreference: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    repository = new PrismaUserPreferenceRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('savePreferences', () => {
    it('validates, computes deterministic hash, and upserts user preferences', async () => {
      mockPrisma.userPreference.upsert.mockResolvedValue(mockRecord);

      const result = await repository.savePreferences('user-uuid-1', {
        specializations: [Specialization.FRONTEND, Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: ExperienceLevelPreference.SENIOR,
      });

      expect(mockPrisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
        update: {
          specializations: ['FRONTEND', 'BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: 'SENIOR',
          workType: null,
          preferenceHash: mockRecord.preferenceHash,
        },
        create: {
          userId: 'user-uuid-1',
          specializations: ['FRONTEND', 'BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: 'SENIOR',
          workType: null,
          preferenceHash: mockRecord.preferenceHash,
        },
      });

      expect(result.preferenceHash).toBe(mockRecord.preferenceHash);
      expect(result.userId).toBe('user-uuid-1');
    });
  });

  describe('findByUserId', () => {
    it('returns mapped entity when preference exists', async () => {
      mockPrisma.userPreference.findUnique.mockResolvedValue(mockRecord);

      const result = await repository.findByUserId('user-uuid-1');

      expect(mockPrisma.userPreference.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
      expect(result?.id).toBe('pref-uuid-1');
    });

    it('returns null when preference not found', async () => {
      mockPrisma.userPreference.findUnique.mockResolvedValue(null);

      const result = await repository.findByUserId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByPreferenceHash', () => {
    it('returns array of preferences matching specific hash', async () => {
      mockPrisma.userPreference.findMany.mockResolvedValue([mockRecord]);

      const result = await repository.findByPreferenceHash(mockRecord.preferenceHash);

      expect(mockPrisma.userPreference.findMany).toHaveBeenCalledWith({
        where: { preferenceHash: mockRecord.preferenceHash },
      });
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-uuid-1');
    });
  });

  describe('findEquivalenceGroups', () => {
    it('partitions users into equivalence classes mapped by preferenceHash', async () => {
      const hashA = 'hash-aaa';
      const hashB = 'hash-bbb';

      mockPrisma.userPreference.findMany.mockResolvedValue([
        {
          id: 'p1',
          userId: 'u1',
          specializations: ['BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashA,
          user: { status: 'ACTIVE', pausedUntil: null },
        },
        {
          id: 'p2',
          userId: 'u2',
          specializations: ['BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashA,
          user: { status: 'ACTIVE', pausedUntil: null },
        },
        {
          id: 'p3',
          userId: 'u3',
          specializations: ['AI_ENGINEER'],
          regionPreference: 'ARAB',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashB,
          user: { status: 'ACTIVE', pausedUntil: null },
        },
      ]);

      const groups = await repository.findEquivalenceGroups();

      expect(groups.size).toBe(2);
      expect(groups.has(hashA)).toBe(true);
      expect(groups.has(hashB)).toBe(true);

      const groupA = groups.get(hashA)!;
      expect(groupA.userIds).toEqual(['u1', 'u2']);
      expect(groupA.specializations).toEqual(['BACKEND']);

      const groupB = groups.get(hashB)!;
      expect(groupB.userIds).toEqual(['u3']);
      expect(groupB.specializations).toEqual(['AI_ENGINEER']);
    });

    it('filters out ineligible users when eligibleOnly is true', async () => {
      const now = new Date('2026-10-25T12:00:00Z');
      const hashA = 'hash-aaa';

      mockPrisma.userPreference.findMany.mockResolvedValue([
        {
          id: 'p1',
          userId: 'u1',
          specializations: ['BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashA,
          user: { status: 'ACTIVE', pausedUntil: null },
        },
        {
          id: 'p2',
          userId: 'u2',
          specializations: ['BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashA,
          user: { status: 'BLOCKED', pausedUntil: null },
        },
        {
          id: 'p3',
          userId: 'u3',
          specializations: ['BACKEND'],
          regionPreference: 'BOTH',
          experienceLevel: null,
          workType: null,
          preferenceHash: hashA,
          user: {
            status: 'PAUSED',
            pausedUntil: new Date('2026-10-25T15:00:00Z'), // in future -> ineligible
          },
        },
      ]);

      const groups = await repository.findEquivalenceGroups({
        eligibleOnly: true,
        now,
      });

      expect(groups.size).toBe(1);
      const groupA = groups.get(hashA)!;
      expect(groupA.userIds).toEqual(['u1']); // u2 and u3 excluded
    });
  });

  describe('deleteByUserId', () => {
    it('deletes preferences by userId', async () => {
      mockPrisma.userPreference.deleteMany.mockResolvedValue({ count: 1 });

      await repository.deleteByUserId('user-uuid-1');

      expect(mockPrisma.userPreference.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });
  });
});

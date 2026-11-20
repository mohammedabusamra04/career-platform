import type { PrismaClient, UserPreference as PrismaUserPreferenceRecord } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../shared/database/prisma.service.js';
import type {
  IUserPreferenceRepository,
  UserPreferenceEntity,
  UserPreferenceGroup,
} from './user-preference.repository.interface.js';
import {
  Specialization,
  RegionPreference,
} from '../preference.taxonomy.js';
import {
  validateUserPreferences,
  type UserPreferenceInput,
} from '../preference.schema.js';
import { computePreferenceHash } from '../preference.hasher.js';
import { isUserEligibleForDigest } from '../../users/user.state-machine.js';

export class PrismaUserPreferenceRepository implements IUserPreferenceRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async savePreferences(
    userId: string,
    data: UserPreferenceInput,
  ): Promise<UserPreferenceEntity> {
    const validated = validateUserPreferences(data);
    const preferenceHash = computePreferenceHash(validated);

    const record = await this.db.userPreference.upsert({
      where: { userId },
      update: {
        specializations: validated.specializations as PrismaUserPreferenceRecord['specializations'],
        regionPreference: validated.regionPreference as PrismaUserPreferenceRecord['regionPreference'],
        experienceLevel: validated.experienceLevel ?? null,
        workType: validated.workType ?? null,
        preferenceHash,
      },
      create: {
        userId,
        specializations: validated.specializations as PrismaUserPreferenceRecord['specializations'],
        regionPreference: validated.regionPreference as PrismaUserPreferenceRecord['regionPreference'],
        experienceLevel: validated.experienceLevel ?? null,
        workType: validated.workType ?? null,
        preferenceHash,
      },
    });

    return this.mapToEntity(record);
  }

  public async findByUserId(userId: string): Promise<UserPreferenceEntity | null> {
    const record = await this.db.userPreference.findUnique({
      where: { userId },
    });

    return record ? this.mapToEntity(record) : null;
  }

  public async findByPreferenceHash(preferenceHash: string): Promise<UserPreferenceEntity[]> {
    const records = await this.db.userPreference.findMany({
      where: { preferenceHash },
    });

    return records.map((r) => this.mapToEntity(r));
  }

  public async findEquivalenceGroups(options?: {
    eligibleOnly?: boolean;
    now?: Date;
  }): Promise<Map<string, UserPreferenceGroup>> {
    const records = await this.db.userPreference.findMany({
      include: {
        user: true,
      },
    });

    const groups = new Map<string, UserPreferenceGroup>();
    const eligibleOnly = options?.eligibleOnly ?? false;
    const now = options?.now ?? new Date();

    for (const record of records) {
      if (eligibleOnly && record.user) {
        const isEligible = isUserEligibleForDigest(
          {
            status: record.user.status as any,
            pausedUntil: record.user.pausedUntil,
          },
          now,
        );

        if (!isEligible) {
          continue;
        }
      }

      const hash = record.preferenceHash;
      const existing = groups.get(hash);

      if (existing) {
        existing.userIds.push(record.userId);
      } else {
        groups.set(hash, {
          preferenceHash: hash,
          specializations: record.specializations as Specialization[],
          regionPreference: record.regionPreference as RegionPreference,
          experienceLevel: record.experienceLevel,
          workType: record.workType,
          userIds: [record.userId],
        });
      }
    }

    return groups;
  }

  public async deleteByUserId(userId: string): Promise<void> {
    await this.db.userPreference.deleteMany({
      where: { userId },
    });
  }

  private mapToEntity(row: PrismaUserPreferenceRecord): UserPreferenceEntity {
    return {
      id: row.id,
      userId: row.userId,
      specializations: row.specializations as Specialization[],
      regionPreference: row.regionPreference as RegionPreference,
      experienceLevel: row.experienceLevel,
      workType: row.workType,
      preferenceHash: row.preferenceHash,
      updatedAt: row.updatedAt,
    };
  }
}

export const userPreferenceRepository = new PrismaUserPreferenceRepository();

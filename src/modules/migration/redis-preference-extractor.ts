import ms from 'ms';
import type { PrismaClient } from '@prisma/client';
import type { RedisClientType } from 'redis';
import { TaxonomyMapper, type V1PreferenceInput, type TaxonomyMappingResult } from './taxonomy-mapper.js';
import { computePreferenceHash } from '../preferences/preference.hasher.js';
import { Specialization, RegionPreference } from '../preferences/preference.taxonomy.js';
import logger from '../../shared/utils/logger.js';

export interface V1RedisSubscriberData {
  userId: string | number;
  preferences: V1PreferenceInput;
  subscriptionStatus?: string;
}

export interface MigrationSubscriberRecord {
  telegramId: bigint;
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED';
  preferences: {
    specializations: Specialization[];
    regionPreference: RegionPreference;
    experienceLevel: string | null;
    workType: string | null;
    preferenceHash: string;
  };
  taxonomyMapping: TaxonomyMappingResult;
  isAmbiguous: boolean;
  needsReconfirmation: boolean;
  originalV1: V1PreferenceInput;
}

export interface MigrationExecutionResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  ambiguousCount: number;
  durationMs: number;
  durationFormatted: string;
  errors: Array<{ userId: string; error: string }>;
  snapshotJson?: string;
}

export class RedisPreferenceExtractor {
  /**
   * Extracts subscriber preferences from a live Redis instance.
   */
  public static async extractFromRedis(
    redis: RedisClientType | any,
  ): Promise<MigrationSubscriberRecord[]> {
    const startTime = Date.now();
    logger.info('[RedisPreferenceExtractor] Scanning Redis subscribers for V2 migration...');

    // 1. Fetch all subscriber IDs from Redis set 'subscribers'
    let subscriberIds: string[] = [];
    try {
      if (typeof redis.sMembers === 'function') {
        subscriberIds = await redis.sMembers('subscribers');
      } else if (typeof redis.smembers === 'function') {
        subscriberIds = await redis.smembers('subscribers');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RedisPreferenceExtractor] Failed fetching 'subscribers' set: ${errMsg}. Falling back to key scan.`);
    }

    // If 'subscribers' set was empty or missing, fallback to SCAN 'preferences:*'
    if (subscriberIds.length === 0) {
      try {
        const keys: string[] = typeof redis.keys === 'function' ? await redis.keys('preferences:*') : [];
        subscriberIds = keys.map((k) => k.replace('preferences:', ''));
      } catch (scanErr: unknown) {
        const scanErrMsg = scanErr instanceof Error ? scanErr.message : String(scanErr);
        logger.error(`[RedisPreferenceExtractor] Redis scan failed: ${scanErrMsg}`);
      }
    }

    logger.info(`[RedisPreferenceExtractor] Found ${subscriberIds.length} subscriber(s) to extract.`);

    const rawRecords: V1RedisSubscriberData[] = [];
    for (const userId of subscriberIds) {
      try {
        let rawVal: any;
        if (typeof redis.get === 'function') {
          rawVal = await redis.get(`preferences:${userId}`);
        }

        if (rawVal) {
          const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
          rawRecords.push({
            userId,
            preferences: parsed,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[RedisPreferenceExtractor] Failed reading preference for user ${userId}: ${errMsg}`);
      }
    }

    const mapped = this.mapRecords(rawRecords);
    const durationMs = Math.max(1, Date.now() - startTime);
    logger.info(`[RedisPreferenceExtractor] Extracted and mapped ${mapped.length} records in ${ms(durationMs)}.`);
    return mapped;
  }

  /**
   * Maps an array of raw V1 subscriber payloads to normalized V2 records.
   */
  public static mapRecords(rawRecords: V1RedisSubscriberData[]): MigrationSubscriberRecord[] {
    return rawRecords.map((item) => {
      const telegramId = BigInt(item.userId);
      const originalV1 = item.preferences ?? {};
      const taxonomy = TaxonomyMapper.mapV1PreferenceToV2(originalV1);

      const preferenceHash = computePreferenceHash({
        specializations: taxonomy.specializations,
        regionPreference: taxonomy.regionPreference,
        experienceLevel: taxonomy.experienceLevel,
        workType: taxonomy.workType,
      });

      return {
        telegramId,
        status: 'ACTIVE',
        preferences: {
          specializations: taxonomy.specializations,
          regionPreference: taxonomy.regionPreference,
          experienceLevel: taxonomy.experienceLevel,
          workType: taxonomy.workType,
          preferenceHash,
        },
        taxonomyMapping: taxonomy,
        isAmbiguous: taxonomy.isAmbiguous,
        needsReconfirmation: taxonomy.suggestedReconfirmation,
        originalV1,
      };
    });
  }

  /**
   * Generates a pre-migration JSON snapshot for disaster recovery and reconciliation.
   */
  public static dumpSnapshot(records: MigrationSubscriberRecord[]): string {
    const serialized = records.map((r) => ({
      ...r,
      telegramId: r.telegramId.toString(),
    }));

    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalSubscribers: records.length,
        records: serialized,
      },
      null,
      2,
    );
  }

  /**
   * Migrates mapped records into PostgreSQL (User and UserPreference tables).
   */
  public static async migrateToPostgres(
    records: MigrationSubscriberRecord[],
    prisma: PrismaClient,
    options?: { batchSize?: number },
  ): Promise<MigrationExecutionResult> {
    const startTime = Date.now();
    const batchSize = options?.batchSize ?? 100;
    let successful = 0;
    let failed = 0;
    let ambiguousCount = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    logger.info(`[RedisPreferenceExtractor] Migrating ${records.length} records to PostgreSQL in chunks of ${batchSize}...`);

    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);

      for (const rec of chunk) {
        if (rec.isAmbiguous) {
          ambiguousCount++;
        }

        try {
          // Upsert User record
          const user = await prisma.user.upsert({
            where: { telegramId: rec.telegramId },
            update: {
              status: rec.status,
            },
            create: {
              telegramId: rec.telegramId,
              status: rec.status,
            },
          });

          // Upsert UserPreference record
          await prisma.userPreference.upsert({
            where: { userId: user.id },
            update: {
              specializations: rec.preferences.specializations,
              regionPreference: rec.preferences.regionPreference,
              experienceLevel: rec.preferences.experienceLevel,
              workType: rec.preferences.workType,
              preferenceHash: rec.preferences.preferenceHash,
            },
            create: {
              userId: user.id,
              specializations: rec.preferences.specializations,
              regionPreference: rec.preferences.regionPreference,
              experienceLevel: rec.preferences.experienceLevel,
              workType: rec.preferences.workType,
              preferenceHash: rec.preferences.preferenceHash,
            },
          });

          successful++;
        } catch (err: unknown) {
          failed++;
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ userId: rec.telegramId.toString(), error: errMsg });
          logger.error(`[RedisPreferenceExtractor] Migration failed for user ${rec.telegramId}: ${errMsg}`);
        }
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    logger.info(
      `[RedisPreferenceExtractor] Migration finished in ${ms(durationMs)}. Success: ${successful}, Failed: ${failed}, Ambiguous: ${ambiguousCount}.`,
    );

    return {
      totalProcessed: records.length,
      successful,
      failed,
      ambiguousCount,
      durationMs,
      durationFormatted: ms(durationMs),
      errors,
    };
  }
}


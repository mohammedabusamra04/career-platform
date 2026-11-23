import fs from 'fs';
import path from 'path';
import ms from 'ms';
import { prisma, type PrismaService } from '../../shared/database/prisma.service.js';
import redisClient from '../../config/redis.js';
import logger from '../../shared/utils/logger.js';

export interface RawSnapshotRecord {
  telegramId: string | number | bigint;
  status?: string;
  preferences?: any;
  rawPreferences?: Record<string, string>;
  [key: string]: any;
}

export interface SnapshotMetadata {
  filename: string;
  filepath: string;
  createdAt: string;
  sizeBytes: number;
  subscriberCount: number;
  valid: boolean;
}

export interface RollbackExecutionResult {
  success: boolean;
  restoredCount: number;
  failedCount: number;
  durationMs: number;
  durationFormatted: string;
  errors: string[];
}

export class RollbackManager {
  private readonly backupDir: string;

  constructor(
    private readonly prismaClient: PrismaService = prisma,
    private readonly redis = redisClient,
    customBackupDir?: string,
  ) {
    this.backupDir = customBackupDir || path.resolve(process.cwd(), 'backup');
  }

  public listSnapshots(): SnapshotMetadata[] {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('redis-migration-snapshot-') && f.endsWith('.json'));

      return files
        .map((filename) => {
          const filepath = path.join(this.backupDir, filename);
          try {
            const stats = fs.statSync(filepath);
            const content = fs.readFileSync(filepath, 'utf-8');
            const parsed = JSON.parse(content);
            const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : []);
            const valid = records.length > 0;

            return {
              filename,
              filepath,
              createdAt: stats.mtime.toISOString(),
              sizeBytes: stats.size,
              subscriberCount: records.length,
              valid,
            };
          } catch (readErr: unknown) {
            logger.warn(`[RollbackManager] Failed parsing snapshot file ${filename}: ${(readErr as Error).message}`);
            return {
              filename,
              filepath,
              createdAt: new Date(0).toISOString(),
              sizeBytes: 0,
              subscriberCount: 0,
              valid: false,
            };
          }
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (err: unknown) {
      logger.error(`[RollbackManager] Failed listing snapshots: ${(err as Error).message}`);
      return [];
    }
  }

  public async restoreFromSnapshot(snapshotPath: string): Promise<RollbackExecutionResult> {
    const start = Date.now();
    const errors: string[] = [];
    let restoredCount = 0;
    let failedCount = 0;

    try {
      if (!fs.existsSync(snapshotPath)) {
        throw new Error(`Snapshot file not found at path: ${snapshotPath}`);
      }

      const rawContent = fs.readFileSync(snapshotPath, 'utf-8');
      const parsed = JSON.parse(rawContent);
      const records: RawSnapshotRecord[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.records)
          ? parsed.records
          : [];

      if (records.length === 0) {
        throw new Error('Snapshot file does not contain a valid non-empty array of records');
      }

      logger.info(`[RollbackManager] Restoring ${records.length} records from snapshot: ${snapshotPath}...`);

      for (const record of records) {
        try {
          if (!record.telegramId) {
            failedCount++;
            errors.push('Record missing telegramId');
            continue;
          }

          const telegramBigInt = BigInt(record.telegramId);

          // Restore active flag in Redis state
          if (this.redis.isOpen) {
            await this.redis.sAdd('subscribers:all', String(record.telegramId));
            if (record.rawPreferences) {
              await this.redis.hSet(`user:${record.telegramId}:preferences`, record.rawPreferences as Record<string, string>);
            }
          }

          // Restore / ensure User record in PostgreSQL
          await this.prismaClient.user.upsert({
            where: { telegramId: telegramBigInt },
            update: {
              status: 'ACTIVE',
            },
            create: {
              telegramId: telegramBigInt,
              status: 'ACTIVE',
            },
          });

          restoredCount++;
        } catch (itemErr: unknown) {
          failedCount++;
          errors.push(`Failed restoring user ${record.telegramId}: ${(itemErr as Error).message}`);
        }
      }

      const durationMs = Math.max(1, Date.now() - start);
      return {
        success: failedCount === 0,
        restoredCount,
        failedCount,
        durationMs,
        durationFormatted: ms(durationMs),
        errors,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(1, Date.now() - start);
      errors.push((err as Error).message);
      return {
        success: false,
        restoredCount,
        failedCount: failedCount || 1,
        durationMs,
        durationFormatted: ms(durationMs),
        errors,
      };
    }
  }

  public async setEmergencyPause(pause: boolean): Promise<boolean> {
    try {
      if (!this.redis.isOpen) {
        return false;
      }

      if (pause) {
        await this.redis.set('emergency:delivery:pause', 'true');
        logger.warn('[RollbackManager] ⚠️ Emergency global delivery PAUSE activated');
      } else {
        await this.redis.del('emergency:delivery:pause');
        logger.info('[RollbackManager] ✅ Emergency global delivery pause LIFTED');
      }
      return true;
    } catch (err: unknown) {
      logger.error(`[RollbackManager] Error toggling emergency pause: ${(err as Error).message}`);
      return false;
    }
  }

  public async isEmergencyPaused(): Promise<boolean> {
    try {
      if (!this.redis.isOpen) return false;
      const val = await this.redis.get('emergency:delivery:pause');
      return val === 'true';
    } catch (err: unknown) {
      logger.error(`[RollbackManager] Error checking emergency pause: ${(err as Error).message}`);
      return false;
    }
  }
}

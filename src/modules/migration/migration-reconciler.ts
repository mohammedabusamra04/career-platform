import ms from 'ms';
import type { PrismaClient } from '@prisma/client';
import { Specialization } from '../preferences/preference.taxonomy.js';
import type { MigrationSubscriberRecord } from './redis-preference-extractor.js';
import logger from '../../shared/utils/logger.js';

export interface MigrationDryRunReport {
  timestamp: string;
  totalRedisSubscribers: number;
  successfulMappings: number;
  ambiguousMappings: number;
  failedMappings: number;
  specializationDistribution: Record<string, number>;
  durationMs: number;
  durationFormatted: string;
  errors: Array<{ userId: string; error: string }>;
  status: 'PASSED' | 'FAILED';
}

export interface MigrationReconciliationReport {
  timestamp: string;
  redisSubscriberCount: number;
  postgresUserCount: number;
  postgresPreferenceCount: number;
  matchingCount: number;
  missingUsers: string[];
  missingPreferences: string[];
  hashMismatches: Array<{ userId: string; expectedHash: string; actualHash: string }>;
  isReconciled: boolean;
  durationMs: number;
  durationFormatted: string;
  status: 'PASSED' | 'FAILED';
}

export class MigrationReconciler {
  /**
   * Generates a dry-run audit report without mutating the database.
   */
  public static executeDryRun(
    records: MigrationSubscriberRecord[],
    options?: { durationMs?: number; errors?: Array<{ userId: string; error: string }> },
  ): MigrationDryRunReport {
    const durationMs = options?.durationMs ?? 1;
    const errors = options?.errors ?? [];

    const distribution: Record<string, number> = {};
    for (const spec of Object.values(Specialization)) {
      distribution[spec] = 0;
    }

    let ambiguousCount = 0;
    let successfulCount = 0;

    for (const rec of records) {
      if (rec.isAmbiguous) {
        ambiguousCount++;
      } else {
        successfulCount++;
      }

      for (const spec of rec.preferences.specializations) {
        distribution[spec] = (distribution[spec] ?? 0) + 1;
      }
    }

    const failedCount = errors.length;
    const status: 'PASSED' | 'FAILED' = failedCount === 0 ? 'PASSED' : 'FAILED';

    return {
      timestamp: new Date().toISOString(),
      totalRedisSubscribers: records.length,
      successfulMappings: successfulCount,
      ambiguousMappings: ambiguousCount,
      failedMappings: failedCount,
      specializationDistribution: distribution,
      durationMs,
      durationFormatted: ms(durationMs),
      errors,
      status,
    };
  }

  /**
   * Reconciles pre-migration Redis subscribers against post-migration PostgreSQL records.
   */
  public static async reconcile(
    redisRecords: MigrationSubscriberRecord[],
    prisma: PrismaClient,
  ): Promise<MigrationReconciliationReport> {
    const startTime = Date.now();
    logger.info(`[MigrationReconciler] Starting reconciliation for ${redisRecords.length} subscribers...`);

    const telegramIds = redisRecords.map((r) => r.telegramId);

    // 1. Fetch matching Postgres Users
    const users = await prisma.user.findMany({
      where: {
        telegramId: { in: telegramIds },
      },
      include: {
        preference: true,
      },
    });

    const userMap = new Map<string, (typeof users)[0]>();
    for (const u of users) {
      userMap.set(u.telegramId.toString(), u);
    }

    const missingUsers: string[] = [];
    const missingPreferences: string[] = [];
    const hashMismatches: Array<{ userId: string; expectedHash: string; actualHash: string }> = [];
    let matchingCount = 0;

    for (const expected of redisRecords) {
      const strId = expected.telegramId.toString();
      const actualUser = userMap.get(strId);

      if (!actualUser) {
        missingUsers.push(strId);
        continue;
      }

      if (!actualUser.preference) {
        missingPreferences.push(strId);
        continue;
      }

      if (actualUser.preference.preferenceHash !== expected.preferences.preferenceHash) {
        hashMismatches.push({
          userId: strId,
          expectedHash: expected.preferences.preferenceHash,
          actualHash: actualUser.preference.preferenceHash,
        });
        continue;
      }

      matchingCount++;
    }

    const isReconciled =
      missingUsers.length === 0 &&
      missingPreferences.length === 0 &&
      hashMismatches.length === 0 &&
      matchingCount === redisRecords.length;

    const durationMs = Math.max(1, Date.now() - startTime);

    return {
      timestamp: new Date().toISOString(),
      redisSubscriberCount: redisRecords.length,
      postgresUserCount: users.length,
      postgresPreferenceCount: users.filter((u) => u.preference !== null).length,
      matchingCount,
      missingUsers,
      missingPreferences,
      hashMismatches,
      isReconciled,
      durationMs,
      durationFormatted: ms(durationMs),
      status: isReconciled ? 'PASSED' : 'FAILED',
    };
  }

  /**
   * Formats a Dry Run Audit Report into clean Markdown tables.
   */
  public static generateMarkdownDryRunReport(report: MigrationDryRunReport): string {
    const distRows = Object.entries(report.specializationDistribution)
      .map(([spec, count]) => `| **${spec}** | ${count.toLocaleString()} |`)
      .join('\n');

    return `# V1 to V2 Migration: Dry-Run Audit Report

- **Execution Timestamp:** \`${report.timestamp}\`
- **Overall Status:** **${report.status}**
- **Simulation Duration:** **${report.durationFormatted}**

---

## 1. Subscriber Conversion Metrics
| Metric | Value |
| :--- | :--- |
| **Total Redis Subscribers Scanned** | **${report.totalRedisSubscribers.toLocaleString()}** |
| **Clean Taxonomy Matches (High Confidence)** | **${report.successfulMappings.toLocaleString()}** |
| **Ambiguous Roles (Flagged for Reconfirmation)** | **${report.ambiguousMappings.toLocaleString()}** |
| **Failed Mappings / Corrupted Payloads** | **${report.failedMappings.toLocaleString()}** |

---

## 2. Specialization Taxonomy Distribution
| Specialization Domain | Mapped Count |
| :--- | :--- |
${distRows}
`;
  }

  /**
   * Formats a Pre- vs Post-Migration Reconciliation Report into clean Markdown.
   */
  public static generateMarkdownReconciliationReport(report: MigrationReconciliationReport): string {
    return `# V1 to V2 Migration: Reconciliation Report

- **Execution Timestamp:** \`${report.timestamp}\`
- **Overall Status:** **${report.status}**
- **Reconciliation Assessment:** **${report.isReconciled ? 'FULLY RECONCILED (100% MATCH)' : 'DISCREPANCIES DETECTED'}**
- **Duration:** **${report.durationFormatted}**

---

## 1. Entity Reconciliation Summary
| Entity Layer | Redis (Source) | PostgreSQL (Destination) | Discrepancy Count | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Subscribers / Users** | ${report.redisSubscriberCount.toLocaleString()} | ${report.postgresUserCount.toLocaleString()} | ${report.missingUsers.length} | ${report.missingUsers.length === 0 ? 'MATCH' : 'MISMATCH'} |
| **User Preferences** | ${report.redisSubscriberCount.toLocaleString()} | ${report.postgresPreferenceCount.toLocaleString()} | ${report.missingPreferences.length} | ${report.missingPreferences.length === 0 ? 'MATCH' : 'MISMATCH'} |
| **Preference Hashes** | ${report.redisSubscriberCount.toLocaleString()} | ${report.matchingCount.toLocaleString()} | ${report.hashMismatches.length} | ${report.hashMismatches.length === 0 ? 'MATCH' : 'MISMATCH'} |
`;
  }
}


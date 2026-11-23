import ms from 'ms';
import fs from 'node:fs';
import path from 'node:path';
import redisClient, { connectRedis } from '../config/redis.js';
import { prisma } from '../shared/database/prisma.service.js';
import {
  RedisPreferenceExtractor,
  MigrationReconciler,
} from '../modules/migration/index.js';
import logger from '../shared/utils/logger.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isCommit = args.includes('--commit');
  const isReconcileOnly = args.includes('--reconcile');
  const isDryRun = args.includes('--dry-run') || (!isCommit && !isReconcileOnly);
  const shouldSnapshot = args.includes('--snapshot') || isCommit;

  logger.info(`Starting V1 to V2 Migration Tool (Mode: ${isCommit ? 'COMMIT' : isReconcileOnly ? 'RECONCILE' : 'DRY-RUN'})...`);

  // 1. Connect to Redis
  try {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  } catch (err: unknown) {
    logger.warn(
      `[MigrationCLI] Could not connect to live Redis: ${err instanceof Error ? err.message : String(err)}. Check REDIS_URL in .env.`,
    );
  }

  // 2. Extract records from Redis
  const startTime = Date.now();
  const records = await RedisPreferenceExtractor.extractFromRedis(redisClient);
  const extractionDurationMs = Date.now() - startTime;

  logger.info(`Extracted ${records.length} subscriber(s) in ${ms(extractionDurationMs)}.`);

  // 3. Optional Snapshot Dump
  if (shouldSnapshot && records.length > 0) {
    const backupDir = path.resolve(process.cwd(), 'backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const snapshotFileName = `redis-migration-snapshot-${Date.now()}.json`;
    const snapshotPath = path.join(backupDir, snapshotFileName);
    const snapshotData = RedisPreferenceExtractor.dumpSnapshot(records);
    fs.writeFileSync(snapshotPath, snapshotData, 'utf-8');
    logger.info(`Pre-migration snapshot written to ${snapshotPath}`);
  }

  // 4. Dry-Run Execution
  if (isDryRun) {
    const dryRunReport = MigrationReconciler.executeDryRun(records, {
      durationMs: extractionDurationMs,
    });
    const markdown = MigrationReconciler.generateMarkdownDryRunReport(dryRunReport);
    console.log('\n' + markdown);

    if (dryRunReport.status !== 'PASSED') {
      logger.error('Dry-run audit detected errors.');
      process.exit(1);
    }

    logger.info(`Dry-run audit completed successfully in ${dryRunReport.durationFormatted}.`);
    process.exit(0);
  }

  // 5. Commit Execution
  if (isCommit) {
    const migrationResult = await RedisPreferenceExtractor.migrateToPostgres(records, prisma);
    logger.info(
      `Migration committed: ${migrationResult.successful} successful, ${migrationResult.failed} failed in ${migrationResult.durationFormatted}.`,
    );

    if (migrationResult.failed > 0) {
      logger.error('Errors encountered during PostgreSQL migration.');
      process.exit(1);
    }

    // Run reconciliation after commit
    const reconciliationReport = await MigrationReconciler.reconcile(records, prisma);
    const reconciliationMarkdown = MigrationReconciler.generateMarkdownReconciliationReport(reconciliationReport);
    console.log('\n' + reconciliationMarkdown);

    if (!reconciliationReport.isReconciled) {
      logger.error('Post-migration reconciliation check failed.');
      process.exit(1);
    }

    logger.info(`Migration and reconciliation PASSED in ${reconciliationReport.durationFormatted}.`);
    process.exit(0);
  }

  // 6. Standalone Reconciliation Check
  if (isReconcileOnly) {
    const reconciliationReport = await MigrationReconciler.reconcile(records, prisma);
    const reconciliationMarkdown = MigrationReconciler.generateMarkdownReconciliationReport(reconciliationReport);
    console.log('\n' + reconciliationMarkdown);

    if (!reconciliationReport.isReconciled) {
      logger.error('Reconciliation discrepancies detected.');
      process.exit(1);
    }

    logger.info('Reconciliation check PASSED with 100% match.');
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  logger.error(`Fatal migration tool error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});


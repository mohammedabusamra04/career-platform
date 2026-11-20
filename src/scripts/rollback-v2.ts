import { RollbackManager } from '../modules/production/rollback-manager.js';
import { prisma } from '../shared/database/prisma.service.js';
import redisClient, { connectRedis } from '../config/redis.js';
import logger from '../shared/utils/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const manager = new RollbackManager(prisma, redisClient);

  if (args.includes('--check')) {
    logger.info('Auditing existing backup snapshots in backup/ ...');
    const snapshots = manager.listSnapshots();

    if (snapshots.length === 0) {
      console.log('No backup snapshots found in backup/ directory.');
      process.exit(0);
    }

    console.log('\n# Available Migration & Rollback Snapshots:\n');
    console.log('| Filename | Created At | Records | Size | Valid |');
    console.log('| :--- | :--- | :---: | :---: | :---: |');
    for (const s of snapshots) {
      console.log(`| \`${s.filename}\` | ${s.createdAt} | ${s.subscriberCount} | ${s.sizeBytes} bytes | ${s.valid ? '✅ YES' : '❌ NO'} |`);
    }
    console.log('\nUse --restore-snapshot <path> to restore a snapshot.\n');
    process.exit(0);
  }

  if (args.includes('--emergency-pause')) {
    await connectRedis();
    await manager.setEmergencyPause(true);
    console.log('⚠️ Emergency global delivery PAUSE has been ACTIVATED in Redis.');
    if (redisClient.isOpen) await redisClient.quit();
    process.exit(0);
  }

  if (args.includes('--resume')) {
    await connectRedis();
    await manager.setEmergencyPause(false);
    console.log('✅ Emergency global delivery pause has been LIFTED.');
    if (redisClient.isOpen) await redisClient.quit();
    process.exit(0);
  }

  const restoreIdx = args.indexOf('--restore-snapshot');
  if (restoreIdx !== -1 && args[restoreIdx + 1]) {
    const targetPath = args[restoreIdx + 1];
    await connectRedis();
    await prisma.connect();

    const result = await manager.restoreFromSnapshot(targetPath);
    console.log('\n# Rollback Restoration Outcome:');
    console.log(`- Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`- Restored Records: ${result.restoredCount}`);
    console.log(`- Failed Records: ${result.failedCount}`);
    console.log(`- Duration: ${result.durationFormatted}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((e) => console.log(`  - ${e}`));
    }

    await prisma.disconnect();
    if (redisClient.isOpen) await redisClient.quit();

    process.exit(result.success ? 0 : 1);
  }

  console.log(`
Usage:
  tsx src/scripts/rollback-v2.ts --check                     List and validate existing backup snapshots
  tsx src/scripts/rollback-v2.ts --emergency-pause           Immediately halt all automated delivery loops
  tsx src/scripts/rollback-v2.ts --resume                    Lift emergency delivery pause
  tsx src/scripts/rollback-v2.ts --restore-snapshot <path>   Restore subscriber state from specified JSON snapshot
  `);
  process.exit(0);
}

main().catch((err: unknown) => {
  logger.error(`[Rollback CLI] Fatal error: ${(err as Error).message}`);
  process.exit(1);
});

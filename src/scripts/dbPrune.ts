import ms from 'ms';
import { pruningService } from '../shared/database/pruning.service.js';
import { prisma } from '../shared/database/prisma.service.js';
import logger from '../shared/utils/logger.js';

async function main(): Promise<void> {
  try {
    const shouldReclassify = process.argv.includes('--reclassify');
    logger.info('Executing standalone database retention pruning script...');
    const result = await pruningService.runAllPruning();

    let reclassifiedCount = 0;
    let reclassifyClosedCount = 0;
    if (shouldReclassify) {
      logger.info('Executing active jobs reclassification (--reclassify enabled)...');
      const reclassifyResult = await pruningService.reclassifyActiveJobs();
      reclassifiedCount = reclassifyResult.updatedCount;
      reclassifyClosedCount = reclassifyResult.closedOrExpiredCount;
    }

    console.log('--- Database Pruning Summary ---');
    console.log(`Sent Jobs pruned (>60d):       ${result.sentJobsDeleted}`);
    console.log(`Closed Jobs pruned (>30d):     ${result.closedJobsDeleted}`);
    console.log(`Delivery Slots pruned (>30d):  ${result.deliverySlotsDeleted}`);
    console.log(`Stale Active Jobs marked EXPIRED (>21d): ${result.staleJobsExpired}`);
    console.log(`Dead/Expired Links marked EXPIRED:      ${result.deadLinksExpired}`);
    console.log(`Non-Tech Jobs Closed:                   ${result.closedNonTechJobs ?? 0}`);
    console.log(`Fake Source Badges Corrected:           ${result.correctedSources ?? 0}`);
    if (shouldReclassify) {
      console.log(`Active Jobs Reclassified:               ${reclassifiedCount}`);
      console.log(`Active Jobs Closed during Reclassify:   ${reclassifyClosedCount}`);
    }
    console.log(`Total records cleaned:         ${result.totalDeleted}`);
    console.log(`Duration:                      ${result.durationMs}ms (${ms(result.durationMs)})`);
    console.log('--------------------------------');

    await prisma.disconnect();
    process.exit(0);
  } catch (err: any) {
    logger.error(`Database pruning failed: ${err.message}`);
    await prisma.disconnect().catch((disconnectErr: unknown) => {
      logger.warn(
        `Failed to disconnect Prisma during cleanup: ${
          disconnectErr instanceof Error ? disconnectErr.message : String(disconnectErr)
        }`,
      );
    });
    process.exit(1);
  }
}

main();

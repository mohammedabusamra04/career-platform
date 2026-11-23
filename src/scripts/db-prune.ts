import ms from 'ms';
import { pruningService } from '../shared/database/pruning.service.js';
import { prisma } from '../shared/database/prisma.service.js';
import logger from '../shared/utils/logger.js';

async function main(): Promise<void> {
  try {
    logger.info('Executing standalone database retention pruning script...');
    const result = await pruningService.runAllPruning();

    console.log('--- Database Pruning Summary ---');
    console.log(`Sent Jobs pruned (>60d):       ${result.sentJobsDeleted}`);
    console.log(`Closed Jobs pruned (>30d):     ${result.closedJobsDeleted}`);
    console.log(`Delivery Slots pruned (>30d):  ${result.deliverySlotsDeleted}`);
    console.log(`Stale Active Jobs marked EXPIRED (>21d): ${result.staleJobsExpired}`);
    console.log(`Dead/Expired Links marked EXPIRED:      ${result.deadLinksExpired}`);
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

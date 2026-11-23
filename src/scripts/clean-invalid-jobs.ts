import { prisma } from '../shared/database/prisma.service.js';
import { negativeExclusionMatcher } from '../modules/jobs/classifier/negative-exclusion.matcher.js';
import logger from '../shared/utils/logger.js';

async function main(): Promise<void> {
  try {
    logger.info('Starting invalid and non-technical database jobs cleanup...');

    // 1. Fetch all ACTIVE jobs from PostgreSQL
    const activeJobs = await prisma.job.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, title: true, source: true, url: true },
    });

    logger.info(`Found ${activeJobs.length} active jobs in database.`);

    let excludedCount = 0;
    let sourceFixedCount = 0;

    for (const job of activeJobs) {
      // Check negative exclusion
      const exclusion = negativeExclusionMatcher.evaluate(job.title);
      if (exclusion.isExcluded) {
        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'CLOSED' },
        });
        logger.info(`Closed non-technical job: "${job.title}" (${exclusion.reason})`);
        excludedCount++;
        continue;
      }

      // Check fake linkedin sources
      if (job.source.toLowerCase() === 'linkedin' && !job.url.toLowerCase().includes('linkedin.com')) {
        try {
          const parsed = new URL(job.url);
          const domain = parsed.hostname.toLowerCase().replace(/^www\./, '').split('.')[0];
          await prisma.job.update({
            where: { id: job.id },
            data: { source: domain || 'other' },
          });
          logger.info(`Corrected fake LinkedIn source for: "${job.title}" -> ${domain} (${job.url})`);
          sourceFixedCount++;
        } catch {
          // ignore
        }
      }
    }

    logger.info(
      `Cleanup completed successfully! Closed non-tech jobs: ${excludedCount}, Corrected source badges: ${sourceFixedCount}`,
    );
    await prisma.disconnect();
    process.exit(0);
  } catch (err: unknown) {
    logger.error(`Cleanup failed: ${(err as Error).message}`);
    await prisma.disconnect();
    process.exit(1);
  }
}

main();


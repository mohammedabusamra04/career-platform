import { ProductionCutoverChecker } from '../modules/production/cutover-checker.js';
import { prisma } from '../shared/database/prisma.service.js';
import redisClient from '../config/redis.js';
import logger from '../shared/utils/logger.js';

async function main() {
  logger.info('Starting Production Cutover Pre-flight Verification...');

  const checker = new ProductionCutoverChecker(prisma, redisClient);
  const report = await checker.executePreflight();

  const markdown = checker.generateMarkdownReport(report);
  console.log(markdown);

  await prisma.disconnect();
  if (redisClient.isOpen) {
    await redisClient.quit();
  }

  if (!report.allPassed) {
    logger.error('Cutover verification failed! One or more checks failed.');
    process.exit(1);
  }

  logger.info('✅ Production Cutover Pre-flight PASSED! System is ready for live traffic.');
  process.exit(0);
}

main().catch((err: unknown) => {
  logger.error(`Cutover check crashed: ${(err as Error).message}`);
  process.exit(1);
});

import { LoadTestRunner } from '../testing/loadTestRunner.js';
import { MockTelegramServer } from '../testing/mockTelegramServer.js';
import logger from '../shared/utils/logger.js';
import ms from 'ms';

async function run(): Promise<void> {
  logger.info('Starting 10,000 Subscribers Simulated Staging Load Test...');

  const telegramServer = new MockTelegramServer();
  const runner = new LoadTestRunner(telegramServer, {
    subscribersCount: 10000,
    batchSize: 25,
    rateLimitPerSec: 25,
    enablePacingDelay: false, // Fast simulation mode for CI/scripts with pacing mathematical checks
  });

  const { report } = await runner.execute();
  const markdown = LoadTestRunner.generateMarkdownReport(report);

  console.log('\n' + markdown);

  if (report.status !== 'PASSED') {
    logger.error('Load test FAILED verification checks.');
    process.exit(1);
  }

  logger.info(
    `Load test PASSED all criteria (0 duplicates, delta memory < 50MB, 10,000 deliveries in ${ms(report.durationMs)}).`,
  );
  process.exit(0);
}

run().catch((err: unknown) => {
  logger.error(`Fatal load test runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

import { LoadTestRunner } from '../testing/loadTestRunner.js';
import { MockTelegramServer } from '../testing/mockTelegramServer.js';
import logger from '../shared/utils/logger.js';
import ms from 'ms';

async function run(): Promise<void> {
  logger.info('Starting TASK-47.2: Chaos Engineering & Fault Injection Test (10s DB Drop + 50 Telegram 429s)...');

  const telegramServer = new MockTelegramServer();

  // Test 1,000 subscribers with simulated 10-second DB drop and 50 consecutive 429 flood
  const runner = new LoadTestRunner(telegramServer, {
    subscribersCount: 1000,
    batchSize: 25,
    rateLimitPerSec: 25,
    enablePacingDelay: false,
    chaos: {
      dbDropDuration: ms('10s'),
      dbDropTriggerBatch: 2,
      telegram429FloodCount: 50,
      telegram429RetryAfterSec: 0.02,
      dbRetryDelayMs: 250,
    },
  });

  const { report, stats } = await runner.execute();
  const markdown = LoadTestRunner.generateMarkdownReport(report);

  console.log('\n' + markdown);

  // Assertions
  const passedCriteria =
    report.status === 'PASSED' &&
    stats.totalSent === 1000 &&
    stats.duplicateCount === 0 &&
    stats.uniqueRecipients === 1000 &&
    stats.rateLimitHits === 50 &&
    report.uncaughtExceptions === 0;

  if (!passedCriteria) {
    logger.error('Chaos test FAILED verification checks.');
    process.exit(1);
  }

  logger.info(
    `Chaos test PASSED all acceptance criteria: 10s DB drop survived, 50 429s recovered, 1,000 deliveries in ${ms(report.durationMs)} with 0 duplicates.`,
  );
  process.exit(0);
}

run().catch((err: unknown) => {
  logger.error(`Fatal chaos test runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});


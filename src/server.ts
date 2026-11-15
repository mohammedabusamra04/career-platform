import app from './app.js';
import { bot } from './bot/bot.js';
import { connectRedis } from './config/redis.js';
import redisClient from './config/redis.js';
import env from './config/env.js';
import { prisma } from './shared/database/prisma.service.js';
import {
  jobNotificationScheduler,
  missedSlotWatchdogService,
} from './config/services.js';
import logger from './shared/utils/logger.js';

const server = app.listen(env.port, () => {
  logger.info(`App is running on port ${env.port}`);
});

await connectRedis();
await prisma.connect();

jobNotificationScheduler.start();
missedSlotWatchdogService.start();

if (env.telegramBotToken && env.telegramBotToken !== 'your_bot_token') {
  void bot.api
    .setMyCommands([
      { command: 'start', description: '🚀 Start configuring job preferences' },
      { command: 'subscription', description: '🔔 Check subscription status' },
      { command: 'subscribe', description: '✅ Enable job notifications' },
      { command: 'unsubscribe', description: '🔕 Disable job notifications' },
    ])

    .catch((err) => {
      logger.warn(
        `Failed to set Telegram bot commands: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  bot
    .start({
      drop_pending_updates: true,
    })
    .catch((error) => {
      logger.error(`Failed to start Telegram bot: ${error.message}`);
    });
} else {
  logger.warn('TELEGRAM_BOT_TOKEN is not configured. Telegram bot polling skipped.');
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  jobNotificationScheduler.stop();
  missedSlotWatchdogService.stop();

  try {
    await bot.stop();
  } catch {
    // ignore if bot was not running
  }

  server.close(() => {
    logger.info('HTTP server closed.');
  });

  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed.');
  }

  await prisma.disconnect();

  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

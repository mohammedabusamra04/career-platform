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

try {
  await connectRedis();
} catch (err: unknown) {
  logger.warn(
    `⚠️ Redis connection failed at startup, continuing without cache: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

await prisma.connect();

jobNotificationScheduler.start();
missedSlotWatchdogService.start();

if (env.telegramBotToken && env.telegramBotToken !== 'your_bot_token') {
  const defaultCommands = [
    { command: 'start', description: '⚡ Start & configure your Stack and market scope' },
    { command: 'jobs', description: 'Browse active roles matching your Stack' },
    { command: 'settings', description: 'Edit your Stack, target region, or bot language' },
    { command: 'pause', description: 'Temporarily pause job pings' },
    { command: 'resume', description: 'Resume your job pipeline immediately' },
    { command: 'stop', description: 'Unsubscribe and delete your data permanently' },
    { command: 'help', description: 'Display the DeployMe command guide' },
  ];

  const arabicCommands = [
    { command: 'start', description: '⚡ بدء الإعداد وضبط الـ Stack ونطاق السوق' },
    { command: 'jobs', description: 'استعراض أحدث الفرص المطابقة للـ Stack فوراً' },
    { command: 'settings', description: 'تعديل التخصص، نطاق السوق، أو لغة البوت' },
    { command: 'pause', description: 'إيقاف التنبيهات مؤقتاً' },
    { command: 'resume', description: 'إعادة تشغيل الـ Pipeline واستقبال الفرص فوراً' },
    { command: 'stop', description: 'إلغاء الاشتراك وحذف بياناتك نهائياً' },
    { command: 'help', description: 'عرض دليل أوامر DeployMe' },
  ];

  void Promise.all([
    bot.api.setMyCommands(defaultCommands),
    bot.api.setMyCommands(arabicCommands, { language_code: 'ar' }),
  ]).catch((err) => {
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
  } catch (err: unknown) {
    logger.debug(`[Server] Bot stop skipped or already stopped: ${(err as Error).message}`);
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

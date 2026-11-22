import env from '../../config/env.js';
import { NotificationScheduleService } from './notification.schedule.js';

import type { UserPreferences } from '../preferences/preference.types.js';
import logger from '../../shared/utils/logger.js';

interface JobPipelineRunner {
  run(): Promise<unknown>;
  runForUser(userId: number): Promise<unknown>;
}

interface SubscriptionReader {
  getSubscribedUsers(): Promise<number[]>;
}

interface PreferenceReader {
  getPreferences(userId: number): Promise<UserPreferences | null>;
}

export class JobNotificationScheduler {
  private timeoutId?: NodeJS.Timeout;
  private isRunning = false;
  private nextRunDate: Date | null = null;
  private lastRunDate: Date | null = null;

  constructor(
    private readonly pipelineService: JobPipelineRunner,
    private readonly scheduleService: NotificationScheduleService,
    private readonly subscriptionService: SubscriptionReader,
    private readonly preferenceService: PreferenceReader,
  ) {}

  start(): void {
    // Kill switch: set ENABLE_SCHEDULER=false (e.g. on Render) to keep the bot
    // alive without sending scheduled jobs. GitHub Actions stays the only sender.
    if (process.env.ENABLE_SCHEDULER === 'false') {
      logger.info('JobNotificationScheduler disabled (ENABLE_SCHEDULER=false)');
      return;
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info(
      `JobNotificationScheduler started (Timezone: ${env.timezone}, Time: ${env.dailyDigestTime})`,
    );

    void this.scheduleNextRun();
  }

  getNextRunTime(): Date | null {
    return this.nextRunDate;
  }

  getLastRunTime(): Date | null {
    return this.lastRunDate;
  }

  getSchedulerStatus(): {
    isRunning: boolean;
    lastRun: Date | null;
    nextRun: Date | null;
    timezone: string;
    notificationTimes: string[];
  } {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRunDate,
      nextRun: this.nextRunDate,
      timezone: env.timezone,
      notificationTimes: [env.dailyDigestTime],
    };
  }

  private async runDueNotifications(): Promise<void> {
    this.lastRunDate = new Date();
    const now = this.lastRunDate;

    const subscribers = await this.subscriptionService.getSubscribedUsers();
    logger.info(`Scheduler executing run. Active subscribers: ${subscribers.length}`);

    if (subscribers.length === 0) {
      return;
    }

    for (const userId of subscribers) {
      const preferences = await this.preferenceService.getPreferences(userId);

      if (!preferences) {
        continue;
      }

      // Enforce evening daily digest time (21:00) strictly to prevent unwanted morning triggers
      const isDue = this.scheduleService.isNotificationDue(
        preferences.timezone || env.timezone,
        [env.dailyDigestTime],
        now,
      );

      // If user is due or this is the global scheduled trigger, run for user
      if (isDue) {
        await this.pipelineService.runForUser(userId);
      }
    }
  }

  private async scheduleNextRun(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const now = new Date();
    const subscribers = await this.subscriptionService.getSubscribedUsers();

    const nextRuns: Date[] = [];

    // Global default scheduled run times from env (strictly dailyDigestTime)
    const globalNextRun = this.scheduleService.getNextNotificationTime(
      env.timezone,
      [env.dailyDigestTime],
      now,
    );
    nextRuns.push(globalNextRun);

    for (const userId of subscribers) {
      const preferences = await this.preferenceService.getPreferences(userId);

      if (!preferences) {
        continue;
      }

      const nextRun = this.scheduleService.getNextNotificationTime(
        preferences.timezone || env.timezone,
        [env.dailyDigestTime],
        now,
      );

      nextRuns.push(nextRun);
    }

    const nextRun = new Date(Math.min(...nextRuns.map((date) => date.getTime())));
    this.nextRunDate = nextRun;

    const delayMs = Math.max(0, nextRun.getTime() - now.getTime());
    logger.info(
      `Next scheduled job run at ${nextRun.toISOString()} (in ${Math.round(delayMs / 1000 / 60)} minutes)`,
    );

    this.timeoutId = setTimeout(async () => {
      this.timeoutId = undefined;

      if (!this.isRunning) {
        return;
      }

      try {
        await this.runDueNotifications();
      } catch (error) {
        logger.error(
          `Failed to run scheduled notifications: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (this.isRunning) {
        await this.scheduleNextRun();
      }
    }, delayMs);
  }

  stop(): void {
    this.isRunning = false;

    if (!this.timeoutId) {
      return;
    }

    clearTimeout(this.timeoutId);
    this.timeoutId = undefined;
    this.nextRunDate = null;
  }
}
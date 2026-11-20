import { DateTime } from 'luxon';
import logger from '../../shared/utils/logger.js';

export interface DueSlot {
  /** e.g. 2026-10-01-0900 (local date + slot time) */
  key: string;
  /** Minutes elapsed since the slot became due. */
  lagMinutes: number;
}

export class NotificationScheduleService {
  getNextNotificationTime(
    timezone: string,
    notificationTimes: string[],
    now: Date = new Date(),
  ): Date {
    const validZone = this.getValidTimezone(timezone);
    const validTimes = notificationTimes.length > 0 ? notificationTimes : ['09:00', '21:00'];
    const current = DateTime.fromJSDate(now).setZone(validZone);

    const candidates = validTimes
      .map((time) => {
        const [hour, minute] = time.split(':').map(Number);

        let notification = current.startOf('day').set({
          hour: Number.isNaN(hour) ? 9 : hour,
          minute: Number.isNaN(minute) ? 0 : minute,
          second: 0,
          millisecond: 0,
        });

        if (notification <= current) {
          notification = notification.plus({ days: 1 });
        }

        return notification;
      })
      .sort((a, b) => a.toMillis() - b.toMillis());

    return candidates[0].toJSDate();
  }

  isNotificationDue(
    timezone: string,
    notificationTimes: string[],
    now: Date = new Date(),
  ): boolean {
    const validZone = this.getValidTimezone(timezone);
    const validTimes = notificationTimes.length > 0 ? notificationTimes : ['09:00', '21:00'];
    const current = DateTime.fromJSDate(now).setZone(validZone);
    const currentTime = current.toFormat('HH:mm');

    return validTimes.includes(currentTime);
  }

  /**
   * Returns the most recent notification slot (e.g. 09:00 / 21:00 in the given
   * timezone) that is already due at `now`, together with how many minutes ago
   * it was due. Used by the pipeline to "catch up" on a slot when GitHub's cron
   * fires late, and to dedupe so each slot is only sent once.
   */
  getLatestDueSlot(
    timezone: string,
    notificationTimes: string[],
    now: Date = new Date(),
  ): DueSlot | null {
    const current = DateTime.fromJSDate(now).setZone(this.getValidTimezone(timezone));
    let latest: DateTime | null = null;

    for (const dayOffset of [0, -1]) {
      for (const time of notificationTimes) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());

        if (!match) {
          continue;
        }

        const hour = Number(match[1]);
        const minute = Number(match[2]);

        if (hour > 23 || minute > 59) {
          continue;
        }

        const slot = current
          .startOf('day')
          .plus({ days: dayOffset })
          .set({ hour, minute });

        if (slot.toMillis() > current.toMillis()) {
          continue;
        }

        if (!latest || slot.toMillis() > latest.toMillis()) {
          latest = slot;
        }
      }
    }

    if (!latest) {
      return null;
    }

    return {
      key: latest.toFormat('yyyy-LL-dd-HHmm'),
      lagMinutes: Math.floor(current.diff(latest, 'minutes').minutes),
    };
  }

  private getValidTimezone(timezone: string): string {
    if (!timezone || typeof timezone !== 'string') {
      return 'Asia/Gaza';
    }

    try {
      const dt = DateTime.now().setZone(timezone);
      return dt.isValid ? timezone : 'Asia/Gaza';
    } catch (err: unknown) {
      logger.warn(`[NotificationSchedule] Invalid timezone ${timezone}: ${(err as Error).message}`);
      return 'Asia/Gaza';
    }
  }
}

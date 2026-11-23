import ms from 'ms';

export interface TelegramRecordedMessage {
  chatId: string;
  text: string;
  timestamp: number;
  messageId: number;
}

export interface TelegramServerStats {
  totalSent: number;
  uniqueRecipients: number;
  duplicateCount: number;
  droppedCount: number;
  maxObservedRatePerSec: number;
  averageRatePerSec: number;
  durationMs: number;
  durationFormatted: string;
  rateLimitHits: number;
}

export interface ChaosConfig {
  remaining429s: number;
  retryAfterSec: number;
  networkDropUntil: number;
  serverErrorCount: number;
}

/**
 * MockTelegramServer intercepts and records outgoing Telegram bot digest deliveries.
 * Tracks delivery correctness, duplicate sends, pacing rate limits, and simulates
 * failure injection for chaos resilience testing.
 */
export class MockTelegramServer {
  private messages: TelegramRecordedMessage[] = [];
  private recipientDeliveryCounts = new Map<string, number>();
  private messageCounter = 0;
  private duplicateCounter = 0;
  private startTime: number = Date.now();
  private endTime: number = Date.now();
  private rateLimitCounter = 0;

  private chaos: ChaosConfig = {
    remaining429s: 0,
    retryAfterSec: 1,
    networkDropUntil: 0,
    serverErrorCount: 0,
  };

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.messages = [];
    this.recipientDeliveryCounts.clear();
    this.messageCounter = 0;
    this.duplicateCounter = 0;
    this.rateLimitCounter = 0;
    this.startTime = Date.now();
    this.endTime = Date.now();
    this.chaos = {
      remaining429s: 0,
      retryAfterSec: 1,
      networkDropUntil: 0,
      serverErrorCount: 0,
    };
  }

  public inject429s(count: number, retryAfterSec: number = 1): void {
    this.chaos.remaining429s = count;
    this.chaos.retryAfterSec = retryAfterSec;
  }

  public injectNetworkDrop(duration: number | string): void {
    const durationMs = typeof duration === 'string' ? (ms as unknown as (v: string) => number)(duration) : duration;
    this.chaos.networkDropUntil = Date.now() + durationMs;
  }

  public injectServerError(count: number): void {
    this.chaos.serverErrorCount = count;
  }

  /**
   * Simulates sendMessage API call.
   */
  public async sendMessage(
    chatId: string | number,
    text: string,
  ): Promise<{ messageId: number; success: boolean }> {
    const now = Date.now();
    const strChatId = String(chatId);

    // Chaos Scenario 1: Active Network Drop
    if (this.chaos.networkDropUntil > now) {
      throw new Error('ETIMEDOUT: Connection to Telegram API server dropped');
    }

    // Chaos Scenario 2: Consecutive 429 Rate Limits
    if (this.chaos.remaining429s > 0) {
      this.chaos.remaining429s--;
      this.rateLimitCounter++;
      const err = new Error(
        `Telegram API error: 429 Too Many Requests: retry after ${this.chaos.retryAfterSec}`,
      );
      (err as any).response = {
        status: 429,
        data: {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests: retry after',
          parameters: { retry_after: this.chaos.retryAfterSec },
        },
      };
      (err as any).status = 429;
      (err as any).retryAfter = this.chaos.retryAfterSec;
      throw err;
    }

    // Chaos Scenario 3: Transient 500 Server Error
    if (this.chaos.serverErrorCount > 0) {
      this.chaos.serverErrorCount--;
      throw new Error('Telegram API error: 502 Bad Gateway');
    }

    // Record Delivery
    this.messageCounter++;
    const currentCount = (this.recipientDeliveryCounts.get(strChatId) ?? 0) + 1;
    this.recipientDeliveryCounts.set(strChatId, currentCount);

    if (currentCount > 1) {
      this.duplicateCounter++;
    }

    const recordedMsg: TelegramRecordedMessage = {
      chatId: strChatId,
      text,
      timestamp: now,
      messageId: this.messageCounter,
    };

    this.messages.push(recordedMsg);
    this.endTime = now;

    return {
      messageId: this.messageCounter,
      success: true,
    };
  }

  public getStats(): TelegramServerStats {
    const durationMs = Math.max(1, this.endTime - this.startTime);
    const totalSent = this.messages.length;
    const uniqueRecipients = this.recipientDeliveryCounts.size;

    // Calculate maximum observed throughput per 1-second rolling window
    let maxObservedRatePerSec = 0;
    if (totalSent > 0) {
      const timestamps = this.messages.map((m) => m.timestamp);
      let left = 0;
      for (let right = 0; right < timestamps.length; right++) {
        while (timestamps[right]! - timestamps[left]! > 1000) {
          left++;
        }
        const windowRate = right - left + 1;
        if (windowRate > maxObservedRatePerSec) {
          maxObservedRatePerSec = windowRate;
        }
      }
    }

    const averageRatePerSec = totalSent > 0 ? (totalSent / (durationMs / 1000)) : 0;

    return {
      totalSent,
      uniqueRecipients,
      duplicateCount: this.duplicateCounter,
      droppedCount: 0,
      maxObservedRatePerSec,
      averageRatePerSec,
      durationMs,
      durationFormatted: ms(durationMs),
      rateLimitHits: this.rateLimitCounter,
    };
  }

  public getRecordedMessages(): TelegramRecordedMessage[] {
    return [...this.messages];
  }

  public getRecipientCount(chatId: string | number): number {
    return this.recipientDeliveryCounts.get(String(chatId)) ?? 0;
  }
}

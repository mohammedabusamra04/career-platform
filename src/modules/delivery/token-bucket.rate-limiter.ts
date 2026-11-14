import ms from 'ms';

export interface TokenBucketOptions {
  capacity?: number;
  refillRatePerSecond?: number;
}

const ONE_SECOND_MS = ms('1s');
const JITTER_BUFFER_MS = ms('5ms');

/**
 * TokenBucketRateLimiter (Sliding Window Log Rate Limiter)
 * Strictly enforces that no more than maxTokensPerSecond (default: 25) dispatches
 * can occur in any rolling 1-second (1000ms) window, guaranteeing full compliance
 * with Telegram broadcast rate limit policies without burst overruns.
 */
export class TokenBucketRateLimiter {
  private readonly maxTokensPerSecond: number;
  private readonly timestamps: number[] = [];

  constructor(options?: TokenBucketOptions) {
    this.maxTokensPerSecond = options?.refillRatePerSecond ?? 25;
  }

  /**
   * Acquires the specified number of tokens (default: 1).
   * Asynchronously pauses if acquiring would exceed maxTokensPerSecond in any 1-second window.
   */
  public async acquire(tokensNeeded: number = 1): Promise<void> {
    if (tokensNeeded <= 0) return;

    while (true) {
      const now = Date.now();

      // Prune timestamps older than 1 second (1000ms)
      while (this.timestamps.length > 0 && this.timestamps[0] <= now - ONE_SECOND_MS) {
        this.timestamps.shift();
      }

      if (this.timestamps.length + tokensNeeded <= this.maxTokensPerSecond) {
        for (let i = 0; i < tokensNeeded; i++) {
          this.timestamps.push(Date.now());
        }
        return;
      }

      // Calculate required wait until the oldest timestamp in window expires
      const oldest = this.timestamps[0];
      const waitMs = oldest + ONE_SECOND_MS - now + JITTER_BUFFER_MS;
      await this.sleep(Math.max(waitMs, JITTER_BUFFER_MS));
    }
  }

  /**
   * Non-blocking attempt to acquire tokens. Returns true if capacity is available in window, false otherwise.
   */
  public tryAcquire(tokensNeeded: number = 1): boolean {
    if (tokensNeeded <= 0) return true;

    const now = Date.now();
    while (this.timestamps.length > 0 && this.timestamps[0] <= now - ONE_SECOND_MS) {
      this.timestamps.shift();
    }

    if (this.timestamps.length + tokensNeeded <= this.maxTokensPerSecond) {
      for (let i = 0; i < tokensNeeded; i++) {
        this.timestamps.push(Date.now());
      }
      return true;
    }
    return false;
  }

  /**
   * Returns available tokens in the current 1-second sliding window.
   */
  public getAvailableTokens(): number {
    const now = Date.now();
    while (this.timestamps.length > 0 && this.timestamps[0] <= now - ONE_SECOND_MS) {
      this.timestamps.shift();
    }
    return Math.max(0, this.maxTokensPerSecond - this.timestamps.length);
  }

  /**
   * Resets rate limiter window.
   */
  public reset(): void {
    this.timestamps.length = 0;
  }

  private sleep(sleepMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

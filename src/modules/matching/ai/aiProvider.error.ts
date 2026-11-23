export class AIProviderError extends Error {
  public readonly skipped: boolean;
  public readonly reason?: string;

  constructor(
    message: string,
    options?: { skipped?: boolean; reason?: string },
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.skipped = options?.skipped ?? false;
    this.reason = options?.reason;
  }
}
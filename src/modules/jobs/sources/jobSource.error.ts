export class JobSourceError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JobSourceError';
  }
}

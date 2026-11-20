import crypto from 'node:crypto';

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEntry {
  timestamp: string;
  severity: LogSeverity;
  module: string;
  message: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export interface StructuredLogOptions {
  module?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * StructuredLogger produces machine-readable JSON log events complying with
 * operational observability standards: severity, timestamp, module, and traceId.
 */
export class StructuredLogger {
  private readonly defaultModule: string;
  private readonly defaultTraceId?: string;

  constructor(moduleName: string = 'app', defaultTraceId?: string) {
    this.defaultModule = moduleName;
    this.defaultTraceId = defaultTraceId;
  }

  public format(entry: StructuredLogEntry): string {
    return JSON.stringify(entry);
  }

  public buildEntry(
    severity: LogSeverity,
    message: string,
    options?: StructuredLogOptions,
    err?: unknown,
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      severity,
      module: options?.module ?? this.defaultModule,
      message,
    };

    const traceId = options?.traceId ?? this.defaultTraceId;
    if (traceId) {
      entry.traceId = traceId;
    }

    if (options?.metadata && Object.keys(options.metadata).length > 0) {
      entry.metadata = options.metadata;
    }

    if (err) {
      if (err instanceof Error) {
        entry.error = {
          name: err.name,
          message: err.message,
          stack: err.stack,
        };
      } else {
        entry.error = {
          message: String(err),
        };
      }
    }

    return entry;
  }

  public info(message: string, options?: StructuredLogOptions): string {
    const entry = this.buildEntry('INFO', message, options);
    const json = this.format(entry);
    console.log(json);
    return json;
  }

  public warn(message: string, options?: StructuredLogOptions): string {
    const entry = this.buildEntry('WARN', message, options);
    const json = this.format(entry);
    console.warn(json);
    return json;
  }

  public error(message: string, errorOrOptions?: unknown, options?: StructuredLogOptions): string {
    let err: unknown = undefined;
    let opts = options;

    if (
      errorOrOptions instanceof Error ||
      (typeof errorOrOptions === 'object' &&
        errorOrOptions !== null &&
        'message' in errorOrOptions &&
        !('module' in errorOrOptions) &&
        !('traceId' in errorOrOptions))
    ) {
      err = errorOrOptions;
    } else if (typeof errorOrOptions === 'object' && errorOrOptions !== null) {
      opts = errorOrOptions as StructuredLogOptions;
    } else if (errorOrOptions !== undefined) {
      err = errorOrOptions;
    }

    const entry = this.buildEntry('ERROR', message, opts, err);
    const json = this.format(entry);
    console.error(json);
    return json;
  }

  public debug(message: string, options?: StructuredLogOptions): string | undefined {
    if (process.env.DEBUG) {
      const entry = this.buildEntry('DEBUG', message, options);
      const json = this.format(entry);
      console.debug(json);
      return json;
    }
    return undefined;
  }

  public child(context: { module?: string; traceId?: string }): StructuredLogger {
    const childModule = context.module ?? this.defaultModule;
    const childTraceId = context.traceId ?? this.defaultTraceId;
    return new StructuredLogger(childModule, childTraceId);
  }

  public static generateTraceId(): string {
    return `tr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
}

export const structuredLogger = new StructuredLogger('app');

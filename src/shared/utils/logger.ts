import {
  StructuredLogger,
  structuredLogger,
  type StructuredLogOptions,
  type StructuredLogEntry,
} from './structuredLogger.js';

export { StructuredLogger, structuredLogger, type StructuredLogOptions, type StructuredLogEntry };

export function isJsonLogging(): boolean {
  return process.env.LOG_FORMAT === 'json';
}

const logger = {
  info: (message: string, options?: StructuredLogOptions): void => {
    if (isJsonLogging()) {
      structuredLogger.info(message, options);
    } else {
      console.log(`[INFO] ${message}`);
    }
  },

  warn: (message: string, options?: StructuredLogOptions): void => {
    if (isJsonLogging()) {
      structuredLogger.warn(message, options);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },

  error: (message: string, errorOrOptions?: unknown, options?: StructuredLogOptions): void => {
    if (isJsonLogging()) {
      structuredLogger.error(message, errorOrOptions, options);
    } else {
      const errorMsg =
        errorOrOptions instanceof Error
          ? ` ${errorOrOptions.message}`
          : typeof errorOrOptions === 'string'
            ? ` ${errorOrOptions}`
            : '';
      console.error(`[ERROR] ${message}${errorMsg}`);
    }
  },

  debug: (message: string, options?: StructuredLogOptions): void => {
    if (isJsonLogging()) {
      structuredLogger.debug(message, options);
    } else if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`);
    }
  },

  child: (context: { module?: string; traceId?: string }): StructuredLogger => {
    return structuredLogger.child(context);
  },

  generateTraceId: (): string => {
    return StructuredLogger.generateTraceId();
  },

  json: structuredLogger,
};

export default logger;

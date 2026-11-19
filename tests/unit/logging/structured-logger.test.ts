import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  StructuredLogger,
  structuredLogger,
  type StructuredLogEntry,
} from '../../../src/shared/utils/structured-logger.js';
import logger from '../../../src/shared/utils/logger.js';

describe('TASK-46.1: Structured JSON Logging Utility (#130)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.LOG_FORMAT;
    delete process.env.DEBUG;
  });

  describe('StructuredLogger class', () => {
    it('formats log entry as a valid single-line JSON string with all mandatory fields', () => {
      const customLogger = new StructuredLogger('CollectorModule', 'trace-col-1234');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = customLogger.info('Job batch ingestion finished', {
        metadata: { batchSize: 25, durationMs: 140 },
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(result);

      expect(parsed.severity).toBe('INFO');
      expect(parsed.module).toBe('CollectorModule');
      expect(parsed.traceId).toBe('trace-col-1234');
      expect(parsed.message).toBe('Job batch ingestion finished');
      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
      expect(parsed.metadata).toEqual({ batchSize: 25, durationMs: 140 });
    });

    it('logs warning events via console.warn with severity WARN', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = structuredLogger.warn('Rate limit approaching', {
        module: 'HttpSource',
        traceId: 'tr_rate_888',
      });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(result);
      expect(parsed.severity).toBe('WARN');
      expect(parsed.module).toBe('HttpSource');
      expect(parsed.traceId).toBe('tr_rate_888');
      expect(parsed.message).toBe('Rate limit approaching');
    });

    it('logs error events with structured Error details (name, message, stack)', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sampleError = new Error('Database connection failed');

      const result = structuredLogger.error('Fatal database error', sampleError, {
        module: 'PostgreSQL',
        traceId: 'tr_db_fail_999',
      });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(result);
      expect(parsed.severity).toBe('ERROR');
      expect(parsed.module).toBe('PostgreSQL');
      expect(parsed.traceId).toBe('tr_db_fail_999');
      expect(parsed.message).toBe('Fatal database error');
      expect(parsed.error).toBeDefined();
      expect(parsed.error?.name).toBe('Error');
      expect(parsed.error?.message).toBe('Database connection failed');
      expect(parsed.error?.stack).toBeDefined();
    });

    it('logs debug events when process.env.DEBUG is set', () => {
      process.env.DEBUG = 'true';
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const result = structuredLogger.debug('Debug cache hit ratio', {
        module: 'RedisCache',
        metadata: { hits: 42, misses: 2 },
      });

      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      const parsed: StructuredLogEntry = JSON.parse(result!);
      expect(parsed.severity).toBe('DEBUG');
      expect(parsed.message).toBe('Debug cache hit ratio');
      expect(parsed.module).toBe('RedisCache');
    });

    it('does not log debug events when process.env.DEBUG is unset', () => {
      delete process.env.DEBUG;
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const result = structuredLogger.debug('Silent debug info');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('supports creating child loggers with contextual module and traceId inheritance', () => {
      const parentLogger = new StructuredLogger('DeliveryEngine', 'trace_parent_root');
      const childLogger = parentLogger.child({ module: 'BatchDispatcher' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = childLogger.info('Dispatched chunk to 25 subscribers');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(result);
      expect(parsed.module).toBe('BatchDispatcher');
      expect(parsed.traceId).toBe('trace_parent_root');
    });

    it('generates unique random trace IDs prefixed with tr_', () => {
      const trace1 = StructuredLogger.generateTraceId();
      const trace2 = StructuredLogger.generateTraceId();

      expect(trace1).toMatch(/^tr_[a-f0-9]{16}$/);
      expect(trace2).toMatch(/^tr_[a-f0-9]{16}$/);
      expect(trace1).not.toBe(trace2);
    });
  });

  describe('Integration with default logger when LOG_FORMAT=json', () => {
    it('outputs structured JSON when LOG_FORMAT=json is enabled', () => {
      process.env.LOG_FORMAT = 'json';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('Structured log via default logger export', {
        module: 'ApiServer',
        traceId: 'tr_req_777',
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const rawLogged = consoleSpy.mock.calls[0][0];
      const parsed: StructuredLogEntry = JSON.parse(rawLogged);
      expect(parsed.severity).toBe('INFO');
      expect(parsed.module).toBe('ApiServer');
      expect(parsed.traceId).toBe('tr_req_777');
      expect(parsed.message).toBe('Structured log via default logger export');
    });
  });
});

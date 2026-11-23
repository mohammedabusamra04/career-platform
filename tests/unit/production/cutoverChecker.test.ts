import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductionCutoverChecker } from '../../../src/modules/production/cutoverChecker.js';
import env from '../../../src/config/env.js';

describe('TASK-49.1: ProductionCutoverChecker Unit Tests (#136)', () => {
  let mockPrisma: any;
  let mockRedis: any;
  let checker: ProductionCutoverChecker;

  beforeEach(() => {
    vi.clearAllMocks();

    if (!env.telegramBotToken) {
      (env as any).telegramBotToken = 'mock_telegram_bot_token_for_ci_test';
    }
    if (!env.databaseUrl) {
      (env as any).databaseUrl = 'postgresql://postgres:postgres@localhost:5432/career_platform?schema=public';
    }
    if (!env.redisUrl) {
      (env as any).redisUrl = 'redis://localhost:6379';
    }

    mockPrisma = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      user: {
        count: vi.fn().mockResolvedValue(9),
        findFirst: vi.fn().mockResolvedValue({ id: 'u_1' }),
      },
      userPreference: {
        count: vi.fn().mockResolvedValue(9),
        findFirst: vi.fn().mockResolvedValue({ id: 'pref_1' }),
      },
      job: {
        findFirst: vi.fn().mockResolvedValue({ id: 'job_1' }),
      },
      sentJob: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sent_1' }),
      },
      deliverySlot: {
        findFirst: vi.fn().mockResolvedValue({ id: 'slot_1' }),
      },
      getPoolMetrics: vi.fn().mockResolvedValue({
        total: 5,
        active: 2,
        idle: 3,
        maxPoolSize: 20,
      }),
    };

    mockRedis = {
      isOpen: true,
      ping: vi.fn().mockResolvedValue('PONG'),
      connect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    };

    checker = new ProductionCutoverChecker(mockPrisma as any, mockRedis as any);
  });

  describe('checkEnvironment', () => {
    it('passes environment check when all critical env vars are configured', async () => {
      const result = await checker.checkEnvironment();
      expect(result.name).toBe('Environment Configuration Validation');
      expect(result.passed).toBe(true);
      expect(result.durationFormatted).toBeDefined();
      expect(result.details).toContain('All critical production environment variables are present');
    });
  });

  describe('checkDatabase', () => {
    it('successfully validates database connectivity, user counts, and pool metrics', async () => {
      const { check, stats } = await checker.checkDatabase();

      expect(check.passed).toBe(true);
      expect(check.durationFormatted).toBeDefined();
      expect(mockPrisma.connect).toHaveBeenCalled();
      expect(mockPrisma.user.count).toHaveBeenCalled();
      expect(mockPrisma.userPreference.count).toHaveBeenCalled();
      expect(stats).toEqual({
        userCount: 9,
        preferenceCount: 9,
        poolTotal: 5,
        poolActive: 2,
        poolIdle: 3,
      });
    });

    it('handles database connection failure gracefully without throwing', async () => {
      mockPrisma.connect.mockRejectedValueOnce(new Error('Connection timed out'));

      const { check, stats } = await checker.checkDatabase();

      expect(check.passed).toBe(false);
      expect(check.details).toContain('Connection timed out');
      expect(stats).toBeUndefined();
    });
  });

  describe('checkTablesIntegrity', () => {
    it('probes all 5 essential relational tables and reports success', async () => {
      const result = await checker.checkTablesIntegrity();

      expect(result.passed).toBe(true);
      expect(mockPrisma.user.findFirst).toHaveBeenCalled();
      expect(mockPrisma.userPreference.findFirst).toHaveBeenCalled();
      expect(mockPrisma.job.findFirst).toHaveBeenCalled();
      expect(mockPrisma.sentJob.findFirst).toHaveBeenCalled();
      expect(mockPrisma.deliverySlot.findFirst).toHaveBeenCalled();
      expect(result.details).toContain('All 5 core relational tables');
    });

    it('reports failure if any table probe query throws', async () => {
      mockPrisma.job.findFirst.mockRejectedValueOnce(new Error('relation "Job" does not exist'));

      const result = await checker.checkTablesIntegrity();

      expect(result.passed).toBe(false);
      expect(result.details).toContain('relation "Job" does not exist');
    });
  });

  describe('checkRedis', () => {
    it('validates Redis connectivity when ping returns PONG', async () => {
      const result = await checker.checkRedis();

      expect(result.passed).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result.details).toContain('PONG');
    });

    it('handles Redis failure cleanly without crashing', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await checker.checkRedis();

      expect(result.passed).toBe(false);
      expect(result.details).toContain('Redis connection refused');
    });
  });

  describe('executePreflight and generateMarkdownReport', () => {
    it('executes full preflight pipeline and produces publication-ready Markdown report', async () => {
      const report = await checker.executePreflight();

      expect(report.allPassed).toBe(true);
      expect(report.checks).toHaveLength(4);
      expect(report.totalDurationFormatted).toBeDefined();

      const markdown = checker.generateMarkdownReport(report);
      expect(markdown).toContain('# Production Deployment & Zero-Downtime Cutover Verification');
      expect(markdown).toContain('READY FOR ZERO-DOWNTIME CUTOVER');
      expect(markdown).toContain('Environment Configuration Validation');
      expect(markdown).toContain('Lakebase PostgreSQL Connectivity & Schema');
      expect(markdown).toContain('PostgreSQL Relational Tables Schema Integrity');
      expect(markdown).toContain('Redis Cache & State Store Ping');
      expect(markdown).toContain('Active Migrated Users');
    });

    it('marks verdict as CUTOVER BLOCKED when any check fails', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('Redis offline'));

      const report = await checker.executePreflight();

      expect(report.allPassed).toBe(false);
      const markdown = checker.generateMarkdownReport(report);
      expect(markdown).toContain('CUTOVER BLOCKED');
    });
  });
});

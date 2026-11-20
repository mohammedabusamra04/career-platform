import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PrismaService,
  buildDatabaseUrl,
} from '../../../src/shared/database/prisma.service.js';

describe('TASK-20.2: PrismaService & Connection Pooling', () => {
  afterEach(async () => {
    await PrismaService.resetInstanceForTesting();
  });

  describe('buildDatabaseUrl', () => {
    it('should append connection_limit and pool_timeout to clean PostgreSQL URL', () => {
      const base = 'postgresql://postgres:secret@localhost:5432/career_platform?schema=public';
      const tuned = buildDatabaseUrl(base, 25, 10);

      const parsed = new URL(tuned);
      expect(parsed.searchParams.get('connection_limit')).toBe('25');
      expect(parsed.searchParams.get('pool_timeout')).toBe('10');
      expect(parsed.searchParams.get('schema')).toBe('public');
    });

    it('should preserve custom connection_limit and pool_timeout if already provided in URL', () => {
      const base = 'postgresql://localhost:5432/db?connection_limit=50&pool_timeout=15';
      const tuned = buildDatabaseUrl(base, 25, 10);

      const parsed = new URL(tuned);
      expect(parsed.searchParams.get('connection_limit')).toBe('50');
      expect(parsed.searchParams.get('pool_timeout')).toBe('15');
    });

    it('should fallback gracefully if URL is malformed', () => {
      const malformed = 'not-a-valid-url';
      expect(buildDatabaseUrl(malformed, 20, 10)).toBe(malformed);
    });
  });

  describe('PrismaService Singleton', () => {
    it('should return the exact same instance on multiple calls', () => {
      const instance1 = PrismaService.getInstance();
      const instance2 = PrismaService.getInstance();

      expect(instance1 === instance2).toBe(true);
    });
  });

  describe('Concurrency & Connection Resiliency', () => {
    it('should safely execute 50 parallel operations without unhandled connection leaks', async () => {
      const service = PrismaService.getInstance();

      // Mock $queryRawUnsafe to simulate rapid concurrent database reads
      const mockQueryRaw = vi.spyOn(service, '$queryRawUnsafe').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [{ count: 1 }];
      });

      const CONCURRENCY_LIMIT = 50;
      const tasks = Array.from({ length: CONCURRENCY_LIMIT }, (_, index) =>
        service.$queryRawUnsafe(`SELECT ${index}`),
      );

      const results = await Promise.all(tasks);

      expect(results).toHaveLength(CONCURRENCY_LIMIT);
      expect(mockQueryRaw).toHaveBeenCalledTimes(CONCURRENCY_LIMIT);

      mockQueryRaw.mockRestore();
    });

    it('should report healthy ping when database is responding', async () => {
      const service = PrismaService.getInstance();
      const mockQueryRaw = vi.spyOn(service, '$queryRawUnsafe').mockResolvedValue([{ 1: 1 }]);

      const isHealthy = await service.ping();
      expect(isHealthy).toBe(true);

      mockQueryRaw.mockRestore();
    });

    it('should report false ping when database query fails', async () => {
      const service = PrismaService.getInstance();
      const mockQueryRaw = vi
        .spyOn(service, '$queryRawUnsafe')
        .mockRejectedValue(new Error('Connection refused'));

      const isHealthy = await service.ping();
      expect(isHealthy).toBe(false);

      mockQueryRaw.mockRestore();
    });
  });
});

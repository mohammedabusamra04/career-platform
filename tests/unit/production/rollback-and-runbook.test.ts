import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RollbackManager } from '../../../src/modules/production/rollback-manager.js';
import fs from 'fs';
import path from 'path';

describe('TASK-49.2: RollbackManager Unit Tests (#137)', () => {
  let mockPrisma: any;
  let mockRedis: any;
  let manager: RollbackManager;
  const tempTestDir = path.resolve(process.cwd(), 'backup_test_tmp');

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'u_1' }),
      },
    };

    mockRedis = {
      isOpen: true,
      sAdd: vi.fn().mockResolvedValue(1),
      hSet: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
    };

    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }

    manager = new RollbackManager(mockPrisma as any, mockRedis as any, tempTestDir);
  });

  describe('listSnapshots', () => {
    it('returns empty array when no snapshot files exist in directory', () => {
      const list = manager.listSnapshots();
      expect(list).toEqual([]);
    });

    it('identifies and validates snapshot files with array or wrapped records', () => {
      const snapFile = path.join(tempTestDir, 'redis-migration-snapshot-test1.json');
      fs.writeFileSync(
        snapFile,
        JSON.stringify({
          timestamp: '2026-11-20T20:00:00Z',
          totalSubscribers: 2,
          records: [
            { telegramId: '12345', rawPreferences: { specialization: 'BACKEND' } },
            { telegramId: '67890', rawPreferences: { specialization: 'FRONTEND' } },
          ],
        }),
      );

      const list = manager.listSnapshots();
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('redis-migration-snapshot-test1.json');
      expect(list[0].subscriberCount).toBe(2);
      expect(list[0].valid).toBe(true);

      fs.unlinkSync(snapFile);
    });
  });

  describe('restoreFromSnapshot', () => {
    it('restores subscriber records into Redis and PostgreSQL with execution duration telemetry', async () => {
      const snapFile = path.join(tempTestDir, 'redis-migration-snapshot-restore.json');
      fs.writeFileSync(
        snapFile,
        JSON.stringify({
          timestamp: '2026-11-20T20:00:00Z',
          records: [
            { telegramId: '111', rawPreferences: { specialization: 'BACKEND' } },
            { telegramId: '222', rawPreferences: { specialization: 'FRONTEND' } },
          ],
        }),
      );

      const result = await manager.restoreFromSnapshot(snapFile);

      expect(result.success).toBe(true);
      expect(result.restoredCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.durationFormatted).toBeDefined();
      expect(mockRedis.sAdd).toHaveBeenCalledTimes(2);
      expect(mockRedis.hSet).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(2);

      fs.unlinkSync(snapFile);
    });

    it('handles missing snapshot path cleanly without crashing', async () => {
      const result = await manager.restoreFromSnapshot('non-existent-path.json');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Snapshot file not found');
    });
  });

  describe('Emergency Pause Mode', () => {
    it('sets emergency:delivery:pause in Redis when pause is activated', async () => {
      const success = await manager.setEmergencyPause(true);

      expect(success).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith('emergency:delivery:pause', 'true');
    });

    it('deletes emergency:delivery:pause in Redis when pause is lifted', async () => {
      const success = await manager.setEmergencyPause(false);

      expect(success).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('emergency:delivery:pause');
    });

    it('correctly queries emergency paused status', async () => {
      mockRedis.get.mockResolvedValueOnce('true');
      const isPaused = await manager.isEmergencyPaused();
      expect(isPaused).toBe(true);

      mockRedis.get.mockResolvedValueOnce(null);
      const isResumed = await manager.isEmergencyPaused();
      expect(isResumed).toBe(false);
    });
  });
});


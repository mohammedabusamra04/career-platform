import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executePipelineWorker,
  type PipelineWorkerDeps,
} from '../../../src/scripts/runPipeline.js';
import {
  JOB_PIPELINE_ADVISORY_LOCK_ID,
  type IAdvisoryLockService,
} from '../../../src/shared/database/advisoryLock.service.js';
import { JobPipelineService } from '../../../src/modules/jobs/job.pipeline.service.js';
import logger from '../../../src/shared/utils/logger.js';
import env, { validateEnv } from '../../../src/config/env.js';

vi.mock('../../../src/config/redis.js', () => ({
  default: {
    isOpen: true,
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue(undefined),
  },
  connectRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/shared/database/prisma.service.js', () => ({
  prisma: {
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TASK-46.2: Distributed Advisory Locking for Pipeline & Sender (#131)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executePipelineWorker - Acceptance Criteria', () => {
    it('uses SELECT pg_try_advisory_lock(:lockId) at pipeline start, executes pipeline, and releases lock in finally block', async () => {
      const callOrder: string[] = [];

      const mockLockService: IAdvisoryLockService = {
        tryAcquire: vi.fn().mockImplementation(async (lockId: number) => {
          callOrder.push(`tryAcquire:${lockId}`);
          return true;
        }),
        release: vi.fn().mockImplementation(async (lockId: number) => {
          callOrder.push(`release:${lockId}`);
          return true;
        }),
        withLock: vi.fn(),
      };

      const mockPipelineService = {
        run: vi.fn().mockImplementation(async () => {
          callOrder.push('pipeline:run');
          return { subscribers: 5, processed: 5 };
        }),
      };

      const mockScheduleService = {
        getLatestDueSlot: vi.fn().mockReturnValue({
          key: '2026-11-19:2100',
          lagMinutes: 10,
        }),
      } as any;

      const outcome = await executePipelineWorker({
        advisoryLock: mockLockService,
        pipelineService: mockPipelineService,
        scheduleService: mockScheduleService,
      });

      expect(outcome.executed).toBe(true);
      expect(mockLockService.tryAcquire).toHaveBeenCalledWith(JOB_PIPELINE_ADVISORY_LOCK_ID);
      expect(mockPipelineService.run).toHaveBeenCalledTimes(1);
      expect(mockLockService.release).toHaveBeenCalledWith(JOB_PIPELINE_ADVISORY_LOCK_ID);

      // Verify exact chronological execution sequence
      expect(callOrder).toEqual([
        `tryAcquire:${JOB_PIPELINE_ADVISORY_LOCK_ID}`,
        'pipeline:run',
        `release:${JOB_PIPELINE_ADVISORY_LOCK_ID}`,
      ]);
    });

    it('unconditionally releases advisory lock in finally block even when pipeline execution throws', async () => {
      const mockLockService: IAdvisoryLockService = {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        withLock: vi.fn(),
      };

      const mockPipelineService = {
        run: vi.fn().mockRejectedValue(new Error('Downstream Telegram API outage')),
      };

      const mockScheduleService = {
        getLatestDueSlot: vi.fn().mockReturnValue({
          key: '2026-11-19:2100',
          lagMinutes: 5,
        }),
      } as any;

      await expect(
        executePipelineWorker({
          advisoryLock: mockLockService,
          pipelineService: mockPipelineService,
          scheduleService: mockScheduleService,
        }),
      ).rejects.toThrow('Downstream Telegram API outage');

      // Verify lock was released despite the throw
      expect(mockLockService.release).toHaveBeenCalledTimes(1);
      expect(mockLockService.release).toHaveBeenCalledWith(JOB_PIPELINE_ADVISORY_LOCK_ID);
    });

    it('exits cleanly with log "Pipeline already running in another process" when lock is not acquired', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');

      const mockLockService: IAdvisoryLockService = {
        tryAcquire: vi.fn().mockResolvedValue(false), // Lock is already held by another process
        release: vi.fn(),
        withLock: vi.fn(),
      };

      const mockPipelineService = {
        run: vi.fn(),
      };

      const outcome = await executePipelineWorker({
        advisoryLock: mockLockService,
        pipelineService: mockPipelineService,
      });

      expect(outcome.executed).toBe(false);
      expect(outcome.reason).toBe('Pipeline already running in another process');

      // Verify required log message
      expect(warnSpy).toHaveBeenCalledWith('Pipeline already running in another process');

      // Pipeline run must never have been called
      expect(mockPipelineService.run).not.toHaveBeenCalled();

      // Release must not be called because this worker never acquired the lock
      expect(mockLockService.release).not.toHaveBeenCalled();
    });

    it('Test Specification: Run two worker instances concurrently; verify exactly one executes while the other exits cleanly', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');

      // Shared simulated advisory lock state
      let lockHeld = false;
      const executedWorkers: string[] = [];
      const exitedWorkers: string[] = [];

      const createWorkerLock = (workerName: string): IAdvisoryLockService => ({
        tryAcquire: vi.fn().mockImplementation(async (lockId: number) => {
          if (lockId === JOB_PIPELINE_ADVISORY_LOCK_ID && !lockHeld) {
            lockHeld = true;
            return true;
          }
          return false;
        }),
        release: vi.fn().mockImplementation(async (lockId: number) => {
          if (lockId === JOB_PIPELINE_ADVISORY_LOCK_ID) {
            lockHeld = false;
            return true;
          }
          return false;
        }),
        withLock: vi.fn(),
      });

      const worker1Lock = createWorkerLock('Worker-1');
      const worker2Lock = createWorkerLock('Worker-2');

      const worker1Pipeline = {
        run: vi.fn().mockImplementation(async () => {
          executedWorkers.push('Worker-1');
          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { subscribers: 10, processed: 10 };
        }),
      };

      const worker2Pipeline = {
        run: vi.fn().mockImplementation(async () => {
          executedWorkers.push('Worker-2');
          return { subscribers: 10, processed: 10 };
        }),
      };

      const mockScheduleService = {
        getLatestDueSlot: vi.fn().mockReturnValue(null),
      } as any;

      // Launch both worker instances concurrently
      const [outcome1, outcome2] = await Promise.all([
        executePipelineWorker({
          advisoryLock: worker1Lock,
          pipelineService: worker1Pipeline,
          scheduleService: mockScheduleService,
        }),
        executePipelineWorker({
          advisoryLock: worker2Lock,
          pipelineService: worker2Pipeline,
          scheduleService: mockScheduleService,
        }),
      ]);

      // Verify exactly one worker executed and the other exited cleanly
      const executedOutcomes = [outcome1, outcome2].filter((o) => o.executed);
      const skippedOutcomes = [outcome1, outcome2].filter((o) => !o.executed);

      expect(executedOutcomes).toHaveLength(1);
      expect(skippedOutcomes).toHaveLength(1);

      expect(executedWorkers).toHaveLength(1);
      expect(worker2Pipeline.run).not.toHaveBeenCalled();

      expect(skippedOutcomes[0].reason).toBe('Pipeline already running in another process');
      expect(warnSpy).toHaveBeenCalledWith('Pipeline already running in another process');

      // Verify the lock was freed after Worker-1 completed
      expect(lockHeld).toBe(false);
    });
  });

  describe('JobPipelineService with advisory lock integration', () => {
    it('guards JobPipelineService.run() with advisory lock and releases in finally', async () => {
      const mockAdvisoryLock: IAdvisoryLockService = {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        withLock: vi.fn(),
      };

      const subscriptionService = {
        getSubscribedUsers: vi.fn().mockResolvedValue([]),
        isSubscribed: vi.fn().mockResolvedValue(true),
      };

      const service = new JobPipelineService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        subscriptionService as any,
        {} as any,
        {} as any,
        {} as any,
        mockAdvisoryLock,
      );

      const result = await service.run();

      expect(result.executed).toBe(true);
      expect(mockAdvisoryLock.tryAcquire).toHaveBeenCalledWith(JOB_PIPELINE_ADVISORY_LOCK_ID);
      expect(mockAdvisoryLock.release).toHaveBeenCalledWith(JOB_PIPELINE_ADVISORY_LOCK_ID);
    });

    it('returns skipped result and logs warning when lock cannot be acquired on JobPipelineService', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');

      const mockAdvisoryLock: IAdvisoryLockService = {
        tryAcquire: vi.fn().mockResolvedValue(false),
        release: vi.fn(),
        withLock: vi.fn(),
      };

      const subscriptionService = {
        getSubscribedUsers: vi.fn(),
      };

      const service = new JobPipelineService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        subscriptionService as any,
        {} as any,
        {} as any,
        {} as any,
        mockAdvisoryLock,
      );

      const result = await service.run();

      expect(result.executed).toBe(false);
      expect(result.skippedReason).toBe('Pipeline already running in another process');
      expect(warnSpy).toHaveBeenCalledWith('Pipeline already running in another process');
      expect(subscriptionService.getSubscribedUsers).not.toHaveBeenCalled();
      expect(mockAdvisoryLock.release).not.toHaveBeenCalled();
    });
  });

  describe('Environment Configuration & Security', () => {
    it('supports customizable advisory lock IDs via environment variables with safe defaults', () => {
      // Test default values
      expect(env.jobCollectionLockId).toBe(824401);
      expect(env.digestDeliveryLockId).toBe(824402);
      expect(env.jobPipelineLockId).toBe(824403);

      // Test custom environment values parsed through Zod schema
      const customEnv = validateEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/career_platform?schema=public',
        JOB_COLLECTION_LOCK_ID: '900001',
        DIGEST_DELIVERY_LOCK_ID: '900002',
        JOB_PIPELINE_LOCK_ID: '900003',
      });

      expect(customEnv.JOB_COLLECTION_LOCK_ID).toBe(900001);
      expect(customEnv.DIGEST_DELIVERY_LOCK_ID).toBe(900002);
      expect(customEnv.JOB_PIPELINE_LOCK_ID).toBe(900003);
    });
  });
});

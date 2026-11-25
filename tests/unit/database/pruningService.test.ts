import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import {
  PruningService,
  RETENTION_POLICIES,
} from '../../../src/shared/database/pruning.service.js';

describe('PruningService - Data Retention & Pruning Lifecycle (TASK-24.2)', () => {
  let mockPrisma: any;
  let service: PruningService;

  const fixedNow = new Date('2026-10-28T12:00:00.000Z');

  beforeEach(() => {
    mockPrisma = {
      sentJob: {
        deleteMany: vi.fn(),
      },
      job: {
        deleteMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      deliverySlot: {
        deleteMany: vi.fn(),
      },
    };

    service = new PruningService(mockPrisma as unknown as PrismaClient);
  });

  describe('RETENTION_POLICIES Constants', () => {
    it('defines expected default retention windows using ms', () => {
      expect(RETENTION_POLICIES.SENT_JOBS).toBe(ms('60d'));
      expect(RETENTION_POLICIES.CLOSED_JOBS).toBe(ms('30d'));
      expect(RETENTION_POLICIES.DELIVERY_SLOTS).toBe(ms('30d'));
    });
  });

  describe('pruneSentJobs', () => {
    it('deletes SentJob records older than 60 days by default', async () => {
      mockPrisma.sentJob.deleteMany.mockResolvedValue({ count: 125 });

      const deletedCount = await service.pruneSentJobs(undefined, fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('60d'));
      expect(mockPrisma.sentJob.deleteMany).toHaveBeenCalledWith({
        where: {
          sentAt: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(125);
    });

    it('allows custom retention duration in ms for sent jobs', async () => {
      mockPrisma.sentJob.deleteMany.mockResolvedValue({ count: 42 });

      const deletedCount = await service.pruneSentJobs(ms('90d'), fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('90d'));
      expect(mockPrisma.sentJob.deleteMany).toHaveBeenCalledWith({
        where: {
          sentAt: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(42);
    });
  });

  describe('pruneClosedJobs', () => {
    it('deletes only CLOSED Job records older than 30 days by default', async () => {
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 50 });

      const deletedCount = await service.pruneClosedJobs(undefined, fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('30d'));
      expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'CLOSED',
          lastSeenAt: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(50);
    });

    it('allows custom retention duration in ms for closed jobs', async () => {
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 15 });

      const deletedCount = await service.pruneClosedJobs(ms('14d'), fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('14d'));
      expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'CLOSED',
          lastSeenAt: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(15);
    });
  });

  describe('pruneDeliverySlots', () => {
    it('deletes DeliverySlot records older than 30 days by default', async () => {
      mockPrisma.deliverySlot.deleteMany.mockResolvedValue({ count: 18 });

      const deletedCount = await service.pruneDeliverySlots(undefined, fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('30d'));
      expect(mockPrisma.deliverySlot.deleteMany).toHaveBeenCalledWith({
        where: {
          scheduledTime: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(18);
    });

    it('allows custom retention duration in ms for delivery slots', async () => {
      mockPrisma.deliverySlot.deleteMany.mockResolvedValue({ count: 5 });

      const deletedCount = await service.pruneDeliverySlots(ms('45d'), fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - ms('45d'));
      expect(mockPrisma.deliverySlot.deleteMany).toHaveBeenCalledWith({
        where: {
          scheduledTime: {
            lt: expectedCutoff,
          },
        },
      });
      expect(deletedCount).toBe(5);
    });
  });

  describe('markStaleActiveJobsAsExpired', () => {
    it('marks stored ACTIVE jobs older than 21 days as EXPIRED', async () => {
      mockPrisma.job.updateMany.mockResolvedValue({ count: 18 });

      const count = await service.markStaleActiveJobsAsExpired(21, fixedNow);

      const expectedCutoff = new Date(fixedNow.getTime() - 21 * 24 * 60 * 60 * 1000);
      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          publishedAt: { lt: expectedCutoff },
        },
        data: {
          status: 'EXPIRED',
        },
      });
      expect(count).toBe(18);
    });
  });

  describe('runAllPruning', () => {
    it('executes all pruning routines and aggregates results', async () => {
      mockPrisma.sentJob.deleteMany.mockResolvedValue({ count: 100 });
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 40 });
      mockPrisma.deliverySlot.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.runAllPruning({ now: fixedNow });

      expect(result.sentJobsDeleted).toBe(100);
      expect(result.closedJobsDeleted).toBe(40);
      expect(result.deliverySlotsDeleted).toBe(10);
      expect(result.totalDeleted).toBe(150);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('honors customized retention durations in runAllPruning options', async () => {
      mockPrisma.sentJob.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.job.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.deliverySlot.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.runAllPruning({
        sentJobsRetentionMs: ms('45d'),
        closedJobsRetentionMs: ms('15d'),
        deliverySlotsRetentionMs: ms('20d'),
        now: fixedNow,
      });

      const expectedSentCutoff = new Date(fixedNow.getTime() - ms('45d'));
      const expectedClosedCutoff = new Date(fixedNow.getTime() - ms('15d'));
      const expectedSlotCutoff = new Date(fixedNow.getTime() - ms('20d'));

      expect(mockPrisma.sentJob.deleteMany).toHaveBeenCalledWith({
        where: { sentAt: { lt: expectedSentCutoff } },
      });
      expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
        where: { status: 'CLOSED', lastSeenAt: { lt: expectedClosedCutoff } },
      });
      expect(mockPrisma.deliverySlot.deleteMany).toHaveBeenCalledWith({
        where: { scheduledTime: { lt: expectedSlotCutoff } },
      });

      expect(result.totalDeleted).toBe(10);
    });
  });

  describe('reclassifyActiveJobs', () => {
    it('reclassifies misclassified jobs (e.g. QA -> BACKEND for Remote Laravel PHP Dev)', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        {
          id: 'job-1',
          title: 'Remote Laravel PHP Dev',
          description: 'Build backend APIs with Laravel and MySQL. Coordinate with QA.',
          skills: ['PHP', 'Laravel'],
          country: null,
          location: 'Remote',
          primarySpecialization: 'QA',
          secondarySpecialization: null,
          remoteScope: 'LOCAL_ONLY',
          experienceLevel: 'JUNIOR',
          workType: 'FULL_TIME',
        },
      ]);

      const result = await service.reclassifyActiveJobs();

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          primarySpecialization: 'BACKEND',
          secondarySpecialization: null,
          remoteScope: 'UNKNOWN',
          experienceLevel: 'UNKNOWN',
          workType: 'UNKNOWN',
        },
      });
      expect(result.updatedCount).toBe(1);
      expect(result.closedOrExpiredCount).toBe(0);
    });

    it('closes jobs that fail negative exclusion during reclassify', async () => {
      mockPrisma.job.findMany.mockResolvedValue([
        {
          id: 'job-2',
          title: 'Customer Service Representative',
          description: 'Answer customer calls.',
          skills: [],
          country: null,
          location: 'Remote',
          primarySpecialization: 'BACKEND',
          secondarySpecialization: null,
          remoteScope: 'UNKNOWN',
          experienceLevel: 'MID',
          workType: 'FULL_TIME',
        },
      ]);

      const result = await service.reclassifyActiveJobs();

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-2' },
        data: { status: 'CLOSED' },
      });
      expect(result.closedOrExpiredCount).toBe(1);
      expect(result.updatedCount).toBe(0);
    });
  });
});

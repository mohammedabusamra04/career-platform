import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaSentJobRepository,
  getFeedbackToastMessage,
  type DeliveryRecordInput,
} from '../../../src/modules/notifications/index.js';

describe('PrismaSentJobRepository - Delivery History & Feedback (TASK-23)', () => {
  let mockPrisma: any;
  let repository: PrismaSentJobRepository;

  beforeEach(() => {
    mockPrisma = {
      sentJob: {
        createMany: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    repository = new PrismaSentJobRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('recordBatchSent (TASK-23.1)', () => {
    it('records batch of deliveries with skipDuplicates: true for idempotency', async () => {
      const fixedDate = new Date('2026-10-27T10:00:00Z');
      const deliveries: DeliveryRecordInput[] = [
        { userId: 'u1', jobId: 'j1', sentAt: fixedDate },
        { userId: 'u1', jobId: 'j2', sentAt: fixedDate },
        { userId: 'u2', jobId: 'j1', sentAt: fixedDate },
      ];

      mockPrisma.sentJob.createMany.mockResolvedValue({ count: 3 });

      await repository.recordBatchSent(deliveries);

      expect(mockPrisma.sentJob.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u1', jobId: 'j1', sentAt: fixedDate, feedback: 'NONE' },
          { userId: 'u1', jobId: 'j2', sentAt: fixedDate, feedback: 'NONE' },
          { userId: 'u2', jobId: 'j1', sentAt: fixedDate, feedback: 'NONE' },
        ],
        skipDuplicates: true,
      });
    });

    it('handles empty deliveries array without executing query', async () => {
      await repository.recordBatchSent([]);

      expect(mockPrisma.sentJob.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getSentJobIdsForUser (TASK-23.1)', () => {
    it('returns a Set of job IDs sent to the specified user', async () => {
      mockPrisma.sentJob.findMany.mockResolvedValue([
        { jobId: 'job-1' },
        { jobId: 'job-2' },
      ]);

      const sentSet = await repository.getSentJobIdsForUser('user-1');

      expect(mockPrisma.sentJob.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { jobId: true },
      });
      expect(sentSet).toBeInstanceOf(Set);
      expect(sentSet.size).toBe(2);
      expect(sentSet.has('job-1')).toBe(true);
      expect(sentSet.has('job-2')).toBe(true);
      expect(sentSet.has('job-3')).toBe(false);
    });

    it('returns empty Set when user has no sent history', async () => {
      mockPrisma.sentJob.findMany.mockResolvedValue([]);

      const sentSet = await repository.getSentJobIdsForUser('new-user');

      expect(sentSet.size).toBe(0);
    });
  });

  describe('isJobSentToUser (TASK-23.1)', () => {
    it('returns true when job has been sent to user via composite key lookup', async () => {
      mockPrisma.sentJob.findUnique.mockResolvedValue({ id: 'sent-uuid-1' });

      const result = await repository.isJobSentToUser('user-1', 'job-1');

      expect(mockPrisma.sentJob.findUnique).toHaveBeenCalledWith({
        where: {
          userId_jobId: {
            userId: 'user-1',
            jobId: 'job-1',
          },
        },
        select: { id: true },
      });
      expect(result).toBe(true);
    });

    it('returns false when job has not been sent to user', async () => {
      mockPrisma.sentJob.findUnique.mockResolvedValue(null);

      const result = await repository.isJobSentToUser('user-1', 'job-999');

      expect(result).toBe(false);
    });
  });

  describe('filterUnsentJobsForUser (TASK-23.1)', () => {
    it('excludes job J1 for user U1 after it was recorded as sent, but retains J1 for user U2', async () => {
      mockPrisma.sentJob.findMany.mockImplementation(async (args: any) => {
        if (args.where.userId === 'user-1') {
          return [{ jobId: 'job-1' }];
        }
        if (args.where.userId === 'user-2') {
          return [];
        }
        return [];
      });

      const candidateJobs = ['job-1', 'job-2', 'job-3'];

      const unsentForU1 = await repository.filterUnsentJobsForUser('user-1', candidateJobs);
      expect(unsentForU1).toEqual(['job-2', 'job-3']);

      const unsentForU2 = await repository.filterUnsentJobsForUser('user-2', candidateJobs);
      expect(unsentForU2).toEqual(['job-1', 'job-2', 'job-3']);
    });

    it('returns empty array when candidate list is empty', async () => {
      const result = await repository.filterUnsentJobsForUser('user-1', []);
      expect(result).toEqual([]);
      expect(mockPrisma.sentJob.findMany).not.toHaveBeenCalled();
    });
  });

  describe('recordFeedback (TASK-23.2)', () => {
    it('updates feedback from NONE to LIKE and returns updated entity', async () => {
      const mockRecord = {
        id: 'sent-1',
        userId: 'user-1',
        jobId: 'job-1',
        sentAt: new Date('2026-10-27T10:00:00Z'),
        feedback: 'LIKE',
      };

      mockPrisma.sentJob.upsert.mockResolvedValue(mockRecord);

      const result = await repository.recordFeedback('user-1', 'job-1', 'LIKE');

      expect(mockPrisma.sentJob.upsert).toHaveBeenCalledWith({
        where: {
          userId_jobId: {
            userId: 'user-1',
            jobId: 'job-1',
          },
        },
        update: {
          feedback: 'LIKE',
        },
        create: {
          userId: 'user-1',
          jobId: 'job-1',
          feedback: 'LIKE',
        },
      });

      expect(result.feedback).toBe('LIKE');
    });

    it('updates feedback from LIKE to DISLIKE idempotently', async () => {
      const mockRecord = {
        id: 'sent-1',
        userId: 'user-1',
        jobId: 'job-1',
        sentAt: new Date('2026-10-27T10:00:00Z'),
        feedback: 'DISLIKE',
      };

      mockPrisma.sentJob.upsert.mockResolvedValue(mockRecord);

      const result = await repository.recordFeedback('user-1', 'job-1', 'DISLIKE');

      expect(result.feedback).toBe('DISLIKE');
      expect(mockPrisma.sentJob.upsert).toHaveBeenCalled();
    });
  });

  describe('getFeedback & getFeedbackStats (TASK-23.2)', () => {
    it('returns feedback state when record exists or null when not found', async () => {
      mockPrisma.sentJob.findUnique.mockResolvedValueOnce({ feedback: 'LIKE' });
      const feedback = await repository.getFeedback('user-1', 'job-1');
      expect(feedback).toBe('LIKE');

      mockPrisma.sentJob.findUnique.mockResolvedValueOnce(null);
      const notFound = await repository.getFeedback('user-1', 'job-999');
      expect(notFound).toBeNull();
    });

    it('aggregates feedback statistics for a given job', async () => {
      mockPrisma.sentJob.findMany.mockResolvedValue([
        { feedback: 'LIKE' },
        { feedback: 'LIKE' },
        { feedback: 'DISLIKE' },
        { feedback: 'NONE' },
      ]);

      const stats = await repository.getFeedbackStats('job-1');

      expect(mockPrisma.sentJob.findMany).toHaveBeenCalledWith({
        where: { jobId: 'job-1' },
        select: { feedback: true },
      });
      expect(stats).toEqual({
        likes: 2,
        dislikes: 1,
        none: 1,
        totalSent: 4,
      });
    });
  });

  describe('getFeedbackToastMessage (TASK-23.2)', () => {
    it('returns correct localized toast response message for Arabic (default)', () => {
      expect(getFeedbackToastMessage('LIKE')).toBe('تم تسجيل تقييمك بنجاح 👍');
      expect(getFeedbackToastMessage('DISLIKE')).toBe('تم تسجيل تقييمك بنجاح 👎');
      expect(getFeedbackToastMessage('NONE')).toBe('تم تحديث تقييمك بنجاح');
    });

    it('returns correct localized toast response message for English', () => {
      expect(getFeedbackToastMessage('LIKE', 'en')).toBe('Feedback recorded successfully! 👍');
      expect(getFeedbackToastMessage('DISLIKE', 'en')).toBe('Feedback recorded successfully! 👎');
      expect(getFeedbackToastMessage('NONE', 'en')).toBe('Feedback updated successfully!');
    });
  });

  describe('countSentJobs & deleteSentHistoryForUser', () => {
    it('counts all sent jobs or filters by userId', async () => {
      mockPrisma.sentJob.count.mockResolvedValue(100);

      const totalCount = await repository.countSentJobs();
      expect(mockPrisma.sentJob.count).toHaveBeenCalledWith({ where: undefined });
      expect(totalCount).toBe(100);

      await repository.countSentJobs('user-1');
      expect(mockPrisma.sentJob.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('deletes sent history for a given userId', async () => {
      mockPrisma.sentJob.deleteMany.mockResolvedValue({ count: 5 });

      await repository.deleteSentHistoryForUser('user-1');

      expect(mockPrisma.sentJob.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });
});

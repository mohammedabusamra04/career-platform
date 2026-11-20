import type {
  PrismaClient,
  SentJob as PrismaSentJobRecord,
  FeedbackType,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../../shared/database/prisma.service.js';
import type {
  ISentJobRepository,
  SentJobEntity,
  DeliveryRecordInput,
  FeedbackStats,
} from './sent-job.repository.interface.js';

export type SupportedLocale = 'ar' | 'en';

export function getFeedbackToastMessage(
  feedback: FeedbackType,
  locale: SupportedLocale = 'ar',
): string {
  if (locale === 'en') {
    switch (feedback) {
      case 'LIKE':
        return 'Feedback recorded successfully! 👍';
      case 'DISLIKE':
        return 'Feedback recorded successfully! 👎';
      case 'NONE':
      default:
        return 'Feedback updated successfully!';
    }
  }

  switch (feedback) {
    case 'LIKE':
      return 'تم تسجيل تقييمك بنجاح 👍';
    case 'DISLIKE':
      return 'تم تسجيل تقييمك بنجاح 👎';
    case 'NONE':
    default:
      return 'تم تحديث تقييمك بنجاح';
  }
}

export class PrismaSentJobRepository implements ISentJobRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async recordBatchSent(deliveries: DeliveryRecordInput[]): Promise<void> {
    if (!deliveries || deliveries.length === 0) {
      return;
    }

    const data = deliveries.map((d) => ({
      userId: d.userId,
      jobId: d.jobId,
      sentAt: d.sentAt ?? new Date(),
      feedback: d.feedback ?? 'NONE',
    }));

    await this.db.sentJob.createMany({
      data,
      skipDuplicates: true,
    });
  }

  public async getSentJobIdsForUser(userId: string): Promise<Set<string>> {
    const records = await this.db.sentJob.findMany({
      where: { userId },
      select: { jobId: true },
    });

    return new Set(records.map((r) => r.jobId));
  }

  public async isJobSentToUser(userId: string, jobId: string): Promise<boolean> {
    const record = await this.db.sentJob.findUnique({
      where: {
        userId_jobId: {
          userId,
          jobId,
        },
      },
      select: { id: true },
    });

    return Boolean(record);
  }

  public async filterUnsentJobsForUser(
    userId: string,
    candidateJobIds: string[],
  ): Promise<string[]> {
    if (!candidateJobIds || candidateJobIds.length === 0) {
      return [];
    }

    const sentRecords = await this.db.sentJob.findMany({
      where: {
        userId,
        jobId: {
          in: candidateJobIds,
        },
      },
      select: { jobId: true },
    });

    const sentSet = new Set(sentRecords.map((r) => r.jobId));
    return candidateJobIds.filter((jobId) => !sentSet.has(jobId));
  }

  public async countSentJobs(userId?: string): Promise<number> {
    return this.db.sentJob.count({
      where: userId ? { userId } : undefined,
    });
  }

  public async deleteSentHistoryForUser(userId: string): Promise<void> {
    await this.db.sentJob.deleteMany({
      where: { userId },
    });
  }

  public async recordFeedback(
    userId: string,
    jobId: string,
    feedback: FeedbackType,
  ): Promise<SentJobEntity> {
    const record = await this.db.sentJob.upsert({
      where: {
        userId_jobId: {
          userId,
          jobId,
        },
      },
      update: {
        feedback,
      },
      create: {
        userId,
        jobId,
        feedback,
      },
    });

    return this.mapToEntity(record);
  }

  public async getFeedback(userId: string, jobId: string): Promise<FeedbackType | null> {
    const record = await this.db.sentJob.findUnique({
      where: {
        userId_jobId: {
          userId,
          jobId,
        },
      },
      select: { feedback: true },
    });

    return record ? record.feedback : null;
  }

  public async getFeedbackStats(jobId: string): Promise<FeedbackStats> {
    const records = await this.db.sentJob.findMany({
      where: { jobId },
      select: { feedback: true },
    });

    let likes = 0;
    let dislikes = 0;
    let none = 0;

    for (const r of records) {
      if (r.feedback === 'LIKE') likes++;
      else if (r.feedback === 'DISLIKE') dislikes++;
      else none++;
    }

    return {
      likes,
      dislikes,
      none,
      totalSent: records.length,
    };
  }

  private mapToEntity(row: PrismaSentJobRecord): SentJobEntity {
    return {
      id: row.id,
      userId: row.userId,
      jobId: row.jobId,
      sentAt: row.sentAt,
      feedback: row.feedback,
    };
  }
}

export const sentJobRepository = new PrismaSentJobRepository();

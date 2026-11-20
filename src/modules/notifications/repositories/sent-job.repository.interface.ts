import type { FeedbackType } from '@prisma/client';

export interface SentJobEntity {
  id: string;
  userId: string;
  jobId: string;
  sentAt: Date;
  feedback: FeedbackType;
}

export interface DeliveryRecordInput {
  userId: string;
  jobId: string;
  sentAt?: Date;
  feedback?: FeedbackType;
}

export interface FeedbackStats {
  likes: number;
  dislikes: number;
  none: number;
  totalSent: number;
}

export interface ISentJobRepository {
  recordBatchSent(deliveries: DeliveryRecordInput[]): Promise<void>;
  getSentJobIdsForUser(userId: string): Promise<Set<string>>;
  isJobSentToUser(userId: string, jobId: string): Promise<boolean>;
  filterUnsentJobsForUser(userId: string, candidateJobIds: string[]): Promise<string[]>;
  countSentJobs(userId?: string): Promise<number>;
  deleteSentHistoryForUser(userId: string): Promise<void>;

  // User Relevance Feedback (TASK-23.2)
  recordFeedback(userId: string, jobId: string, feedback: FeedbackType): Promise<SentJobEntity>;
  getFeedback(userId: string, jobId: string): Promise<FeedbackType | null>;
  getFeedbackStats(jobId: string): Promise<FeedbackStats>;
}

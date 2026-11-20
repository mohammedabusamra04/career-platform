import type {
  JobStatus,
  RemoteScope,
  Specialization,
  ExperienceLevel,
  WorkType,
} from '@prisma/client';

export interface JobEntity {
  id: string;
  deduplicationKey: string;
  semanticKey: string;
  title: string;
  company: string;
  source: string;
  url: string;
  applicationUrl: string | null;
  location: string | null;
  country: string | null;
  remoteScope: RemoteScope;
  primarySpecialization: Specialization;
  secondarySpecialization: Specialization | null;
  experienceLevel: ExperienceLevel;
  workType: WorkType;
  description: string;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: Date;
  scrapedAt: Date;
  lastSeenAt: Date;
  status: JobStatus;
  sourcesSeen?: string[];
}

export interface NormalizedJobInput {
  deduplicationKey: string;
  semanticKey: string;
  title: string;
  company: string;
  source: string;
  url: string;
  applicationUrl?: string | null;
  location?: string | null;
  country?: string | null;
  remoteScope?: RemoteScope;
  primarySpecialization: Specialization;
  secondarySpecialization?: Specialization | null;
  experienceLevel?: ExperienceLevel;
  workType?: WorkType;
  description: string;
  skills?: string[];
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  publishedAt: Date;
  scrapedAt?: Date;
  lastSeenAt?: Date;
  status?: JobStatus;
  sourcesSeen?: string[];
}

export interface JobFilter {
  specialization?: Specialization;
  primarySpecialization?: Specialization;
  secondarySpecialization?: Specialization;
  remoteScope?: RemoteScope;
  experienceLevel?: ExperienceLevel;
  workType?: WorkType;
  publishedSince?: Date;
  limit?: number;
  offset?: number;
}

export interface UpsertResult {
  job: JobEntity;
  isNew: boolean;
}

export interface IJobRepository {
  upsertJob(jobData: NormalizedJobInput): Promise<JobEntity>;
  upsertJobWithResult(jobData: NormalizedJobInput): Promise<UpsertResult>;
  findById(id: string): Promise<JobEntity | null>;
  findByDeduplicationKey(deduplicationKey: string): Promise<JobEntity | null>;
  findBySemanticKey(semanticKey: string): Promise<JobEntity | null>;
  count(status?: JobStatus): Promise<number>;
  findActiveJobs(filter?: JobFilter): Promise<JobEntity[]>;
  expireStaleJobs(retentionDays?: number, now?: Date): Promise<number>;
  markJobAsClosed(idOrDeduplicationKey: string): Promise<JobEntity>;
  updateStatus(id: string, status: JobStatus): Promise<JobEntity>;
}

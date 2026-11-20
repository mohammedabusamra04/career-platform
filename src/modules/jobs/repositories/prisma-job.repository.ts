import type {
  PrismaClient,
  Job as PrismaJobRecord,
  JobStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../../shared/database/prisma.service.js';
import type {
  IJobRepository,
  JobEntity,
  NormalizedJobInput,
  JobFilter,
  UpsertResult,
} from './job.repository.interface.js';
import {
  selectPreferredLink,
  mergeDescription,
  mergeSalary,
  mergeSkills,
} from '../../deduplication/listing-merger.service.js';

export const DEFAULT_JOB_RETENTION_DAYS = 21;

export class PrismaJobRepository implements IJobRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async upsertJob(jobData: NormalizedJobInput): Promise<JobEntity> {
    const result = await this.upsertJobWithResult(jobData);
    return result.job;
  }

  public async upsertJobWithResult(jobData: NormalizedJobInput): Promise<UpsertResult> {
    const now = new Date();

    const { record, isNew } = await this.db.$transaction(async (tx) => {
      // 1. Check for exact duplicate via Level 1 deduplicationKey
      let existing = await tx.job.findUnique({
        where: {
          deduplicationKey: jobData.deduplicationKey,
        },
      });

      // 2. If not found by Level 1, check active jobs by Level 2 semanticKey (cross-source duplicate)
      if (!existing && jobData.semanticKey) {
        existing = await tx.job.findFirst({
          where: {
            semanticKey: jobData.semanticKey,
            status: 'ACTIVE',
          },
          orderBy: {
            lastSeenAt: 'desc',
          },
        });
      }

      if (!existing) {
        const created = await tx.job.create({
          data: {
            deduplicationKey: jobData.deduplicationKey,
            semanticKey: jobData.semanticKey,
            title: jobData.title,
            company: jobData.company,
            source: jobData.source,
            url: jobData.url,
            applicationUrl: jobData.applicationUrl ?? null,
            location: jobData.location ?? null,
            country: jobData.country ?? null,
            remoteScope: jobData.remoteScope ?? 'UNKNOWN',
            primarySpecialization: jobData.primarySpecialization,
            secondarySpecialization: jobData.secondarySpecialization ?? null,
            experienceLevel: jobData.experienceLevel ?? 'UNKNOWN',
            workType: jobData.workType ?? 'UNKNOWN',
            description: jobData.description,
            skills: jobData.skills ?? [],
            salaryMin: jobData.salaryMin ?? null,
            salaryMax: jobData.salaryMax ?? null,
            currency: jobData.currency ?? null,
            publishedAt: jobData.publishedAt,
            scrapedAt: jobData.scrapedAt ?? now,
            lastSeenAt: jobData.lastSeenAt ?? now,
            status: jobData.status ?? 'ACTIVE',
          },
        });
        return { record: created, isNew: true };
      }

      // Merge data preserving richer non-null fields with intelligent precedence (TASK-28.3)
      const isCrossSourceDuplicate = existing.deduplicationKey !== jobData.deduplicationKey;

      const mergedDescription = isCrossSourceDuplicate
        ? mergeDescription(jobData.description, existing.description)
        : jobData.description && jobData.description.trim().length > 0
          ? jobData.description
          : existing.description;

      const mergedSkills = mergeSkills(existing.skills, jobData.skills);

      const preferredUrl = selectPreferredLink(
        jobData.url,
        jobData.source,
        existing.url,
        existing.source,
      );

      const preferredApplicationUrl = selectPreferredLink(
        jobData.applicationUrl,
        jobData.source,
        existing.applicationUrl,
        existing.source,
      );

      const mergedSalary = mergeSalary(
        { min: existing.salaryMin, max: existing.salaryMax, currency: existing.currency },
        { min: jobData.salaryMin, max: jobData.salaryMax, currency: jobData.currency },
      );

      const mergedRemoteScope =
        jobData.remoteScope && jobData.remoteScope !== 'UNKNOWN'
          ? jobData.remoteScope
          : existing.remoteScope;

      const mergedExperienceLevel =
        jobData.experienceLevel && jobData.experienceLevel !== 'UNKNOWN'
          ? jobData.experienceLevel
          : existing.experienceLevel;

      const mergedWorkType =
        jobData.workType && jobData.workType !== 'UNKNOWN'
          ? jobData.workType
          : existing.workType;

      const updated = await tx.job.update({
        where: {
          deduplicationKey: existing.deduplicationKey,
        },
        data: {
          title: jobData.title || existing.title,
          company: jobData.company || existing.company,
          source: jobData.source || existing.source,
          url: preferredUrl || jobData.url || existing.url,
          applicationUrl: preferredApplicationUrl || (jobData.applicationUrl ?? existing.applicationUrl),
          location: jobData.location ?? existing.location,
          country: jobData.country ?? existing.country,
          remoteScope: mergedRemoteScope,
          primarySpecialization: jobData.primarySpecialization || existing.primarySpecialization,
          secondarySpecialization:
            jobData.secondarySpecialization ?? existing.secondarySpecialization,
          experienceLevel: mergedExperienceLevel,
          workType: mergedWorkType,
          description: mergedDescription,
          skills: mergedSkills,
          salaryMin: mergedSalary.min,
          salaryMax: mergedSalary.max,
          currency: mergedSalary.currency,
          lastSeenAt: jobData.lastSeenAt ?? now,
        },
      });
      return { record: updated, isNew: false };
    });

    return {
      job: this.mapToEntity(record),
      isNew,
    };
  }

  public async findById(id: string): Promise<JobEntity | null> {
    const record = await this.db.job.findUnique({
      where: { id },
    });

    return record ? this.mapToEntity(record) : null;
  }

  public async findByDeduplicationKey(deduplicationKey: string): Promise<JobEntity | null> {
    const record = await this.db.job.findUnique({
      where: { deduplicationKey },
    });

    return record ? this.mapToEntity(record) : null;
  }

  public async findBySemanticKey(semanticKey: string): Promise<JobEntity | null> {
    const record = await this.db.job.findFirst({
      where: {
        semanticKey,
        status: 'ACTIVE',
      },
      orderBy: {
        lastSeenAt: 'desc',
      },
    });

    return record ? this.mapToEntity(record) : null;
  }

  public async count(status?: JobStatus): Promise<number> {
    return this.db.job.count({
      where: status ? { status } : undefined,
    });
  }

  public async findActiveJobs(filter?: JobFilter): Promise<JobEntity[]> {
    const where: any = {
      status: 'ACTIVE',
    };

    if (filter?.primarySpecialization) {
      where.primarySpecialization = filter.primarySpecialization;
    } else if (filter?.specialization) {
      where.OR = [
        { primarySpecialization: filter.specialization },
        { secondarySpecialization: filter.specialization },
      ];
    }

    if (filter?.secondarySpecialization) {
      where.secondarySpecialization = filter.secondarySpecialization;
    }

    if (filter?.remoteScope) {
      where.remoteScope = filter.remoteScope;
    }

    if (filter?.experienceLevel) {
      where.experienceLevel = filter.experienceLevel;
    }

    if (filter?.workType) {
      where.workType = filter.workType;
    }

    if (filter?.publishedSince) {
      where.publishedAt = {
        gte: filter.publishedSince,
      };
    }

    const records = await this.db.job.findMany({
      where,
      orderBy: {
        publishedAt: 'desc',
      },
      take: filter?.limit,
      skip: filter?.offset,
    });

    return records.map((r) => this.mapToEntity(r));
  }

  public async expireStaleJobs(
    retentionDays: number = DEFAULT_JOB_RETENTION_DAYS,
    now: Date = new Date(),
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.db.job.updateMany({
      where: {
        status: 'ACTIVE',
        lastSeenAt: {
          lt: cutoff,
        },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return result.count;
  }

  public async markJobAsClosed(idOrDeduplicationKey: string): Promise<JobEntity> {
    const existing = await this.db.job.findFirst({
      where: {
        OR: [
          { id: idOrDeduplicationKey },
          { deduplicationKey: idOrDeduplicationKey },
        ],
      },
    });

    if (!existing) {
      throw new Error(`Job not found with identifier: ${idOrDeduplicationKey}`);
    }

    const updated = await this.db.job.update({
      where: { id: existing.id },
      data: {
        status: 'CLOSED',
      },
    });

    return this.mapToEntity(updated);
  }

  public async updateStatus(id: string, status: JobStatus): Promise<JobEntity> {
    const updated = await this.db.job.update({
      where: { id },
      data: { status },
    });

    return this.mapToEntity(updated);
  }

  private mapToEntity(row: PrismaJobRecord): JobEntity {
    return {
      id: row.id,
      deduplicationKey: row.deduplicationKey,
      semanticKey: row.semanticKey,
      title: row.title,
      company: row.company,
      source: row.source,
      url: row.url,
      applicationUrl: row.applicationUrl,
      location: row.location,
      country: row.country,
      remoteScope: row.remoteScope,
      primarySpecialization: row.primarySpecialization,
      secondarySpecialization: row.secondarySpecialization,
      experienceLevel: row.experienceLevel,
      workType: row.workType,
      description: row.description,
      skills: row.skills,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      currency: row.currency,
      publishedAt: row.publishedAt,
      scrapedAt: row.scrapedAt,
      lastSeenAt: row.lastSeenAt,
      status: row.status,
    };
  }
}

export const jobRepository = new PrismaJobRepository();

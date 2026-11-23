import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaJobRepository,
  DEFAULT_JOB_RETENTION_DAYS,
  type NormalizedJobInput,
} from '../../../src/modules/jobs/index.js';

describe('PrismaJobRepository - Job Storage & Active Lifecycle (TASK-22)', () => {
  let mockPrisma: any;
  let repository: PrismaJobRepository;

  const sampleJobInput: NormalizedJobInput = {
    deduplicationKey: 'job-hash-12345',
    semanticKey: 'semantic-key-backend-google',
    title: 'Senior Backend Engineer',
    company: 'Tech Corp',
    source: 'linkedin',
    url: 'https://example.com/jobs/123',
    applicationUrl: 'https://example.com/apply/123',
    location: 'Dubai, UAE',
    country: 'UAE',
    remoteScope: 'WORLDWIDE',
    primarySpecialization: 'BACKEND',
    secondarySpecialization: 'DEVOPS',
    experienceLevel: 'SENIOR',
    workType: 'FULL_TIME',
    description: 'We are looking for a Senior Backend Engineer proficient in Node.js and Postgres.',
    skills: ['Node.js', 'PostgreSQL', 'TypeScript'],
    salaryMin: 5000,
    salaryMax: 8000,
    currency: 'USD',
    publishedAt: new Date('2026-10-25T10:00:00Z'),
  };

  const sampleDbRecord = {
    id: 'job-uuid-1',
    ...sampleJobInput,
    applicationUrl: sampleJobInput.applicationUrl!,
    location: sampleJobInput.location!,
    country: sampleJobInput.country!,
    secondarySpecialization: sampleJobInput.secondarySpecialization!,
    salaryMin: sampleJobInput.salaryMin!,
    salaryMax: sampleJobInput.salaryMax!,
    currency: sampleJobInput.currency!,
    status: 'ACTIVE',
    scrapedAt: new Date('2026-10-25T10:05:00Z'),
    lastSeenAt: new Date('2026-10-25T10:05:00Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      job: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
    };
    repository = new PrismaJobRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('upsertJob (TASK-22.1)', () => {
    it('inserts a new job with status ACTIVE and timestamps when deduplicationKey does not exist', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);
      mockPrisma.job.create.mockResolvedValue(sampleDbRecord);

      const result = await repository.upsertJob(sampleJobInput);

      expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({
        where: { deduplicationKey: sampleJobInput.deduplicationKey },
      });
      expect(mockPrisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deduplicationKey: sampleJobInput.deduplicationKey,
          title: sampleJobInput.title,
          status: 'ACTIVE',
          skills: sampleJobInput.skills,
        }),
      });
      expect(result.id).toBe('job-uuid-1');
      expect(result.status).toBe('ACTIVE');
    });

    it('updates an existing job in-place, bumps lastSeenAt, and updates description and URL', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(sampleDbRecord);

      const updatedInput: NormalizedJobInput = {
        ...sampleJobInput,
        url: 'https://example.com/jobs/123-new-link',
        description: 'Updated comprehensive job description with new team details.',
      };

      const updatedRecord = {
        ...sampleDbRecord,
        url: updatedInput.url,
        description: updatedInput.description,
        lastSeenAt: new Date('2026-10-26T18:00:00Z'),
      };
      mockPrisma.job.update.mockResolvedValue(updatedRecord);

      const result = await repository.upsertJob(updatedInput);

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { deduplicationKey: sampleJobInput.deduplicationKey },
        data: expect.objectContaining({
          url: 'https://example.com/jobs/123-new-link',
          description: 'Updated comprehensive job description with new team details.',
          lastSeenAt: expect.any(Date),
        }),
      });
      expect(result.url).toBe('https://example.com/jobs/123-new-link');
      expect(result.description).toBe(
        'Updated comprehensive job description with new team details.',
      );
    });

    it('preserves existing non-null fields when incoming update has empty or missing values (no null overwrites)', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(sampleDbRecord);

      const sparseUpdateInput: NormalizedJobInput = {
        deduplicationKey: sampleJobInput.deduplicationKey,
        semanticKey: sampleJobInput.semanticKey,
        title: sampleJobInput.title,
        company: sampleJobInput.company,
        source: sampleJobInput.source,
        url: sampleJobInput.url,
        description: '',
        applicationUrl: null,
        location: null,
        primarySpecialization: 'BACKEND',
        publishedAt: sampleJobInput.publishedAt,
      };

      mockPrisma.job.update.mockResolvedValue(sampleDbRecord);

      await repository.upsertJob(sparseUpdateInput);

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { deduplicationKey: sampleJobInput.deduplicationKey },
        data: expect.objectContaining({
          description: sampleDbRecord.description,
          applicationUrl: sampleDbRecord.applicationUrl,
          location: sampleDbRecord.location,
          lastSeenAt: expect.any(Date),
        }),
      });
    });

    it('merges incoming skills with existing skills without duplicates', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(sampleDbRecord);

      const inputWithNewSkills: NormalizedJobInput = {
        ...sampleJobInput,
        skills: ['TypeScript', 'Docker', 'Kubernetes'],
      };

      mockPrisma.job.update.mockResolvedValue({
        ...sampleDbRecord,
        skills: ['Node.js', 'PostgreSQL', 'TypeScript', 'Docker', 'Kubernetes'],
      });

      await repository.upsertJob(inputWithNewSkills);

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { deduplicationKey: sampleJobInput.deduplicationKey },
        data: expect.objectContaining({
          skills: ['Node.js', 'PostgreSQL', 'TypeScript', 'Docker', 'Kubernetes'],
        }),
      });
    });
  });

  describe('findActiveJobs (TASK-22.2)', () => {
    it('filters strictly by status = ACTIVE and sorts by publishedAt DESC', async () => {
      const activeJobs = [
        { ...sampleDbRecord, id: 'job-1', publishedAt: new Date('2026-10-25T12:00:00Z') },
        { ...sampleDbRecord, id: 'job-2', publishedAt: new Date('2026-10-25T11:00:00Z') },
        { ...sampleDbRecord, id: 'job-3', publishedAt: new Date('2026-10-25T10:00:00Z') },
        { ...sampleDbRecord, id: 'job-4', publishedAt: new Date('2026-10-25T09:00:00Z') },
        { ...sampleDbRecord, id: 'job-5', publishedAt: new Date('2026-10-25T08:00:00Z') },
      ];

      mockPrisma.job.findMany.mockResolvedValue(activeJobs);

      const results = await repository.findActiveJobs();

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        orderBy: { publishedAt: 'desc' },
        take: undefined,
        skip: undefined,
      });
      expect(results).toHaveLength(5);
      expect(results.every((j) => j.status === 'ACTIVE')).toBe(true);
    });

    it('filters active jobs by primary specialization and remoteScope', async () => {
      mockPrisma.job.findMany.mockResolvedValue([sampleDbRecord]);

      await repository.findActiveJobs({
        primarySpecialization: 'BACKEND',
        remoteScope: 'WORLDWIDE',
      });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          primarySpecialization: 'BACKEND',
          remoteScope: 'WORLDWIDE',
        },
        orderBy: { publishedAt: 'desc' },
        take: undefined,
        skip: undefined,
      });
    });

    it('matches either primary or secondary specialization when generic specialization filter is used', async () => {
      mockPrisma.job.findMany.mockResolvedValue([sampleDbRecord]);

      await repository.findActiveJobs({
        specialization: 'DEVOPS',
      });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          OR: [
            { primarySpecialization: 'DEVOPS' },
            { secondarySpecialization: 'DEVOPS' },
          ],
        },
        orderBy: { publishedAt: 'desc' },
        take: undefined,
        skip: undefined,
      });
    });

    it('supports pagination via limit and offset', async () => {
      mockPrisma.job.findMany.mockResolvedValue([sampleDbRecord]);

      await repository.findActiveJobs({
        limit: 10,
        offset: 20,
      });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        skip: 20,
      });
    });
  });

  describe('expireStaleJobs (TASK-22.2)', () => {
    it('marks active jobs older than retention window as EXPIRED', async () => {
      const fixedNow = new Date('2026-10-26T12:00:00Z');
      const expectedCutoff = new Date(fixedNow.getTime() - DEFAULT_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      mockPrisma.job.updateMany.mockResolvedValue({ count: 7 });

      const expiredCount = await repository.expireStaleJobs(DEFAULT_JOB_RETENTION_DAYS, fixedNow);

      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          lastSeenAt: {
            lt: expectedCutoff,
          },
        },
        data: {
          status: 'EXPIRED',
        },
      });
      expect(expiredCount).toBe(7);
    });

    it('allows custom retention days window', async () => {
      const fixedNow = new Date('2026-10-26T12:00:00Z');
      const customDays = 14;
      const expectedCutoff = new Date(fixedNow.getTime() - customDays * 24 * 60 * 60 * 1000);

      mockPrisma.job.updateMany.mockResolvedValue({ count: 3 });

      const expiredCount = await repository.expireStaleJobs(customDays, fixedNow);

      expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          lastSeenAt: {
            lt: expectedCutoff,
          },
        },
        data: {
          status: 'EXPIRED',
        },
      });
      expect(expiredCount).toBe(3);
    });
  });

  describe('markJobAsClosed (TASK-22.2)', () => {
    it('marks a job as CLOSED by id or deduplicationKey', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(sampleDbRecord);
      mockPrisma.job.update.mockResolvedValue({
        ...sampleDbRecord,
        status: 'CLOSED',
      });

      const result = await repository.markJobAsClosed('job-uuid-1');

      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { id: 'job-uuid-1' },
            { deduplicationKey: 'job-uuid-1' },
          ],
        },
      });
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-uuid-1' },
        data: { status: 'CLOSED' },
      });
      expect(result.status).toBe('CLOSED');
    });

    it('throws error when job to close is not found', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(repository.markJobAsClosed('non-existent')).rejects.toThrow(
        'Job not found with identifier: non-existent',
      );
    });
  });

  describe('updateStatus & count', () => {
    it('updates status of a job directly', async () => {
      mockPrisma.job.update.mockResolvedValue({
        ...sampleDbRecord,
        status: 'EXPIRED',
      });

      const result = await repository.updateStatus('job-uuid-1', 'EXPIRED');

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-uuid-1' },
        data: { status: 'EXPIRED' },
      });
      expect(result.status).toBe('EXPIRED');
    });

    it('counts jobs with optional status filter', async () => {
      mockPrisma.job.count.mockResolvedValue(15);

      const count = await repository.count('ACTIVE');

      expect(mockPrisma.job.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
      });
      expect(count).toBe(15);
    });
  });
});

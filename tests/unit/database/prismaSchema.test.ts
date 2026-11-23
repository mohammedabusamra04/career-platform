import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  UserStatus,
  Specialization,
  RegionPreference,
  RemoteScope,
  JobStatus,
  DeliveryStatus,
  FeedbackType,
  ExperienceLevel,
  WorkType,
} from '@prisma/client';

describe('TASK-20.1: Prisma Schema Definition & Relational Entities', () => {
  it('should export all 10 approved specializations matching taxonomy', () => {
    const expected = [
      'BACKEND',
      'FRONTEND',
      'FULLSTACK',
      'MOBILE',
      'DEVOPS',
      'UIUX',
      'DATA',
      'QA',
      'SECURITY',
      'AI_ENGINEER',
    ];
    expect(Object.values(Specialization)).toEqual(expect.arrayContaining(expected));
    expect(Object.keys(Specialization)).toHaveLength(10);
  });

  it('should export UserStatus enum with active, paused, blocked, deleted', () => {
    expect(UserStatus.ACTIVE).toBe('ACTIVE');
    expect(UserStatus.PAUSED).toBe('PAUSED');
    expect(UserStatus.BLOCKED).toBe('BLOCKED');
    expect(UserStatus.DELETED).toBe('DELETED');
  });

  it('should export RegionPreference enum with ARAB, INTERNATIONAL, BOTH', () => {
    expect(RegionPreference.ARAB).toBe('ARAB');
    expect(RegionPreference.INTERNATIONAL).toBe('INTERNATIONAL');
    expect(RegionPreference.BOTH).toBe('BOTH');
  });

  it('should export RemoteScope enum with WORLDWIDE, REGION, COUNTRY, UNKNOWN', () => {
    expect(RemoteScope.WORLDWIDE).toBe('WORLDWIDE');
    expect(RemoteScope.REGION).toBe('REGION');
    expect(RemoteScope.COUNTRY).toBe('COUNTRY');
    expect(RemoteScope.UNKNOWN).toBe('UNKNOWN');
  });

  it('should export JobStatus enum with ACTIVE, EXPIRED, CLOSED', () => {
    expect(JobStatus.ACTIVE).toBe('ACTIVE');
    expect(JobStatus.EXPIRED).toBe('EXPIRED');
    expect(JobStatus.CLOSED).toBe('CLOSED');
  });

  it('should export DeliveryStatus enum with PENDING, SENT, FAILED, BLOCKED', () => {
    expect(DeliveryStatus.PENDING).toBe('PENDING');
    expect(DeliveryStatus.SENT).toBe('SENT');
    expect(DeliveryStatus.FAILED).toBe('FAILED');
    expect(DeliveryStatus.BLOCKED).toBe('BLOCKED');
  });

  it('should export FeedbackType enum with LIKE, DISLIKE, NONE', () => {
    expect(FeedbackType.LIKE).toBe('LIKE');
    expect(FeedbackType.DISLIKE).toBe('DISLIKE');
    expect(FeedbackType.NONE).toBe('NONE');
  });

  it('should export ExperienceLevel and WorkType enums', () => {
    expect(ExperienceLevel.JUNIOR).toBe('JUNIOR');
    expect(ExperienceLevel.MID).toBe('MID');
    expect(ExperienceLevel.SENIOR).toBe('SENIOR');
    expect(WorkType.FULL_TIME).toBe('FULL_TIME');
    expect(WorkType.PART_TIME).toBe('PART_TIME');
    expect(WorkType.CONTRACT).toBe('CONTRACT');
    expect(WorkType.INTERNSHIP).toBe('INTERNSHIP');
  });

  it('should verify schema contains required relational models and constraints', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

    // Models existence
    expect(schemaContent).toContain('model User {');
    expect(schemaContent).toContain('model UserPreference {');
    expect(schemaContent).toContain('model Job {');
    expect(schemaContent).toContain('model SentJob {');
    expect(schemaContent).toContain('model DeliverySlot {');
    expect(schemaContent).toContain('model DigestDelivery {');

    // Referential integrity cascades
    expect(schemaContent).toContain('onDelete: Cascade');

    // Unique constraints
    expect(schemaContent).toContain('telegramId       BigInt            @unique');
    expect(schemaContent).toContain('deduplicationKey        String          @unique');
    expect(schemaContent).toContain('slotKey         String           @unique');
    expect(schemaContent).toContain('@@unique([userId, jobId])');
    expect(schemaContent).toContain('@@unique([slotId, userId])');

    // Performance indexes
    expect(schemaContent).toContain('@@index([preferenceHash])');
    expect(schemaContent).toContain('@@index([status, publishedAt(sort: Desc)])');
    expect(schemaContent).toContain('@@index([primarySpecialization, remoteScope, status])');
  });

  it('should verify domain entity mapping isolation pattern', () => {
    // Pure domain entity interface without Prisma dependency
    interface DomainUser {
      id: string;
      telegramId: number;
      firstName: string | null;
      status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'DELETED';
    }

    // Prisma-shaped data
    const prismaUser = {
      id: 'uuid-123',
      telegramId: BigInt(987654321),
      firstName: 'Ahmed',
      username: 'ahmed_dev',
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      pausedUntil: null,
    };

    // Repository mapper
    const toDomain = (row: typeof prismaUser): DomainUser => ({
      id: row.id,
      telegramId: Number(row.telegramId),
      firstName: row.firstName,
      status: row.status,
    });

    const domainEntity = toDomain(prismaUser);
    expect(domainEntity.id).toBe('uuid-123');
    expect(domainEntity.telegramId).toBe(987654321);
    expect(typeof domainEntity.telegramId).toBe('number');
  });
});

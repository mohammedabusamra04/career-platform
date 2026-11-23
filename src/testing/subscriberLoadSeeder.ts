import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import { WorkType, ExperienceLevel } from '../shared/types/job.js';
import type { DeliverySlotEntity, DigestDeliveryEntity } from '../modules/notifications/repositories/deliverySlot.repository.interface.js';

export interface MockSubscriber {
  id: string;
  telegramId: bigint;
  username: string;
  firstName: string;
  status: 'ACTIVE' | 'BLOCKED';
  preferences: {
    specializations: string[];
    experienceLevels: ExperienceLevel[];
    workTypes: WorkType[];
    targetRegions: string[];
    keywords: string[];
    negativeKeywords: string[];
  };
}

export interface MockJobItem {
  id: string;
  title: string;
  company: string;
  source: string;
  url: string;
  workType: WorkType;
  experienceLevel: ExperienceLevel;
  primarySpecialization: string;
  secondarySpecializations: string[];
  regionScope: string;
  skills: string[];
  description: string;
}

export const SPECIALIZATION_DISTRIBUTION = [
  { name: 'backend', weight: 0.35 },
  { name: 'frontend', weight: 0.25 },
  { name: 'fullstack', weight: 0.15 },
  { name: 'mobile', weight: 0.10 },
  { name: 'devops', weight: 0.08 },
  { name: 'ai_ml', weight: 0.07 },
];

export const REGIONS = ['Gaza', 'Ramallah', 'Cairo', 'Riyadh', 'Dubai', 'Amman', 'Remote Worldwide'];

export class SubscriberLoadSeeder {
  /**
   * Generates mock subscribers with realistic diverse preferences.
   */
  public static generateMockSubscribers(count: number = 10000): MockSubscriber[] {
    const subscribers: MockSubscriber[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const idNum = i + 1;
      const spec = this.pickWeightedSpecialization(idNum);
      const expLevel = this.pickExperienceLevel(idNum);
      const workType = this.pickWorkType(idNum);
      const region = REGIONS[idNum % REGIONS.length]!;

      subscribers[i] = {
        id: `user_load_${idNum}`,
        telegramId: BigInt(100000000 + idNum),
        username: `load_user_${idNum}`,
        firstName: `User ${idNum}`,
        status: 'ACTIVE',
        preferences: {
          specializations: [spec],
          experienceLevels: [expLevel],
          workTypes: [workType],
          targetRegions: [region],
          keywords: [spec, 'software', 'engineer'],
          negativeKeywords: ['junior-only', 'unpaid'],
        },
      };
    }

    return subscribers;
  }

  /**
   * Generates mock jobs covering all specializations and work types.
   */
  public static generateMockJobs(count: number = 1000): MockJobItem[] {
    const jobs: MockJobItem[] = new Array(count);
    const techStacks: Record<string, string[]> = {
      backend: ['Node.js', 'PostgreSQL', 'TypeScript', 'Redis', 'Docker'],
      frontend: ['React', 'TypeScript', 'Next.js', 'Tailwind', 'CSS'],
      fullstack: ['Node.js', 'React', 'PostgreSQL', 'GraphQL'],
      mobile: ['Flutter', 'React Native', 'Swift', 'Kotlin'],
      devops: ['Kubernetes', 'AWS', 'Terraform', 'CI/CD'],
      ai_ml: ['Python', 'PyTorch', 'TensorFlow', 'LLMs', 'Gemini'],
    };

    for (let i = 0; i < count; i++) {
      const idNum = i + 1;
      const spec = SPECIALIZATION_DISTRIBUTION[idNum % SPECIALIZATION_DISTRIBUTION.length]!.name;
      const exp = this.pickExperienceLevel(idNum);
      const workType = this.pickWorkType(idNum);
      const skills = techStacks[spec] ?? ['TypeScript', 'Git'];

      jobs[i] = {
        id: `job_load_${idNum}`,
        title: `${spec.toUpperCase()} Engineer #${idNum}`,
        company: `Tech Corp ${(idNum % 50) + 1}`,
        source: idNum % 2 === 0 ? 'remotive' : 'adzuna',
        url: `https://jobs.example.com/item/${idNum}`,
        workType,
        experienceLevel: exp,
        primarySpecialization: spec,
        secondarySpecializations: [],
        regionScope: workType === WorkType.REMOTE ? 'global' : 'regional',
        skills,
        description: `Looking for skilled ${spec} engineer with proficiency in ${skills.join(', ')}.`,
      };
    }

    return jobs;
  }

  /**
   * Generates a complete DeliverySlotEntity and an array of DigestDeliveryEntity
   * records representing 10,000 recipients for chunked cursor dispatch.
   */
  public static generateDeliverySlotWithRecipients(
    slotKey: string = 'digest:2026-11-20:2100',
    count: number = 10000,
  ): { slot: DeliverySlotEntity; deliveries: DigestDeliveryEntity[] } {
    const slotId = `slot_load_${Date.now()}`;
    const slot: DeliverySlotEntity = {
      id: slotId,
      slotKey,
      scheduledTime: new Date(),
      status: 'PENDING',
      totalRecipients: count,
      sentCount: 0,
      failedCount: 0,
      startedAt: new Date(),
      completedAt: null,
    };

    const deliveries: DigestDeliveryEntity[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const idNum = i + 1;
      deliveries[i] = {
        id: `del_${String(idNum).padStart(6, '0')}`,
        slotId,
        userId: `user_load_${idNum}`,
        status: 'PENDING',
        lastError: null,
        deliveredAt: null,
        attempts: 0,
      };
    }

    return { slot, deliveries };
  }

  /**
   * Bulk seeds subscribers and jobs into a live PostgreSQL database in chunked batches.
   */
  public static async seedDatabase(
    prisma: PrismaClient,
    options?: { subscribersCount?: number; jobsCount?: number },
  ): Promise<{ subscribersSeeded: number; jobsSeeded: number; durationMs: number; durationFormatted: string }> {
    const startTime = Date.now();
    const subCount = options?.subscribersCount ?? 10000;
    const jobCount = options?.jobsCount ?? 1000;

    const subscribers = this.generateMockSubscribers(subCount);
    const jobs = this.generateMockJobs(jobCount);

    // 1. Bulk insert Users and Preferences in batches of 1,000
    const batchSize = 1000;
    for (let i = 0; i < subscribers.length; i += batchSize) {
      const chunk = subscribers.slice(i, i + batchSize);
      await (prisma as any).user.createMany({
        data: chunk.map((s) => ({
          id: s.id,
          telegramId: s.telegramId,
          username: s.username,
          firstName: s.firstName,
          status: s.status,
          updatedAt: new Date(),
        })),
        skipDuplicates: true,
      });

      await (prisma as any).userPreference.createMany({
        data: chunk.map((s) => ({
          userId: s.id,
          specializations: s.preferences.specializations,
          experienceLevels: s.preferences.experienceLevels,
          workTypes: s.preferences.workTypes,
          targetRegions: s.preferences.targetRegions,
          keywords: s.preferences.keywords,
          negativeKeywords: s.preferences.negativeKeywords,
          updatedAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }

    // 2. Bulk insert Jobs in batches of 1,000
    for (let i = 0; i < jobs.length; i += batchSize) {
      const chunk = jobs.slice(i, i + batchSize);
      await (prisma as any).job.createMany({
        data: chunk.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          source: j.source,
          url: j.url,
          workType: j.workType,
          experienceLevel: j.experienceLevel,
          primarySpecialization: j.primarySpecialization,
          secondarySpecializations: j.secondarySpecializations,
          regionScope: j.regionScope,
          skills: j.skills,
          description: j.description,
          isActive: true,
          scrapedAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    return {
      subscribersSeeded: subCount,
      jobsSeeded: jobCount,
      durationMs,
      durationFormatted: ms(durationMs),
    };
  }

  private static pickWeightedSpecialization(id: number): string {
    const index = id % SPECIALIZATION_DISTRIBUTION.length;
    return SPECIALIZATION_DISTRIBUTION[index]!.name;
  }

  private static pickExperienceLevel(id: number): ExperienceLevel {
    const levels = [
      ExperienceLevel.INTERN,
      ExperienceLevel.JUNIOR,
      ExperienceLevel.MID,
      ExperienceLevel.SENIOR,
      ExperienceLevel.LEAD,
    ];
    return levels[id % levels.length]!;
  }

  private static pickWorkType(id: number): WorkType {
    const types = [WorkType.REMOTE, WorkType.HYBRID, WorkType.ON_SITE];
    return types[id % types.length]!;
  }
}

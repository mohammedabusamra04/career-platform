import { describe, it, expect, vi } from 'vitest';
import ms from 'ms';
import {
  SubscriberLoadSeeder,
  SPECIALIZATION_DISTRIBUTION,
} from '../../../src/testing/subscriberLoadSeeder.js';

describe('TASK-47.1: SubscriberLoadSeeder Unit Tests (#132)', () => {
  it('generates 10,000 distinct mock subscribers with complete preferences', () => {
    const subscribers = SubscriberLoadSeeder.generateMockSubscribers(10000);

    expect(subscribers).toHaveLength(10000);

    // Verify first and last subscriber
    expect(subscribers[0]!.id).toBe('user_load_1');
    expect(subscribers[0]!.telegramId).toBe(100000001n);
    expect(subscribers[0]!.preferences.specializations).toHaveLength(1);
    expect(subscribers[0]!.preferences.experienceLevels).toHaveLength(1);
    expect(subscribers[0]!.preferences.workTypes).toHaveLength(1);

    expect(subscribers[9999]!.id).toBe('user_load_10000');
    expect(subscribers[9999]!.telegramId).toBe(100010000n);

    // Verify uniqueness of IDs
    const uniqueIds = new Set(subscribers.map((s) => s.id));
    expect(uniqueIds.size).toBe(10000);

    // Verify diverse specialization coverage
    const specs = new Set(subscribers.map((s) => s.preferences.specializations[0]));
    for (const dist of SPECIALIZATION_DISTRIBUTION) {
      expect(specs.has(dist.name)).toBe(true);
    }
  });

  it('generates 1,000 diverse jobs with complete metadata', () => {
    const jobs = SubscriberLoadSeeder.generateMockJobs(1000);

    expect(jobs).toHaveLength(1000);
    expect(jobs[0]!.id).toBe('job_load_1');
    expect(jobs[0]!.skills.length).toBeGreaterThan(0);
    expect(jobs[999]!.id).toBe('job_load_1000');

    const uniqueJobIds = new Set(jobs.map((j) => j.id));
    expect(uniqueJobIds.size).toBe(1000);
  });

  it('generates a delivery slot with 10,000 pending delivery records', () => {
    const { slot, deliveries } = SubscriberLoadSeeder.generateDeliverySlotWithRecipients(
      'digest:2026-11-20:2100',
      10000,
    );

    expect(slot.totalRecipients).toBe(10000);
    expect(slot.status).toBe('PENDING');
    expect(deliveries).toHaveLength(10000);

    expect(deliveries[0]!.id).toBe('del_000001');
    expect(deliveries[0]!.status).toBe('PENDING');
    expect(deliveries[9999]!.id).toBe('del_010000');
  });

  it('seeds database using batch chunks and returns formatted duration with ms', async () => {
    const mockPrisma = {
      user: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
      userPreference: { createMany: vi.fn().mockResolvedValue({ count: 10 }) },
      job: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
    };

    const result = await SubscriberLoadSeeder.seedDatabase(mockPrisma as any, {
      subscribersCount: 10,
      jobsCount: 5,
    });

    expect(result.subscribersSeeded).toBe(10);
    expect(result.jobsSeeded).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
    expect(typeof result.durationFormatted).toBe('string');
    expect(result.durationFormatted).toMatch(/\d+ms/);
  });
});

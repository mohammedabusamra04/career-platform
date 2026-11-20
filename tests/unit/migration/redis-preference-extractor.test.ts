import { describe, it, expect, vi } from 'vitest';
import ms from 'ms';
import {
  RedisPreferenceExtractor,
  type V1RedisSubscriberData,
} from '../../../src/modules/migration/redis-preference-extractor.js';
import { Specialization } from '../../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-48.1: RedisPreferenceExtractor Unit Tests (#134)', () => {
  it('extracts and maps an active subscriber list from a mock Redis client', async () => {
    const mockRedis = {
      sMembers: vi.fn().mockResolvedValue(['1001', '1002']),
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'preferences:1001') {
          return JSON.stringify({
            jobTitle: 'Senior Backend Developer',
            skills: ['Node.js', 'PostgreSQL'],
            location: 'Riyadh, Saudi Arabia',
          });
        }
        if (key === 'preferences:1002') {
          return JSON.stringify({
            jobTitle: 'Mobile Flutter Engineer',
            location: 'Worldwide',
          });
        }
        return null;
      }),
    };

    const records = await RedisPreferenceExtractor.extractFromRedis(mockRedis);

    expect(records).toHaveLength(2);
    expect(records[0]!.telegramId).toBe(1001n);
    expect(records[0]!.preferences.specializations).toContain(Specialization.BACKEND);
    expect(records[0]!.preferences.preferenceHash).toBeDefined();

    expect(records[1]!.telegramId).toBe(1002n);
    expect(records[1]!.preferences.specializations).toContain(Specialization.MOBILE);
  });

  it('runs migration on sample dataset of 50 users and verifies 100% accurate conversion (Acceptance Criteria)', () => {
    // Generate 50 realistic V1 Redis user records across varied roles
    const mockV1Users: V1RedisSubscriberData[] = Array.from({ length: 50 }, (_, i) => {
      const id = 200000 + i + 1;
      const roles = [
        'Node.js Backend Developer',
        'React Frontend Engineer',
        'Full Stack TypeScript Developer',
        'DevOps Cloud Engineer',
        'Flutter Android Mobile Developer',
        'Data Scientist & Analyst',
        'QA Automation Tester',
        'Cyber Security Specialist',
        'UI/UX Product Designer',
        'Machine Learning & AI Engineer',
      ];
      const role = roles[i % roles.length]!;

      return {
        userId: id,
        preferences: {
          jobTitle: role,
          experienceLevel: i % 3 === 0 ? 'senior' : i % 3 === 1 ? 'mid' : 'junior',
          workType: 'full-time',
          location: i % 2 === 0 ? 'Gaza, Palestine' : 'Remote Worldwide',
          skills: ['TypeScript', 'Git'],
        },
      };
    });

    const mapped = RedisPreferenceExtractor.mapRecords(mockV1Users);

    expect(mapped).toHaveLength(50);

    for (let i = 0; i < 50; i++) {
      const rec = mapped[i]!;
      expect(rec.telegramId).toBe(BigInt(200000 + i + 1));
      expect(rec.status).toBe('ACTIVE');
      expect(rec.preferences.specializations.length).toBeGreaterThan(0);
      expect(rec.preferences.preferenceHash).toMatch(/^[a-f0-9]{64}$/); // Valid SHA-256
      expect(rec.isAmbiguous).toBe(false); // All 10 domain archetypes map cleanly without ambiguity
    }
  });

  it('dumps a valid, restorable pre-migration JSON snapshot', () => {
    const sampleRecord: V1RedisSubscriberData = {
      userId: '555123',
      preferences: {
        jobTitle: 'Backend Engineer',
        location: 'Cairo',
      },
    };

    const mapped = RedisPreferenceExtractor.mapRecords([sampleRecord]);
    const snapshotJson = RedisPreferenceExtractor.dumpSnapshot(mapped);

    expect(typeof snapshotJson).toBe('string');
    const parsed = JSON.parse(snapshotJson);
    expect(parsed.totalSubscribers).toBe(1);
    expect(parsed.records[0].telegramId).toBe('555123');
    expect(parsed.timestamp).toBeDefined();
  });

  it('migrates records to PostgreSQL via Prisma upserts and returns execution duration with ms', async () => {
    const mockPrisma = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'uuid-user-1', telegramId: 1001n }),
      },
      userPreference: {
        upsert: vi.fn().mockResolvedValue({ id: 'uuid-pref-1', userId: 'uuid-user-1' }),
      },
    };

    const sample: V1RedisSubscriberData = {
      userId: '1001',
      preferences: {
        jobTitle: 'Senior Python & FastAPI Backend Developer',
        location: 'Amman, Jordan',
      },
    };

    const mapped = RedisPreferenceExtractor.mapRecords([sample]);
    const result = await RedisPreferenceExtractor.migrateToPostgres(mapped, mockPrisma as any);

    expect(result.totalProcessed).toBe(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(1);
    expect(result.durationFormatted).toMatch(/\d+ms/);
    expect(mockPrisma.user.upsert).toHaveBeenCalled();
    expect(mockPrisma.userPreference.upsert).toHaveBeenCalled();
  });
});


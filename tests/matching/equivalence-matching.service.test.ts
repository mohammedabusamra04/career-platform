import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EquivalenceMatchingService,
  equivalenceMatchingService,
} from '../../src/modules/matching/equivalence-matching.service.js';
import { deterministicScoringCalculator } from '../../src/modules/matching/scoring.calculator.js';
import { hardFilterEngine } from '../../src/modules/matching/hard-filter.engine.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';
import type { UserPreferenceGroup } from '../../src/modules/preferences/repositories/user-preference.repository.interface.js';
import type { ScorableJob } from '../../src/modules/matching/scoring.calculator.js';

describe('EquivalenceMatchingService (TASK-39.1)', () => {
  let service: EquivalenceMatchingService;

  beforeEach(() => {
    service = new EquivalenceMatchingService();
    vi.restoreAllMocks();
  });

  const mockJobs: ScorableJob[] = [
    {
      id: 'job-1',
      title: 'Senior Backend Engineer',
      specialization: 'BACKEND',
      primarySpecialization: Specialization.BACKEND,
      remoteScope: 'WORLDWIDE',
      experienceLevel: 'SENIOR',
      publishedAt: new Date(),
    },
    {
      id: 'job-2',
      title: 'Frontend React Developer',
      specialization: 'FRONTEND',
      primarySpecialization: Specialization.FRONTEND,
      remoteScope: 'WORLDWIDE',
      experienceLevel: 'MID',
      publishedAt: new Date(),
    },
    {
      id: 'job-3',
      title: 'Mid Backend Engineer',
      specialization: 'BACKEND',
      primarySpecialization: Specialization.BACKEND,
      remoteScope: 'WORLDWIDE',
      experienceLevel: 'MID',
      publishedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000), // 5 days ago
    },
    {
      id: 'job-4',
      title: 'Marketing Specialist',
      specialization: 'OTHER',
      primarySpecialization: 'OTHER' as any,
      remoteScope: 'LOCAL',
    },
  ];

  const backendGroup: UserPreferenceGroup = {
    preferenceHash: 'hash-backend-senior',
    specializations: [Specialization.BACKEND],
    regionPreference: RegionPreference.BOTH,
    experienceLevel: 'SENIOR',
    workType: 'FULL_TIME',
    userIds: ['user-1', 'user-2', 'user-3'],
  };

  const frontendGroup: UserPreferenceGroup = {
    preferenceHash: 'hash-frontend-mid',
    specializations: [Specialization.FRONTEND],
    regionPreference: RegionPreference.BOTH,
    experienceLevel: 'MID',
    workType: 'FULL_TIME',
    userIds: ['user-4', 'user-5'],
  };

  it('matches and sorts candidate jobs descending by score for a group', () => {
    const results = service.matchGroup(backendGroup, mockJobs);

    expect(results.length).toBeGreaterThan(0);
    // Should only contain BACKEND jobs (job-1 and job-3)
    expect(results.map((r) => r.job.id)).toEqual(['job-1', 'job-3']);
    // job-1 (Senior, fresh) should rank higher than job-3 (Mid, 5-day-old)
    expect(results[0].scoring.score).toBeGreaterThan(results[1].scoring.score);
  });

  it('leverages in-memory run cache so group is scored exactly once per run', () => {
    const scoreSpy = vi.spyOn(deterministicScoringCalculator, 'calculateScore');

    // First run - scores filtered jobs
    const firstRun = service.matchGroup(backendGroup, mockJobs);
    const scoreCallCount = scoreSpy.mock.calls.length;
    expect(scoreCallCount).toBeGreaterThan(0);

    // Second run with same group - must hit cache without invoking score function
    const secondRun = service.matchGroup(backendGroup, mockJobs);
    expect(secondRun).toBe(firstRun);
    expect(scoreSpy.mock.calls.length).toBe(scoreCallCount);

    // After clearing cache, scoring should run again
    service.clearRunCache();
    service.matchGroup(backendGroup, mockJobs);
    expect(scoreSpy.mock.calls.length).toBe(scoreCallCount * 2);
  });

  it('matches all groups and aggregates results by preferenceHash', () => {
    const groupsMap = new Map<string, UserPreferenceGroup>([
      [backendGroup.preferenceHash, backendGroup],
      [frontendGroup.preferenceHash, frontendGroup],
    ]);

    const results = service.matchAllGroups(groupsMap, mockJobs);

    expect(results.size).toBe(2);
    expect(results.has(backendGroup.preferenceHash)).toBe(true);
    expect(results.has(frontendGroup.preferenceHash)).toBe(true);

    const backendResult = results.get(backendGroup.preferenceHash)!;
    expect(backendResult.rankedJobs.length).toBe(2);
    expect(backendResult.rankedJobs[0].job.specialization).toBe('BACKEND');

    const frontendResult = results.get(frontendGroup.preferenceHash)!;
    expect(frontendResult.rankedJobs.length).toBe(1);
    expect(frontendResult.rankedJobs[0].job.specialization).toBe('FRONTEND');
  });

  describe('Benchmark Test ($O(G \\times J)$ Scaling)', () => {
    it('verifies 1,000 users across 10 equivalence groups execute scoring for 10 groups, not 1,000 times', () => {
      const scoreSpy = vi.spyOn(deterministicScoringCalculator, 'calculateScore');
      const filterSpy = vi.spyOn(hardFilterEngine, 'filter');

      // Create 10 distinct equivalence groups
      const groups: UserPreferenceGroup[] = [];
      const specs = [
        Specialization.BACKEND,
        Specialization.FRONTEND,
        Specialization.FULLSTACK,
        Specialization.MOBILE,
        Specialization.DEVOPS,
        Specialization.UIUX,
        Specialization.DATA,
        Specialization.QA,
        Specialization.SECURITY,
        Specialization.AI_ENGINEER,
      ];

      // Distribute 1,000 users across these 10 groups (100 users per group)
      for (let g = 0; g < 10; g++) {
        const userIds: string[] = [];
        for (let u = 0; u < 100; u++) {
          userIds.push(`user-g${g}-u${u}`);
        }
        groups.push({
          preferenceHash: `hash-group-${g}`,
          specializations: [specs[g]],
          regionPreference: RegionPreference.BOTH,
          experienceLevel: 'MID',
          workType: 'FULL_TIME',
          userIds,
        });
      }

      // Execute batch equivalence matching
      const results = service.matchAllGroups(groups, mockJobs);

      expect(results.size).toBe(10);
      // Hard filter engine should run exactly 10 times (once per group)
      expect(filterSpy).toHaveBeenCalledTimes(10);

      // Total users represented = 10 groups * 100 users = 1,000 users
      const totalUsers = Array.from(results.values()).reduce(
        (sum, r) => sum + r.group.userIds.length,
        0,
      );
      expect(totalUsers).toBe(1000);
    });
  });

  it('exports singleton equivalenceMatchingService instance', () => {
    expect(equivalenceMatchingService).toBeInstanceOf(EquivalenceMatchingService);
  });
});

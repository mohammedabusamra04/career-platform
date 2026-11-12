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

  describe('Personalized Sent-Log Subtraction (TASK-39.2)', () => {
    it('subtracts unique sent history for members in the same group (Acceptance Criteria)', () => {
      // Create a pool of 25 jobs for the group
      const rankedJobs = Array.from({ length: 25 }, (_, idx) => {
        const id = `job-${idx + 1}`;
        return {
          job: {
            id,
            title: `Job Title ${idx + 1}`,
            specialization: 'BACKEND',
            primarySpecialization: Specialization.BACKEND,
            remoteScope: 'WORLDWIDE',
          },
          scoring: {
            score: 95 - idx,
            isEligibleForDigest: true,
            breakdown: {
              specializationScore: 50,
              levelScore: 15,
              regionScore: 15,
              freshnessScore: Math.max(0, 10 - idx),
              atsScore: 5,
              rawTotal: 95 - idx,
              totalScore: 95 - idx,
            },
          },
        };
      });

      // User A has seen Job 1; User B has not seen any
      const userASent = new Set<string>(['job-1']);
      const userBSent = new Set<string>();

      const userAResults = service.personalizeForMember(rankedJobs, userASent, 20);
      const userBResults = service.personalizeForMember(rankedJobs, userBSent, 20);

      // User B receives top 20 (Jobs 1 to 20)
      expect(userBResults).toHaveLength(20);
      expect(userBResults[0].job.id).toBe('job-1');
      expect(userBResults[19].job.id).toBe('job-20');

      // User A receives Jobs 2 to 21 (Job 1 subtracted)
      expect(userAResults).toHaveLength(20);
      expect(userAResults.some((r) => r.job.id === 'job-1')).toBe(false);
      expect(userAResults[0].job.id).toBe('job-2');
      expect(userAResults[19].job.id).toBe('job-21');
    });

    it('personalizes group rankings across multiple members via personalizeGroupForMembers', () => {
      const rankedJobs = [
        { job: { id: 'job-1', primarySpecialization: Specialization.BACKEND }, scoring: { score: 90, isEligibleForDigest: true } as any },
        { job: { id: 'job-2', primarySpecialization: Specialization.BACKEND }, scoring: { score: 80, isEligibleForDigest: true } as any },
        { job: { id: 'job-3', primarySpecialization: Specialization.BACKEND }, scoring: { score: 70, isEligibleForDigest: true } as any },
      ];

      const membersSent = new Map<string, Set<string>>([
        ['user-1', new Set(['job-1'])],
        ['user-2', new Set(['job-2'])],
        ['user-3', new Set(['job-1', 'job-2', 'job-3'])],
      ]);

      const memberDeliveries = service.personalizeGroupForMembers(rankedJobs, membersSent, 20);

      expect(memberDeliveries.size).toBe(3);
      expect(memberDeliveries.get('user-1')!.map((r) => r.job.id)).toEqual(['job-2', 'job-3']);
      expect(memberDeliveries.get('user-2')!.map((r) => r.job.id)).toEqual(['job-1', 'job-3']);
      expect(memberDeliveries.get('user-3')!).toEqual([]); // all jobs seen
    });

    it('respects custom limit when personalized jobs exceed requested count', () => {
      const rankedJobs = Array.from({ length: 10 }, (_, i) => ({
        job: { id: `job-${i + 1}`, primarySpecialization: Specialization.BACKEND },
        scoring: { score: 90 - i, isEligibleForDigest: true } as any,
      }));

      const results = service.personalizeForMember(rankedJobs, new Set(), 5);
      expect(results).toHaveLength(5);
      expect(results.map((r) => r.job.id)).toEqual(['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
    });
  });

  it('exports singleton equivalenceMatchingService instance', () => {
    expect(equivalenceMatchingService).toBeInstanceOf(EquivalenceMatchingService);
  });
});


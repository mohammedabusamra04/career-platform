import { hardFilterEngine } from './hard-filter.engine.js';
import {
  deterministicScoringCalculator,
  type ScorableJob,
  type ScoringCandidatePreferences,
  type ScoringResult,
} from './scoring.calculator.js';
import type { UserPreferenceGroup } from '../preferences/repositories/user-preference.repository.interface.js';

export interface ScoredCandidateJob {
  job: ScorableJob;
  scoring: ScoringResult;
}

export interface GroupMatchingResult {
  preferenceHash: string;
  group: UserPreferenceGroup;
  rankedJobs: ScoredCandidateJob[];
  evaluatedJobsCount: number;
  eligibleJobsCount: number;
}

export class EquivalenceMatchingService {
  /**
   * In-memory cache for group candidate rankings during a single matching/digest cycle.
   */
  private readonly runCache = new Map<string, ScoredCandidateJob[]>();

  /**
   * Clears the in-memory run cache.
   */
  public clearRunCache(): void {
    this.runCache.clear();
  }

  /**
   * Matches and ranks candidate jobs for a single equivalence group.
   * Leverages in-memory cache to ensure a group is scored exactly once per run.
   *
   * Complexity per group: O(J)
   * Hard filters run first, followed by deterministic scoring.
   * Resulting jobs are sorted descending by score.
   */
  public matchGroup<T extends ScorableJob>(
    group: UserPreferenceGroup,
    activeJobs: readonly T[],
  ): ScoredCandidateJob[] {
    const cached = this.runCache.get(group.preferenceHash);
    if (cached) {
      return cached;
    }

    const candidatePreferences: ScoringCandidatePreferences = {
      specializations: group.specializations,
      regionPreference: group.regionPreference,
      experienceLevel: group.experienceLevel,
      workType: group.workType,
    };

    // 1. O(J) Hard Filter Exclusion
    const filteredJobs = hardFilterEngine.filter(activeJobs, {
      specializations: group.specializations,
      regionPreference: group.regionPreference,
    });

    // 2. O(J) Deterministic Bounded Scoring
    const scoredCandidates: ScoredCandidateJob[] = [];

    for (const job of filteredJobs) {
      const scoring = deterministicScoringCalculator.calculateScore(job, candidatePreferences);

      if (scoring.isEligibleForDigest) {
        scoredCandidates.push({
          job,
          scoring,
        });
      }
    }

    // 3. Sort candidates descending by score (highest match first)
    scoredCandidates.sort((a, b) => b.scoring.score - a.scoring.score);

    // Cache rankings for this group hash
    this.runCache.set(group.preferenceHash, scoredCandidates);

    return scoredCandidates;
  }

  /**
   * Executes batch equivalence matching across all distinct subscriber groups.
   *
   * Complexity: O(G * J) where G is the number of distinct equivalence groups (~200-400),
   * eliminating ~95%+ of redundant evaluations compared to O(U * J).
   */
  public matchAllGroups<T extends ScorableJob>(
    groups: Map<string, UserPreferenceGroup> | Iterable<UserPreferenceGroup>,
    activeJobs: readonly T[],
  ): Map<string, GroupMatchingResult> {
    const results = new Map<string, GroupMatchingResult>();
    const groupList = groups instanceof Map ? Array.from(groups.values()) : Array.from(groups);

    for (const group of groupList) {
      const rankedJobs = this.matchGroup(group, activeJobs);

      results.set(group.preferenceHash, {
        preferenceHash: group.preferenceHash,
        group,
        rankedJobs,
        evaluatedJobsCount: activeJobs.length,
        eligibleJobsCount: rankedJobs.length,
      });
    }

    return results;
  }
}

export const equivalenceMatchingService = new EquivalenceMatchingService();

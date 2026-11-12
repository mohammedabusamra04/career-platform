import { describe, it, expect } from 'vitest';
import {
  DeterministicScoringCalculator,
  deterministicScoringCalculator,
  MIN_DIGEST_SCORE_THRESHOLD,
  type ScorableJob,
  type ScoringCandidatePreferences,
} from '../../src/modules/matching/scoring.calculator.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-38.1: Additive Multi-Signal Weighting Algorithm (#111)', () => {
  const calculator = new DeterministicScoringCalculator();
  const now = new Date('2026-10-15T12:00:00Z');

  describe('Benchmark Acceptance Criteria & Test Specifications', () => {
    it('exact match fresh role scores 95 points (50 + 15 + 15 + 10 + 5 = 95) (Test Spec #111)', () => {
      const job: ScorableJob = {
        id: 'job-exact-fresh',
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: 'SENIOR',
        remoteScope: 'WORLDWIDE',
        source: 'greenhouse',
        publishedAt: new Date('2026-10-15T10:00:00Z'), // ~2 hours old -> 0 days old
      };

      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'SENIOR',
      };

      const result = calculator.calculateScore(job, preferences, now);

      expect(result.breakdown.specializationScore).toBe(50);
      expect(result.breakdown.levelScore).toBe(15);
      expect(result.breakdown.regionScore).toBe(15);
      expect(result.breakdown.freshnessScore).toBe(10);
      expect(result.breakdown.atsScore).toBe(5);
      expect(result.score).toBe(95);
      expect(result.isEligibleForDigest).toBe(true);
    });

    it('secondary match 5-day old role scores 60 points (30 + 10 + 15 + 5 + 0 = 60) (Test Spec #111)', () => {
      const job: ScorableJob = {
        id: 'job-secondary-5d',
        primarySpecialization: Specialization.FULLSTACK,
        secondarySpecialization: Specialization.BACKEND,
        experienceLevel: 'MID',
        remoteScope: 'WORLDWIDE',
        source: 'wuzzuf', // Non-ATS aggregator
        publishedAt: new Date('2026-10-10T12:00:00Z'), // Exactly 5 days old
      };

      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND], // Matches secondary only
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'ANY', // Matches general level -> 10 pts
      };

      const result = calculator.calculateScore(job, preferences, now);

      expect(result.breakdown.specializationScore).toBe(30);
      expect(result.breakdown.levelScore).toBe(10);
      expect(result.breakdown.regionScore).toBe(15);
      expect(result.breakdown.freshnessScore).toBe(5);
      expect(result.breakdown.atsScore).toBe(0);
      expect(result.score).toBe(60);
      expect(result.isEligibleForDigest).toBe(true);
    });
  });

  describe('Specialization Match Scoring (+50 vs +30)', () => {
    it('awards +50 points when primary specialization matches', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.DATA,
      };
      const score = calculator.calculateSpecializationScore(job, [
        Specialization.DATA,
      ]);
      expect(score).toBe(50);
    });

    it('awards +30 points when secondary specialization matches', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.AI_ENGINEER,
        secondarySpecialization: Specialization.DATA,
      };
      const score = calculator.calculateSpecializationScore(job, [
        Specialization.DATA,
      ]);
      expect(score).toBe(30);
    });

    it('is non-cumulative and awards +50 when both primary and secondary match candidate preferences', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        secondarySpecialization: Specialization.DEVOPS,
      };
      const score = calculator.calculateSpecializationScore(job, [
        Specialization.BACKEND,
        Specialization.DEVOPS,
      ]);
      expect(score).toBe(50); // Primary takes precedence, non-cumulative
    });

    it('awards 0 points when neither primary nor secondary matches', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.FRONTEND,
        secondarySpecialization: Specialization.UIUX,
      };
      const score = calculator.calculateSpecializationScore(job, [
        Specialization.BACKEND,
      ]);
      expect(score).toBe(0);
    });
  });

  describe('Experience Level Match Scoring (+15 vs +10 vs 0)', () => {
    it('awards +15 points on exact seniority match', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: 'MID',
      };
      expect(calculator.calculateExperienceLevelScore(job, 'MID')).toBe(15);
      expect(calculator.calculateExperienceLevelScore(job, 'mid')).toBe(15);
    });

    it('awards +10 points when candidate configured no level or ANY', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: 'SENIOR',
      };
      expect(calculator.calculateExperienceLevelScore(job, null)).toBe(10);
      expect(calculator.calculateExperienceLevelScore(job, undefined)).toBe(10);
      expect(calculator.calculateExperienceLevelScore(job, 'ANY')).toBe(10);
    });

    it('awards +10 points when job has unstated/missing experience level', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: null,
      };
      expect(calculator.calculateExperienceLevelScore(job, 'SENIOR')).toBe(10);
    });

    it('awards 0 points on level mismatch', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: 'JUNIOR',
      };
      expect(calculator.calculateExperienceLevelScore(job, 'SENIOR')).toBe(0);
    });
  });

  describe('Region & Remote Scope Fit (+15 vs 0)', () => {
    it('awards +15 points for WORLDWIDE remote roles regardless of candidate region', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        remoteScope: 'WORLDWIDE',
      };
      expect(calculator.calculateRegionFitScore(job, RegionPreference.ARAB)).toBe(15);
      expect(calculator.calculateRegionFitScore(job, RegionPreference.INTERNATIONAL)).toBe(15);
      expect(calculator.calculateRegionFitScore(job, RegionPreference.BOTH)).toBe(15);
    });

    it('awards +15 points for Arab market roles when candidate preference is ARAB', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'EG',
      };
      expect(calculator.calculateRegionFitScore(job, RegionPreference.ARAB)).toBe(15);
    });

    it('awards +15 points for international market roles when candidate preference is INTERNATIONAL', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'DE',
      };
      expect(calculator.calculateRegionFitScore(job, RegionPreference.INTERNATIONAL)).toBe(15);
    });

    it('awards +15 points for all roles when candidate preference is BOTH', () => {
      const egJob: ScorableJob = { primarySpecialization: Specialization.BACKEND, country: 'EG' };
      const deJob: ScorableJob = { primarySpecialization: Specialization.BACKEND, country: 'DE' };
      expect(calculator.calculateRegionFitScore(egJob, RegionPreference.BOTH)).toBe(15);
      expect(calculator.calculateRegionFitScore(deJob, RegionPreference.BOTH)).toBe(15);
    });
  });

  describe('Freshness Decay (max(0, 10 - daysSincePublished))', () => {
    it('awards +10 points for jobs published today', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        publishedAt: now,
      };
      expect(calculator.calculateFreshnessScore(job, now)).toBe(10);
    });

    it('decays linearly by 1 point per day', () => {
      const job2d: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        publishedAt: new Date('2026-10-13T12:00:00Z'), // 2 days old
      };
      const job7d: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        publishedAt: new Date('2026-10-08T12:00:00Z'), // 7 days old
      };

      expect(calculator.calculateFreshnessScore(job2d, now)).toBe(8);
      expect(calculator.calculateFreshnessScore(job7d, now)).toBe(3);
    });

    it('floors at 0 for jobs 10 days old or older (never negative)', () => {
      const job10d: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        publishedAt: new Date('2026-10-05T12:00:00Z'), // 10 days old
      };
      const job30d: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        publishedAt: new Date('2026-09-15T12:00:00Z'), // 30 days old
      };

      expect(calculator.calculateFreshnessScore(job10d, now)).toBe(0);
      expect(calculator.calculateFreshnessScore(job30d, now)).toBe(0);
    });

    it('returns 0 when publication date is missing', () => {
      const job: ScorableJob = { primarySpecialization: Specialization.BACKEND };
      expect(calculator.calculateFreshnessScore(job, now)).toBe(0);
    });
  });

  describe('Direct Company ATS Source (+5 vs 0)', () => {
    it('awards +5 points when source is direct ATS', () => {
      const leverJob: ScorableJob = { primarySpecialization: Specialization.BACKEND, source: 'lever' };
      const ghJob: ScorableJob = { primarySpecialization: Specialization.BACKEND, source: 'greenhouse' };
      const workableJob: ScorableJob = { primarySpecialization: Specialization.BACKEND, source: 'workable' };

      expect(calculator.calculateAtsScore(leverJob)).toBe(5);
      expect(calculator.calculateAtsScore(ghJob)).toBe(5);
      expect(calculator.calculateAtsScore(workableJob)).toBe(5);
    });

    it('awards +5 points when applicationUrl contains known ATS domain', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        source: 'custom_source',
        applicationUrl: 'https://jobs.lever.co/company/job-123',
      };
      expect(calculator.calculateAtsScore(job)).toBe(5);
    });

    it('awards 0 points for regular aggregators', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        source: 'jooble',
        applicationUrl: 'https://jooble.org/desc/12345',
      };
      expect(calculator.calculateAtsScore(job)).toBe(0);
    });
  });

  describe('Digest Threshold Gating (MIN_DIGEST_SCORE_THRESHOLD = 55)', () => {
    it('marks role with score >= 55 as eligible for digest', () => {
      // 50 (primary) + 10 (level ANY) = 60
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
      };
      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
      };

      const result = calculator.calculateScore(job, preferences, now);
      expect(result.score).toBeGreaterThanOrEqual(55);
      expect(result.isEligibleForDigest).toBe(true);
    });

    it('excludes role below 55 points from digest (isEligibleForDigest = false)', () => {
      // Secondary match (30) + No level match (0) + 10-day old (0) + Non-ATS (0) + No region match (0) = 30 pts
      const job: ScorableJob = {
        primarySpecialization: Specialization.MOBILE,
        secondarySpecialization: Specialization.BACKEND,
        country: 'US', // Incompatible with ARAB
        remoteScope: 'COUNTRY',
        publishedAt: new Date('2026-10-01T12:00:00Z'), // > 10 days old
        source: 'other',
        experienceLevel: 'JUNIOR',
      };
      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'SENIOR', // Mismatch -> 0
      };

      const result = calculator.calculateScore(job, preferences, now);
      expect(result.score).toBe(30);
      expect(result.score).toBeLessThan(MIN_DIGEST_SCORE_THRESHOLD);
      expect(result.isEligibleForDigest).toBe(false);
    });
  });

  describe('Bounded Score Clamping (0 - 100)', () => {
    it('clamps scores strictly to a maximum of 100', () => {
      // Sum = 50 + 15 + 15 + 10 + 5 = 95, but even if additional signals exist, it never exceeds 100
      const job: ScorableJob = {
        primarySpecialization: Specialization.BACKEND,
        experienceLevel: 'SENIOR',
        remoteScope: 'WORLDWIDE',
        source: 'greenhouse',
        publishedAt: now,
      };
      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: 'SENIOR',
      };

      const result = calculator.calculateScore(job, preferences, now);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.score).toBe(95);
    });

    it('clamps scores to minimum 0 (never negative)', () => {
      const job: ScorableJob = {
        primarySpecialization: Specialization.QA,
      };
      const preferences: ScoringCandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'SENIOR',
      };

      const result = calculator.calculateScore(job, preferences, now);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Singleton Export', () => {
    it('exports singleton instance deterministicScoringCalculator', () => {
      expect(deterministicScoringCalculator).toBeInstanceOf(DeterministicScoringCalculator);
    });
  });
});


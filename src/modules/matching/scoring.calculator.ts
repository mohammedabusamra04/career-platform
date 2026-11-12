import env from '../../config/env.js';
import {
  Specialization,
  RegionPreference,
} from '../preferences/preference.taxonomy.js';
import {
  hardFilterEngine,
  type FilterableJob,
} from './hard-filter.engine.js';

export const MIN_DIGEST_SCORE_THRESHOLD = env.minDigestScoreThreshold ?? 55;

export const DIRECT_ATS_DOMAINS = [
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'breezy.hr',
  'recruitee.com',
];

export const DIRECT_ATS_SOURCES = new Set<string>([
  'lever',
  'greenhouse',
  'workable',
  'ashby',
  'smartrecruiters',
  'bamboohr',
  'breezy',
  'recruitee',
]);

export interface ScorableJob extends FilterableJob {
  publishedAt?: Date | null;
  publicationDate?: Date | null;
  url?: string | null;
  applicationUrl?: string | null;
  experienceLevel?: string | null;
}

export interface ScoringCandidatePreferences {
  specializations: Specialization[];
  regionPreference: RegionPreference;
  experienceLevel?: string | null;
  workType?: string | null;
}

export interface ScoreBreakdown {
  specializationScore: number;
  levelScore: number;
  regionScore: number;
  freshnessScore: number;
  atsScore: number;
  rawTotal: number;
  totalScore: number;
}

export interface ScoringResult {
  score: number;
  isEligibleForDigest: boolean;
  breakdown: ScoreBreakdown;
}

/**
 * Deterministic Scoring Calculator (TASK-38.1)
 *
 * Implements a bounded additive multi-signal scoring algorithm (0 - 100)
 * with a 55-point minimum acceptance threshold for candidate digests.
 */
export class DeterministicScoringCalculator {
  /**
   * Calculates the specialization match score:
   * - Primary Specialization Match: +50 points
   * - Secondary Specialization Match: +30 points (mutually exclusive with primary)
   * - No Match: 0 points
   */
  public calculateSpecializationScore(
    job: ScorableJob,
    userSpecializations: Specialization[],
  ): number {
    const userSpecsSet = new Set(userSpecializations);

    if (userSpecsSet.has(job.primarySpecialization)) {
      return 50;
    }

    if (
      job.secondarySpecialization &&
      userSpecsSet.has(job.secondarySpecialization)
    ) {
      return 30;
    }

    return 0;
  }

  /**
   * Calculates the experience level match score:
   * - Exact match between candidate and job: +15 points
   * - Candidate specified no level or 'ANY': +10 points
   * - Mismatch: 0 points
   */
  public calculateExperienceLevelScore(
    job: ScorableJob,
    candidateLevel?: string | null,
  ): number {
    if (!candidateLevel || candidateLevel.trim().toUpperCase() === 'ANY') {
      return 10;
    }

    if (!job.experienceLevel) {
      return 10;
    }

    const normCandidate = candidateLevel.trim().toUpperCase();
    const normJob = job.experienceLevel.trim().toUpperCase();

    if (normCandidate === normJob) {
      return 15;
    }

    return 0;
  }

  /**
   * Calculates the region and remote scope fit score:
   * - Worldwide remote or direct geographic market fit: +15 points
   * - Mismatch or non-aligned: 0 points
   */
  public calculateRegionFitScore(
    job: ScorableJob,
    preference: RegionPreference,
  ): number {
    if (hardFilterEngine.isWorldwideJob(job)) {
      return 15;
    }

    if (preference === RegionPreference.BOTH) {
      return 15;
    }

    const isArab = hardFilterEngine.isArabMarketJob(job);

    if (preference === RegionPreference.ARAB && isArab) {
      return 15;
    }

    if (preference === RegionPreference.INTERNATIONAL && !isArab) {
      return 15;
    }

    return 0;
  }

  /**
   * Calculates linear freshness decay score:
   * - Formula: max(0, 10 - daysSincePublished)
   * - 0 days old: +10 points
   * - 5 days old: +5 points
   * - >= 10 days old: 0 points
   */
  public calculateFreshnessScore(
    job: ScorableJob,
    referenceDate: Date = new Date(),
  ): number {
    const publishedAt = job.publishedAt ?? job.publicationDate;
    if (!publishedAt) {
      return 0;
    }

    const ageMs = Math.max(0, referenceDate.getTime() - publishedAt.getTime());
    const daysSincePublished = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    return Math.max(0, Math.min(10, 10 - daysSincePublished));
  }

  /**
   * Checks if a posting originates from a direct company ATS:
   * - Lever, Greenhouse, Workable, Ashby, etc.: +5 points
   * - Other third-party aggregators: 0 points
   */
  public calculateAtsScore(job: ScorableJob): number {
    if (job.source && DIRECT_ATS_SOURCES.has(job.source.toLowerCase())) {
      return 5;
    }

    const targetUrl = job.applicationUrl || job.url;
    if (targetUrl) {
      const lowerUrl = targetUrl.toLowerCase();
      if (DIRECT_ATS_DOMAINS.some((domain) => lowerUrl.includes(domain))) {
        return 5;
      }
    }

    return 0;
  }

  /**
   * Computes the complete score breakdown and digest eligibility for a job.
   */
  public calculateScore(
    job: ScorableJob,
    preferences: ScoringCandidatePreferences,
    referenceDate: Date = new Date(),
  ): ScoringResult {
    const specializationScore = this.calculateSpecializationScore(
      job,
      preferences.specializations,
    );
    const levelScore = this.calculateExperienceLevelScore(
      job,
      preferences.experienceLevel,
    );
    const regionScore = this.calculateRegionFitScore(
      job,
      preferences.regionPreference,
    );
    const freshnessScore = this.calculateFreshnessScore(job, referenceDate);
    const atsScore = this.calculateAtsScore(job);

    const rawTotal =
      specializationScore +
      levelScore +
      regionScore +
      freshnessScore +
      atsScore;

    // Clamped strictly between 0 and 100
    const totalScore = Math.min(100, Math.max(0, rawTotal));
    const isEligibleForDigest = totalScore >= MIN_DIGEST_SCORE_THRESHOLD;

    return {
      score: totalScore,
      isEligibleForDigest,
      breakdown: {
        specializationScore,
        levelScore,
        regionScore,
        freshnessScore,
        atsScore,
        rawTotal,
        totalScore,
      },
    };
  }
}

export const deterministicScoringCalculator = new DeterministicScoringCalculator();


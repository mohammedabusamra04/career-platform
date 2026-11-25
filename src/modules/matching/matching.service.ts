import type { Cache } from '../../cache/cache.interface.js';
import { cacheKeys } from '../../cache/cache.keys.js';
import { CACHE_TTL } from '../../cache/cache.ttl.js';
import type { Job } from '../jobs/job.types.js';
import type { UserPreferences } from '../preferences/preference.types.js';
import logger from '../../shared/utils/logger.js';

import type { AIProvider } from './ai/aiProvider.interface.js';
import type { JobAnalysis } from './matching.types.js';

export interface MatchedJob {
  job: Job;
  score: number;
  reason: string;
}

interface JobFingerprinter {
  generate(job: Job): string;
}

/** Max parallel Gemini analyses per pipeline run. */
const ANALYSIS_CONCURRENCY = 4;
/** Hard cap on total time spent waiting for AI analysis (ms). */
const ANALYSIS_BUDGET_MS = 6 * 60_000;

export class MatchingService {
  private readonly fingerprintService: JobFingerprinter;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly cache?: Cache,
    fingerprintService?: JobFingerprinter,
  ) {
    this.fingerprintService = fingerprintService ?? {
      generate: (job: Job) => job.url || job.applicationUrl || `${job.title}:${job.company}`,
    };
  }

  async analyzeJobs(jobs: Job[]): Promise<Map<string, JobAnalysis>> {
    const analyses = new Map<string, JobAnalysis>();
    const deadline = Date.now() + ANALYSIS_BUDGET_MS;
    let cursor = 0;
    let skipped = 0;

    const worker = async (): Promise<void> => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        const fingerprint = this.fingerprintService.generate(job);
        const analysisKey = cacheKeys.jobAnalysis(fingerprint);

        /*
         * Redis first: reuse analyses from previous pipeline runs.
         */
        const cached = this.cache
          ? await this.cache.get<JobAnalysis>(analysisKey)
          : null;

        if (cached) {
          analyses.set(fingerprint, cached);
          continue;
        }

        /*
         * If every API-key/model slot is in cooldown, wait for the
         * earliest one to reopen, but only if it fits in the time budget.
         */
        if (!this.aiProvider.hasAvailableSlot()) {
          const wait = this.aiProvider.msUntilAvailable?.() ?? 0;

          if (wait > 0 && wait <= 120_000 && wait < deadline - Date.now()) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }

        if (Date.now() >= deadline || !this.aiProvider.hasAvailableSlot()) {
          skipped++;
          continue;
        }

        try {
          const result = await this.aiProvider.analyzeJob(job);

          const analysis: JobAnalysis = {
            role: result.role,
            level: result.experienceLevel,
            skills: result.skills,
            workType: result.workType,
          };

          if (this.cache) {
            await this.cache.set(analysisKey, analysis, CACHE_TTL.JOB_ANALYSIS);
          }

          analyses.set(fingerprint, analysis);

          logger.info(`AI analysis generated for job "${job.title}".`);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          logger.warn(
            `Job analysis failed for "${job.title}": ${errorMessage}`,
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: ANALYSIS_CONCURRENCY }, () => worker()),
    );

    if (skipped > 0) {
      logger.warn(
        `AI analysis budget/slots exhausted: ${skipped}/${jobs.length} jobs will use rule-based matching.`,
      );
    }

    return analyses;
  }

  async matchJobs(
    jobs: Job[],
    preferences: UserPreferences,
    analyses: Map<string, JobAnalysis> = new Map(),
  ): Promise<MatchedJob[]> {
    const matchedJobs: MatchedJob[] = [];

    for (const job of jobs) {
      const fingerprint =
        this.fingerprintService.generate(job);

      /*
       * O(1) average lookup.
       */
      const analysis =
        analyses?.get(fingerprint);

      /*
       * If AI analysis exists,
       * use AI-based matching.
       *
       * If AI analysis does not exist,
       * use rule-based matching as fallback.
       */
      const result = analysis
        ? this.calculateMatch(
            job,
            analysis,
            preferences,
          )
        : this.calculateRuleBasedMatch(
            job,
            preferences,
          );

      matchedJobs.push({
        job,
        score: result.score,
        reason: result.reason,
      });
    }

    return matchedJobs.sort(
      (a, b) => b.score - a.score,
    );
  }

  /*
   * Rule-based fallback.
   *
   * Used when AI analysis is unavailable.
   */
  private calculateRuleBasedMatch(
    job: Job,
    preferences: UserPreferences,
  ): {
    score: number;
    reason: string;
  } {
    let score = 0;

    const reasons: string[] = [];

    /*
     * Role (Unified scale: 50 points for primary role match)
     */
    if (
      preferences.jobTitle &&
      this.textMatches(
        job.title,
        preferences.jobTitle,
      )
    ) {
      score += 50;

      reasons.push(
        'role matches',
      );
    }

    /*
     * Skills (up to 15 points)
     */
    if (
      preferences.skills?.length &&
      job.skills.length
    ) {
      const matchedSkills =
        preferences.skills.filter((skill) =>
          job.skills.some((jobSkill) =>
            this.textMatches(
              jobSkill,
              skill,
            ),
          ),
        );

      if (matchedSkills.length > 0) {
        const skillScore = Math.min(
          15,
          matchedSkills.length * 5,
        );

        score += skillScore;

        reasons.push(
          `${matchedSkills.length} skill(s) match`,
        );
      }
    }

    /*
     * Experience level (15 points for match, 10 for flexible/any)
     */
    if (preferences.experienceLevel) {
      const prefLevel = preferences.experienceLevel.toLowerCase();
      if (prefLevel === 'any' || prefLevel === 'all') {
        score += 10;
        reasons.push('experience level flexible');
      } else if (job.experienceLevel) {
        if (
          this.textMatches(
            job.experienceLevel,
            preferences.experienceLevel,
          )
        ) {
          score += 15;
          reasons.push('experience level matches');
        } else {
          score -= 10;
          reasons.push('experience level does not match');
        }
      } else {
        score += 10;
      }
    } else {
      score += 10;
    }

    /*
     * Work type / Remote (15 points)
     */
    if (preferences.workType) {
      if (preferences.workType === 'any') {
        score += 15;
        reasons.push('work type matches (any)');
      } else if (
        job.workType &&
        this.textMatches(job.workType, preferences.workType)
      ) {
        score += 15;
        reasons.push('work type matches');
      } else if (
        preferences.workType === 'remote' &&
        job.remote === true
      ) {
        score += 15;
        reasons.push('remote matches');
      }
    } else {
      score += 15;
    }

    /*
     * Freshness (up to 10 points for jobs posted/scraped within 24h)
     */
    const pubDate = job.publicationDate || job.scrapedAt;
    if (pubDate) {
      const ageHours = (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60);
      if (ageHours <= 24) {
        score += 10;
        reasons.push('fresh job (posted within 24h)');
      } else if (ageHours <= 72) {
        score += 5;
      }
    }

    return {
      score: Math.min(score, 100),
      reason:
        reasons.length > 0
          ? reasons.join(', ')
          : 'Rule-based match',
    };
  }

  private calculateMatch(
    _job: Job,
    analysis: JobAnalysis,
    preferences: UserPreferences,
  ): {
    score: number;
    reason: string;
  } {
    let score = 0;

    const reasons: string[] = [];

    /*
     * Role (Unified scale: 50 points for primary role match)
     */
    if (
      preferences.jobTitle &&
      this.textMatches(
        analysis.role,
        preferences.jobTitle,
      )
    ) {
      score += 50;
      reasons.push('role matches');
    }

    /*
     * Skills (up to 15 points)
     */
    if (preferences.skills?.length) {
      const matchedSkills =
        preferences.skills.filter((skill) =>
          analysis.skills.some((jobSkill) =>
            this.textMatches(
              jobSkill,
              skill,
            ),
          ),
        );

      if (matchedSkills.length > 0) {
        const skillScore = Math.min(
          15,
          matchedSkills.length * 5,
        );

        score += skillScore;

        reasons.push(
          `${matchedSkills.length} skill(s) match`,
        );
      }
    }

    /*
     * Experience level (15 points for match, 10 for flexible/any)
     */
    if (preferences.experienceLevel) {
      const prefLevel = preferences.experienceLevel.toLowerCase();
      if (prefLevel === 'any' || prefLevel === 'all') {
        score += 10;
        reasons.push('experience level flexible');
      } else if (analysis.level) {
        if (
          this.textMatches(
            analysis.level,
            preferences.experienceLevel,
          )
        ) {
          score += 15;
          reasons.push('experience level matches');
        } else {
          score -= 10;
          reasons.push('experience level does not match');
        }
      } else {
        score += 10;
      }
    } else {
      score += 10;
    }

    /*
     * Work type / Remote (15 points)
     */
    if (preferences.workType) {
      if (preferences.workType === 'any') {
        score += 15;
        reasons.push('work type matches (any)');
      } else if (
        analysis.workType &&
        this.textMatches(
          analysis.workType,
          preferences.workType,
        )
      ) {
        score += 15;
        reasons.push('work type matches');
      }
    } else {
      score += 15;
    }

    /*
     * Freshness (up to 10 points)
     */
    const pubDate = _job.publicationDate || _job.scrapedAt;
    if (pubDate) {
      const ageHours = (Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60);
      if (ageHours <= 24) {
        score += 10;
        reasons.push('fresh job (posted within 24h)');
      } else if (ageHours <= 72) {
        score += 5;
      }
    }

    return {
      score: Math.min(score, 100),
      reason:
        reasons.length > 0
          ? reasons.join(', ')
          : 'No strong match found',
    };
  }

  private textMatches(
    a: string,
    b: string,
  ): boolean {
    const normalize = (
      value: string,
    ): string =>
      value
        .toLowerCase()
        .trim()
        .replace(/[._-]/g, ' ')
        .replace(/\s+/g, ' ');

    const first = normalize(a);
    const second = normalize(b);

    if (first === second) {
      return true;
    }

    return (
      first.includes(second) ||
      second.includes(first)
    );
  }
}
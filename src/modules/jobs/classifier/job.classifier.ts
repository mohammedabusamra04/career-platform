import {
  Specialization,
  RemoteScope,
  ExperienceLevel,
  WorkType,
} from '../../../shared/types/domain.types.js';
import type { Job } from '../job.types.js';
import {
  NegativeExclusionMatcher,
  negativeExclusionMatcher,
  type ExclusionResult,
} from './negativeExclusion.matcher.js';
import { SeniorityClassifier, seniorityClassifier } from './seniority.classifier.js';
import { WorkTypeClassifier, workTypeClassifier } from './workType.classifier.js';
import {
  RemoteScopeClassifier,
  remoteScopeClassifier,
  type RemoteScopeClassification,
} from './remoteScope.classifier.js';
import {
  GeminiAmbiguityResolver,
  geminiAmbiguityResolver,
  AIAmbiguityResolutionSchema,
  type AIAmbiguityResolution,
} from './geminiAmbiguity.resolver.js';
import type {
  ClassificationResult,
  TitleClassificationResult,
  AmbiguityResolutionInput,
  AmbiguityResolutionOutput,
  AmbiguityResolver,
  ClassificationMethod,
  StageContext,
} from './classificationTypes.js';
import {
  NegativeExclusionStage,
  negativeExclusionStage,
} from './stages/negativeExclusionStage.js';
import {
  TitleRoleLockStage,
  titleRoleLockStage,
} from './stages/titleRoleLockStage.js';
import {
  ContextualDescriptionStage,
  contextualDescriptionStage,
} from './stages/contextualDescriptionStage.js';
import {
  GeminiFallbackStage,
  geminiFallbackStage,
} from './stages/geminiFallbackStage.js';
import {
  TAXONOMY_TOKEN_MAP,
  SPECIALIZATION_TAXONOMY_RULES,
} from './specializationTaxonomy.js';
import logger from '../../../shared/utils/logger.js';

export {
  NegativeExclusionMatcher,
  negativeExclusionMatcher,
  type ExclusionResult,
  SeniorityClassifier,
  seniorityClassifier,
  WorkTypeClassifier,
  workTypeClassifier,
  RemoteScopeClassifier,
  remoteScopeClassifier,
  type RemoteScopeClassification,
  GeminiAmbiguityResolver,
  geminiAmbiguityResolver,
  AIAmbiguityResolutionSchema,
  type AIAmbiguityResolution,
  type TitleClassificationResult,
  type ClassificationResult,
  type AmbiguityResolutionInput,
  type AmbiguityResolutionOutput,
  type AmbiguityResolver,
  type ClassificationMethod,
};

/**
 * DeterministicJobClassifier orchestrates a 4-stage classification pipeline:
 * Stage 1: Negative Exclusion
 * Stage 2: Title Role Lock
 * Stage 3: Contextual Description with Anti-Signal protection
 * Stage 4: Gemini AI Ambiguity Fallback (on demand)
 */
export class DeterministicJobClassifier {
  public static readonly TOKEN_MAP = TAXONOMY_TOKEN_MAP;
  public static readonly SPECIALIZATION_RULES = SPECIALIZATION_TAXONOMY_RULES;

  private readonly exclusionStage: NegativeExclusionStage;

  constructor(
    private readonly exclusionMatcher: NegativeExclusionMatcher = negativeExclusionMatcher,
    private readonly seniorityEngine: SeniorityClassifier = seniorityClassifier,
    private readonly workTypeEngine: WorkTypeClassifier = workTypeClassifier,
    private readonly remoteScopeEngine: RemoteScopeClassifier = remoteScopeClassifier,
    private readonly titleStage: TitleRoleLockStage = titleRoleLockStage,
    private readonly descriptionStage: ContextualDescriptionStage = contextualDescriptionStage,
    private readonly fallbackStage: GeminiFallbackStage = geminiFallbackStage,
  ) {
    this.exclusionStage = new NegativeExclusionStage(this.exclusionMatcher);
  }

  /**
   * Evaluates title against negative exclusion patterns.
   */
  public evaluateExclusion(title: string): ExclusionResult {
    return this.exclusionMatcher.evaluate(title);
  }

  /**
   * Title-First Tokenized Rule Engine.
   */
  public classifyTitle(title: string): TitleClassificationResult | null {
    if (!title || !title.trim()) {
      return null;
    }

    const exclusion = this.evaluateExclusion(title);
    if (exclusion.isExcluded) {
      return null;
    }

    return this.titleStage.classifyTitle(title);
  }

  /**
   * Scores job description and skills against specialization rules.
   */
  public scoreDescription(description: string, skillsText: string = ''): Map<Specialization, number> {
    return this.descriptionStage.scoreDescription(description, skillsText);
  }

  /**
   * Classifies a job deterministically through the multi-stage pipeline.
   */
  public classify(job: Partial<Job>): ClassificationResult {
    const rawTitle = job.title || '';
    const cleanTitle = rawTitle.trim();
    const context: StageContext = {
      job,
      title: cleanTitle,
      description: job.description,
      skills: job.skills,
      normalizedTitle: this.titleStage.normalizeTitleForTokens(cleanTitle),
    };

    // Stage 1: Negative Exclusion
    const exclusionResult = this.exclusionStage.execute(context);
    if (exclusionResult && exclusionResult.isExcluded) {
      return {
        primarySpecialization: null,
        secondarySpecialization: null,
        remoteScope: RemoteScope.UNSPECIFIED,
        country: job.country ?? null,
        experienceLevel: ExperienceLevel.MID,
        workType: WorkType.FULL_TIME,
        confidence: 1.0,
        classificationMethod: 'NEGATIVE_EXCLUSION',
        isExcluded: true,
        exclusionReason: exclusionResult.exclusionReason,
      };
    }

    // Stage 2: Title Role Lock
    const titleResult = this.titleStage.execute(context);

    let primarySpecialization: Specialization | null = null;
    let secondarySpecialization: Specialization | null = null;
    let confidence = 0;
    let classificationMethod: ClassificationMethod = 'DEFAULT';
    let matchedTokens: string[] | undefined;

    if (titleResult && titleResult.primarySpecialization) {
      primarySpecialization = titleResult.primarySpecialization;
      secondarySpecialization = titleResult.secondarySpecialization ?? null;
      confidence = titleResult.confidence;
      classificationMethod = titleResult.classificationMethod;
      matchedTokens = titleResult.matchedTokens;
    } else {
      // Stage 3: Contextual Description with Anti-Signal protection
      const descResult = this.descriptionStage.execute(context);
      if (descResult && descResult.primarySpecialization) {
        primarySpecialization = descResult.primarySpecialization;
        secondarySpecialization = descResult.secondarySpecialization ?? null;
        confidence = descResult.confidence;
        classificationMethod = descResult.classificationMethod;
      }
    }

    // Determine Remote Scope, Seniority, and Work Type
    const remoteResult = this.resolveRemoteScope(job);
    const experienceLevel = this.resolveExperienceLevel(job);
    const workType = this.resolveWorkType(job);

    return {
      primarySpecialization,
      secondarySpecialization,
      remoteScope: remoteResult.scope,
      country: remoteResult.country ?? job.country ?? null,
      remoteScopeEvidence: remoteResult.evidence,
      remoteConfidence: remoteResult.confidence,
      experienceLevel,
      workType,
      confidence,
      classificationMethod,
      matchedTokens,
      isExcluded: false,
    };
  }

  /**
   * Evaluates whether a job requires AI ambiguity resolution.
   * Unambiguous high-confidence title matches are strictly exempt from AI invocation.
   */
  public isAmbiguous(job: Partial<Job>, result?: ClassificationResult): boolean {
    const classification = result || this.classify(job);

    // 1. Excluded non-technical jobs are never ambiguous
    if (classification.isExcluded) {
      return false;
    }

    // 2. Trigger Condition 1: Deterministic rules return UNRESOLVED (null specialization or DEFAULT method)
    if (!classification.primarySpecialization || classification.classificationMethod === 'DEFAULT') {
      return true;
    }

    // 3. Trigger Condition 2: Severe title vs description conflict
    if (job.description && job.description.length >= 50) {
      const descScores = this.scoreDescription(job.description);
      if (descScores.size > 0) {
        const sortedDesc = Array.from(descScores.entries()).sort((a, b) => b[1] - a[1]);
        const topDescSpec = sortedDesc[0][0];
        const topDescScore = sortedDesc[0][1];
        const titleSpecScore = descScores.get(classification.primarySpecialization) || 0;

        const isFullstackComponent =
          classification.primarySpecialization === Specialization.FULLSTACK &&
          (topDescSpec === Specialization.FRONTEND || topDescSpec === Specialization.BACKEND);

        // Anti-signal trap: Developer roles (Backend/Frontend/Fullstack/Mobile) never conflict with QA
        // unless exclusive test automation frameworks (Selenium, Cypress, Playwright, TestRail, Appium) are present.
        const isDeveloperRole =
          classification.primarySpecialization === Specialization.BACKEND ||
          classification.primarySpecialization === Specialization.FRONTEND ||
          classification.primarySpecialization === Specialization.FULLSTACK ||
          classification.primarySpecialization === Specialization.MOBILE;

        const isFalsePositiveQAConflict =
          isDeveloperRole &&
          topDescSpec === Specialization.QA &&
          !/\b(?:playwright|cypress|selenium|appium|testrail|sdet)\b/i.test(job.description);

        if (
          !isFullstackComponent &&
          !isFalsePositiveQAConflict &&
          topDescSpec !== classification.primarySpecialization &&
          topDescScore >= 16 &&
          topDescScore > titleSpecScore
        ) {
          return true;
        }
      }
    }

    // 4. Prohibit AI invocation for unambiguous high-confidence title matches
    if (classification.classificationMethod === 'RULE_TITLE' && classification.confidence >= 0.8) {
      return false;
    }

    return false;
  }

  /**
   * Asynchronously classifies a job with optional AI ambiguity resolution fallback.
   */
  public async classifyWithFallback(
    job: Partial<Job>,
    resolver?: AmbiguityResolver,
  ): Promise<ClassificationResult> {
    const deterministic = this.classify(job);

    if (!resolver || !this.isAmbiguous(job, deterministic)) {
      return deterministic;
    }

    try {
      const activeStage = resolver === geminiAmbiguityResolver ? this.fallbackStage : new GeminiFallbackStage(resolver);
      const stageResult = await activeStage.execute({
        job,
        title: job.title || '',
        description: job.description,
        skills: job.skills,
        normalizedTitle: this.titleStage.normalizeTitleForTokens(job.title || ''),
      });

      if (stageResult && stageResult.primarySpecialization) {
        return {
          ...deterministic,
          primarySpecialization: stageResult.primarySpecialization,
          confidence: stageResult.confidence,
          classificationMethod: 'AI_FALLBACK',
        };
      }
    } catch (err: unknown) {
      logger.warn(
        `[JobClassifier] AI fallback resolution failed, retaining deterministic result: ${(err as Error).message}`,
      );
    }

    return deterministic;
  }

  public resolveRemoteScope(job: Partial<Job>): RemoteScopeClassification {
    return this.remoteScopeEngine.classify(job);
  }

  private resolveExperienceLevel(job: Partial<Job>): ExperienceLevel {
    return this.seniorityEngine.classify(job);
  }

  private resolveWorkType(job: Partial<Job>): WorkType {
    return this.workTypeEngine.classify(job);
  }
}

export const deterministicJobClassifier = new DeterministicJobClassifier();

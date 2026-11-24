import type {
  IClassificationStage,
  StageContext,
  StageResult,
} from '../classificationTypes.js';
import {
  NegativeExclusionMatcher,
  negativeExclusionMatcher,
} from '../negativeExclusion.matcher.js';

export class NegativeExclusionStage implements IClassificationStage {
  public readonly name = 'NEGATIVE_EXCLUSION';

  constructor(
    private readonly matcher: NegativeExclusionMatcher = negativeExclusionMatcher,
  ) {}

  public execute(context: StageContext): StageResult | null {
    const exclusion = this.matcher.evaluate(context.title);
    if (exclusion.isExcluded) {
      return {
        handled: true,
        primarySpecialization: null,
        secondarySpecialization: null,
        confidence: 1.0,
        classificationMethod: 'NEGATIVE_EXCLUSION',
        isExcluded: true,
        exclusionReason: exclusion.reason,
      };
    }

    return null;
  }
}

export const negativeExclusionStage = new NegativeExclusionStage();

import type {
  IClassificationStage,
  StageContext,
  StageResult,
  AmbiguityResolver,
} from '../classificationTypes.js';
import {
  GeminiAmbiguityResolver,
  geminiAmbiguityResolver,
} from '../geminiAmbiguity.resolver.js';
import logger from '../../../../shared/utils/logger.js';

export class GeminiFallbackStage implements IClassificationStage {
  public readonly name = 'GEMINI_FALLBACK';

  constructor(
    private readonly resolver: AmbiguityResolver = geminiAmbiguityResolver,
  ) {}

  public async execute(context: StageContext): Promise<StageResult | null> {
    try {
      const resolution = await this.resolver.resolve({
        title: context.title,
        description: context.description,
        skills: context.skills,
      });

      if (resolution && resolution.specialization) {
        return {
          handled: true,
          primarySpecialization: resolution.specialization,
          secondarySpecialization: null,
          confidence: resolution.confidence ?? 0.85,
          classificationMethod: 'AI_FALLBACK',
          isExcluded: false,
        };
      }
    } catch (err: unknown) {
      logger.warn(
        `[GeminiFallbackStage] AI ambiguity resolution failed: ${(err as Error).message}`,
      );
    }

    return null;
  }
}

export const geminiFallbackStage = new GeminiFallbackStage();

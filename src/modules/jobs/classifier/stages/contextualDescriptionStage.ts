import { Specialization } from '../../../../shared/types/domain.types.js';
import type {
  IClassificationStage,
  StageContext,
  StageResult,
} from '../classificationTypes.js';
import { SPECIALIZATION_TAXONOMY_RULES } from '../specializationTaxonomy.js';

export class ContextualDescriptionStage implements IClassificationStage {
  public readonly name = 'CONTEXTUAL_DESCRIPTION';

  public execute(context: StageContext): StageResult | null {
    const description = context.description || '';
    const skillsText = (context.skills || []).join(' ');

    if (!description && !skillsText) {
      return null;
    }

    const scores = this.scoreDescription(description, skillsText);
    if (scores.size === 0) {
      return null;
    }

    const sortedSpecs = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    if (sortedSpecs[0][1] < 16) {
      return null;
    }

    const primarySpecialization = sortedSpecs[0][0];
    let secondarySpecialization: Specialization | null = null;

    if (sortedSpecs.length > 1) {
      const second = sortedSpecs[1];
      if (second[1] >= 16) {
        const nonBackendPrimaries = [
          Specialization.DATA,
          Specialization.AI_ENGINEER,
          Specialization.QA,
          Specialization.DEVOPS,
          Specialization.SECURITY,
          Specialization.UIUX,
        ];
        if (primarySpecialization === Specialization.FULLSTACK) {
          const distinct = sortedSpecs.slice(1).find(
            ([spec, score]) =>
              spec !== Specialization.FRONTEND &&
              spec !== Specialization.BACKEND &&
              score >= 16,
          );
          secondarySpecialization = distinct ? distinct[0] : null;
        } else if (
          nonBackendPrimaries.includes(primarySpecialization) &&
          second[0] === Specialization.BACKEND
        ) {
          const distinct = sortedSpecs.slice(1).find(
            ([spec, score]) =>
              spec !== Specialization.BACKEND &&
              spec !== primarySpecialization &&
              score >= 16,
          );
          secondarySpecialization = distinct ? distinct[0] : null;
        } else {
          secondarySpecialization = second[0];
        }
      }
    }

    return {
      handled: true,
      primarySpecialization,
      secondarySpecialization,
      confidence: 0.75,
      classificationMethod: 'RULE_DESCRIPTION',
      isExcluded: false,
    };
  }

  /**
   * Scores job description and skills against specialization rules.
   */
  public scoreDescription(description: string, skillsText: string = ''): Map<Specialization, number> {
    const scores = new Map<Specialization, number>();

    for (const rule of SPECIALIZATION_TAXONOMY_RULES) {
      let score = 0;
      if (rule.skillsRegex) {
        // Skills text matches (explicit skills array) carry 2x weight
        const skillMatches = skillsText
          ? (skillsText.match(new RegExp(rule.skillsRegex.source, 'gi')) || []).length
          : 0;
        score += skillMatches * rule.weight * 2;

        // Description skill occurrences
        const descSkillMatches = (description.slice(0, 1500).match(new RegExp(rule.skillsRegex.source, 'gi')) || []).length;
        score += descSkillMatches * rule.weight;
      }

      // Title / role matches in description
      const descTitleMatches = (description.slice(0, 1500).match(new RegExp(rule.titleRegex.source, 'gi')) || []).length;
      score += descTitleMatches * rule.weight;

      if (score > 0) {
        scores.set(rule.spec, score);
      }
    }

    return scores;
  }
}

export const contextualDescriptionStage = new ContextualDescriptionStage();

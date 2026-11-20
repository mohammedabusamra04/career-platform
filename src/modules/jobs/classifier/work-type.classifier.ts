import { WorkType } from '@prisma/client';

/**
 * Contract & Employment Type Heuristic Engine (TASK-32.2 / Issue #98).
 *
 * Evaluates job employment type deterministically using a tiered precedence model:
 * 1. Structured source field (`job.workType` / source metadata).
 * 2. Title-level explicit work type tokens (English & Arabic).
 * 3. Description keyword heuristics.
 * 4. Contradiction detection: contradictory evidence degrades safely to UNKNOWN.
 * 5. Conservative default: absent evidence remains UNKNOWN (do not invent certainty).
 */
export class WorkTypeClassifier {
  // --- Token Regular Expressions (Word Boundaries & Case-Insensitive) ---

  // Contract & Freelance keywords (contract, freelance, contractor, consultant, project-based, b2b, 3 months contract)
  private static readonly CONTRACT_REGEX =
    /\b(?:contract|freelance|freelancer|contractor|consultant|temporary|temp|fixed[- ]term|project[- ]based|b2b)\b|(?:\b\d+\s*(?:months?|wks?|weeks?|yrs?|years?)\s+contract\b)|(?:عقد|عمل\s+حر|مستقل|فريلانس(?:ر)?|عقد\s+محدد\s+المدة|مشروع\s+مؤقت|تعاقد)/i;

  // Part-Time keywords
  private static readonly PART_TIME_REGEX =
    /\b(?:part[- ]time|parttime)\b|(?:دوام\s+جزئي|عمل\s+جزئي|نصف\s+دوام)/i;

  // Internship & Trainee keywords
  private static readonly INTERNSHIP_REGEX =
    /\b(?:intern|internship|trainee|apprentice|co[- ]?op|student\s+worker|working\s+student)\b|(?:تدريب|متدرب|تدريب\s+تعاوني|تدريب\s+عملي)/i;

  // Full-Time keywords
  private static readonly FULL_TIME_REGEX =
    /\b(?:full[- ]time|fulltime|permanent|direct[- ]hire)\b|(?:دوام\s+كامل|عمل\s+كامل|وظيفة\s+دائمة|تفرغ\s+تام)/i;

  /**
   * Classifies the work/employment type for a given job.
   */
  public classify(job: {
    title?: string | null;
    description?: string | null;
    workType?: string | WorkType | null;
  }): WorkType {
    // 1. Structured source field mapping
    if (job.workType) {
      const structured = this.normalizeStructuredWorkType(job.workType);
      if (structured !== WorkType.UNKNOWN) {
        return structured;
      }
    }

    const title = (job.title || '').trim();
    const descSample = (job.description || '').slice(0, 1000);

    // 2. Title-Level Explicit Token Matching (Highest Textual Confidence)
    const hasContractTitle = WorkTypeClassifier.CONTRACT_REGEX.test(title);
    const hasPartTimeTitle = WorkTypeClassifier.PART_TIME_REGEX.test(title);
    const hasInternshipTitle = WorkTypeClassifier.INTERNSHIP_REGEX.test(title);
    const hasFullTimeTitle = WorkTypeClassifier.FULL_TIME_REGEX.test(title);

    const titleMatchCount =
      Number(hasContractTitle) +
      Number(hasPartTimeTitle) +
      Number(hasInternshipTitle) +
      Number(hasFullTimeTitle);

    // Contradiction in title itself (e.g. "Full-time / Part-time Engineer")
    if (titleMatchCount > 1) {
      return WorkType.UNKNOWN;
    }

    if (hasContractTitle) return WorkType.CONTRACT;
    if (hasPartTimeTitle) return WorkType.PART_TIME;
    if (hasInternshipTitle) return WorkType.INTERNSHIP;
    if (hasFullTimeTitle) return WorkType.FULL_TIME;

    // 3. Description Keyword Heuristics
    const hasContractDesc = WorkTypeClassifier.CONTRACT_REGEX.test(descSample);
    const hasPartTimeDesc = WorkTypeClassifier.PART_TIME_REGEX.test(descSample);
    const hasInternshipDesc = WorkTypeClassifier.INTERNSHIP_REGEX.test(descSample);
    const hasFullTimeDesc = WorkTypeClassifier.FULL_TIME_REGEX.test(descSample);

    const descMatchCount =
      Number(hasContractDesc) +
      Number(hasPartTimeDesc) +
      Number(hasInternshipDesc) +
      Number(hasFullTimeDesc);

    // If only one distinct work type is indicated in the description, accept it
    if (descMatchCount === 1) {
      if (hasContractDesc) return WorkType.CONTRACT;
      if (hasPartTimeDesc) return WorkType.PART_TIME;
      if (hasInternshipDesc) return WorkType.INTERNSHIP;
      if (hasFullTimeDesc) return WorkType.FULL_TIME;
    }

    // 4. Default conservative fallback: Do not invent certainty
    return WorkType.UNKNOWN;
  }

  /**
   * Normalizes structured work types from varying job board sources.
   */
  private normalizeStructuredWorkType(raw: string | WorkType): WorkType {
    const str = String(raw).trim().toUpperCase().replace(/[\s-]/g, '_');

    switch (str) {
      case 'FULL_TIME':
      case 'FULLTIME':
      case 'PERMANENT':
      case 'REGULAR':
      case 'DIRECT_HIRE':
      case 'EMPLOYEE':
        return WorkType.FULL_TIME;

      case 'PART_TIME':
      case 'PARTTIME':
        return WorkType.PART_TIME;

      case 'CONTRACT':
      case 'CONTRACTOR':
      case 'FREELANCE':
      case 'FREELANCER':
      case 'TEMPORARY':
      case 'TEMP':
      case 'CORP_TO_CORP':
      case 'C2C':
      case '1099':
        return WorkType.CONTRACT;

      case 'INTERNSHIP':
      case 'INTERN':
      case 'TRAINEE':
      case 'COOP':
      case 'CO_OP':
      case 'APPRENTICE':
        return WorkType.INTERNSHIP;

      default:
        return WorkType.UNKNOWN;
    }
  }
}

export const workTypeClassifier = new WorkTypeClassifier();

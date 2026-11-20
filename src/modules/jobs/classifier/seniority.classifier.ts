import { ExperienceLevel } from '@prisma/client';

/**
 * Seniority Heuristic Engine (TASK-32.1 / Issue #97).
 *
 * Evaluates job seniority deterministically using a tiered precedence model:
 * 1. Structured source field (`job.experienceLevel`).
 * 2. Title-level explicit seniority tokens (English & Arabic).
 * 3. Years of experience numerical extraction in title and description.
 * 4. Contradiction detection: contradictory evidence degrades safely to UNKNOWN.
 * 5. Conservative default: absent evidence remains UNKNOWN (do not invent certainty).
 */
export class SeniorityClassifier {
  // Senior / Leadership keywords
  private static readonly SENIOR_TITLE_REGEX =
    /\b(?:senior|sr\.?|lead|staff|principal|architect|head of|director|vp|chief|expert|distinguished)\b|(?:\b(?:tech|team)\s+lead\b)|(?:خبير|أول|سينيور|قائد\s+فريق|رئيس\s+(?:قسم|فريق)?|معماري|مهندس\s+رئيسي)/i;

  // Junior / Entry-level keywords
  private static readonly JUNIOR_TITLE_REGEX =
    /\b(?:junior|jr\.?|entry[- ]level|associate|fresh graduate|intern|internship|trainee|apprentice|beginner)\b|(?:مبتدئ|جونيور|حديث\s+التخرج|متدرب|مساعد)/i;

  // Mid-level keywords
  private static readonly MID_TITLE_REGEX =
    /\b(?:mid[- ]level|intermediate|medior|middle)\b|(?:متوسط\s+الخبرة|متوسط)/i;

  /**
   * Classifies the seniority level for a given job.
   */
  public classify(job: {
    title?: string | null;
    description?: string | null;
    experienceLevel?: string | ExperienceLevel | null;
  }): ExperienceLevel {
    // 1. Structured source field mapping
    if (job.experienceLevel) {
      const structured = this.normalizeStructuredLevel(job.experienceLevel);
      if (structured !== ExperienceLevel.UNKNOWN) {
        return structured;
      }
    }

    const title = (job.title || '').trim();
    const descSample = (job.description || '').slice(0, 1000);

    // 2. Title Seniority Token Matching (Highest Confidence)
    const hasSeniorTitle = SeniorityClassifier.SENIOR_TITLE_REGEX.test(title);
    const hasJuniorTitle = SeniorityClassifier.JUNIOR_TITLE_REGEX.test(title);
    const hasMidTitle = SeniorityClassifier.MID_TITLE_REGEX.test(title);

    // Contradiction in title itself (e.g., "Junior / Senior Engineer")
    const titleMatchCount = Number(hasSeniorTitle) + Number(hasJuniorTitle) + Number(hasMidTitle);
    if (titleMatchCount > 1) {
      return ExperienceLevel.UNKNOWN;
    }

    if (hasSeniorTitle) return ExperienceLevel.SENIOR;
    if (hasJuniorTitle) return ExperienceLevel.JUNIOR;
    if (hasMidTitle) return ExperienceLevel.MID;

    // 3. Years of Experience Numerical Analysis (Title + Description)
    const combinedText = `${title} ${descSample}`;
    const yearsLevel = this.extractYearsOfExperience(combinedText);
    if (yearsLevel && yearsLevel !== ExperienceLevel.UNKNOWN) {
      return yearsLevel;
    }

    // 4. Description Keyword Heuristics
    const hasSeniorDesc = SeniorityClassifier.SENIOR_TITLE_REGEX.test(descSample);
    const hasJuniorDesc = SeniorityClassifier.JUNIOR_TITLE_REGEX.test(descSample);
    const hasMidDesc = SeniorityClassifier.MID_TITLE_REGEX.test(descSample);

    const descMatchCount = Number(hasSeniorDesc) + Number(hasJuniorDesc) + Number(hasMidDesc);
    if (descMatchCount === 1) {
      if (hasSeniorDesc) return ExperienceLevel.SENIOR;
      if (hasJuniorDesc) return ExperienceLevel.JUNIOR;
      if (hasMidDesc) return ExperienceLevel.MID;
    }

    // 5. Default conservative fallback: Do not invent certainty
    return ExperienceLevel.UNKNOWN;
  }

  /**
   * Extracts years of experience numerically and classifies the appropriate seniority tier.
   */
  private extractYearsOfExperience(text: string): ExperienceLevel | null {
    if (
      /(?:\b(?:less than|under)\s*(?:1|2)\s*(?:years?|yrs?)\b)|(?:\b(?:no|0)\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b)|(?:أقل\s+من\s+سنتين)/i.test(
        text,
      )
    ) {
      return ExperienceLevel.JUNIOR;
    }

    const regex =
      /(?:(?:at\s+least|minimum|min\.?|خبرة|أكثر\s+من)\s+)?(\d+)\s*(?:-\s*(\d+))?(\+)?\s*(?:years?|yrs?|سنوات|سنة|عاماً|أعوام)/gi;

    let match: RegExpExecArray | null;
    let detectedLevel: ExperienceLevel | null = null;

    while ((match = regex.exec(text)) !== null) {
      const min = parseInt(match[1], 10);
      const max = match[2] ? parseInt(match[2], 10) : min;
      const hasPlus = Boolean(match[3]) || /at\s+least|minimum|min\.?|\+|أكثر/i.test(match[0]);

      let level: ExperienceLevel;
      if (min >= 5 || (min === 5 && hasPlus) || (min >= 4 && hasPlus)) {
        level = ExperienceLevel.SENIOR;
      } else if (min >= 2 || (max >= 3 && max <= 5)) {
        level = ExperienceLevel.MID;
      } else if (max <= 2) {
        level = ExperienceLevel.JUNIOR;
      } else {
        level = ExperienceLevel.UNKNOWN;
      }

      if (level !== ExperienceLevel.UNKNOWN) {
        if (detectedLevel && detectedLevel !== level) {
          // Contradiction detected
          return ExperienceLevel.UNKNOWN;
        }
        detectedLevel = level;
      }
    }

    return detectedLevel;
  }

  /**
   * Normalizes structured levels from varying job board sources.
   */
  private normalizeStructuredLevel(raw: string | ExperienceLevel): ExperienceLevel {
    const str = String(raw).trim().toUpperCase();

    switch (str) {
      case 'SENIOR':
      case 'SR':
      case 'LEAD':
      case 'PRINCIPAL':
      case 'STAFF':
      case 'EXPERT':
      case 'EXECUTIVE':
      case 'DIRECTOR':
        return ExperienceLevel.SENIOR;

      case 'MID':
      case 'MID_LEVEL':
      case 'MIDDLE':
      case 'INTERMEDIATE':
      case 'MEDIOR':
        return ExperienceLevel.MID;

      case 'JUNIOR':
      case 'JR':
      case 'ENTRY':
      case 'ENTRY_LEVEL':
      case 'ASSOCIATE':
      case 'INTERN':
      case 'INTERNSHIP':
      case 'TRAINEE':
      case 'GRADUATE':
      case 'FRESH_GRADUATE':
        return ExperienceLevel.JUNIOR;

      default:
        return ExperienceLevel.UNKNOWN;
    }
  }
}

export const seniorityClassifier = new SeniorityClassifier();

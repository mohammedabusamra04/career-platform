export interface ExclusionResult {
  isExcluded: boolean;
  reason?: string;
  matchedPattern?: string;
}

/**
 * TASK-30.2: Explicit Exclusion Negative Matcher.
 * Evaluates job titles against non-technical / recruiter / sales patterns prior to positive classification.
 */
export class NegativeExclusionMatcher {
  private static readonly EXCLUSION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    // 1. Recruiter & Talent Acquisition (e.g. "Technical Recruiter", "QA Recruitment Consultant")
    {
      pattern: /\b(?:recruiter|recruitment|talent acquisition|headhunter)\b/i,
      label: 'recruiter',
    },
    // 2. Sales & Account Executives (e.g. "DevOps Sales Manager", "Software Sales Account Executive")
    {
      pattern:
        /\b(?:sales manager|account manager|account executive|software sales|sales representative|business development representative|bdr|sdr)\b/i,
      label: 'sales',
    },
    // 3. Marketing & Content (e.g. "Marketing Specialist", "Content Writer", "Copywriter")
    {
      pattern:
        /\b(?:marketing specialist|marketing manager|digital marketing|content writer|copywriter)\b/i,
      label: 'marketing/writing',
    },
    // 4. Support & Administration (e.g. "Customer Support Specialist", "Executive Assistant")
    {
      pattern:
        /\b(?:customer support|customer service|executive assistant|office manager)\b/i,
      label: 'support/admin',
    },
    // 5. Native Arabic non-technical patterns
    {
      pattern:
        /(?:مسؤول توظيف|أخصائي توظيف|استقطاب مواهب|مدير مبيعات|مندوب مبيعات|أخصائي تسويق|خدمة عملاء|كاتب محتوى|مساعد تنفيذي)/,
      label: 'arabic_non_technical',
    },
  ];

  /**
   * Evaluates a job title against explicit negative exclusion patterns.
   * If matched, flags the posting as non-technical for rejection.
   */
  public evaluate(title: string): ExclusionResult {
    if (!title || !title.trim()) {
      return { isExcluded: false };
    }

    const clean = title.trim();
    for (const entry of NegativeExclusionMatcher.EXCLUSION_PATTERNS) {
      if (entry.pattern.test(clean)) {
        return {
          isExcluded: true,
          reason: `Matched negative pattern: ${entry.label}`,
          matchedPattern: entry.label,
        };
      }
    }

    return { isExcluded: false };
  }
}

export const negativeExclusionMatcher = new NegativeExclusionMatcher();

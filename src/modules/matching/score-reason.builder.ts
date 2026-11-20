import { Specialization } from '../preferences/preference.taxonomy.js';
import { hardFilterEngine } from './hard-filter.engine.js';
import type {
  ScoreBreakdown,
  ScoringResult,
  ScorableJob,
  ScoringCandidatePreferences,
} from './scoring.calculator.js';

export const SPECIALIZATION_ARABIC_NAMES: Record<Specialization, string> = {
  [Specialization.BACKEND]: 'الواجهات الخلفية (Backend)',
  [Specialization.FRONTEND]: 'الواجهات الأمامية (Frontend)',
  [Specialization.FULLSTACK]: 'تطوير الويب الشامل (Full-Stack)',
  [Specialization.MOBILE]: 'تطبيقات الهاتف (Mobile)',
  [Specialization.DEVOPS]: 'العمليات السحابية (DevOps)',
  [Specialization.UIUX]: 'تصميم واجهة وتجربة المستخدم (UI/UX)',
  [Specialization.DATA]: 'البيانات وتحليلها (Data)',
  [Specialization.QA]: 'ضمان الجودة والفحص (QA)',
  [Specialization.SECURITY]: 'الأمن السيبراني (Security)',
  [Specialization.AI_ENGINEER]: 'الذكاء الاصطناعي (AI/ML)',
};

export const SPECIALIZATION_ENGLISH_NAMES: Record<Specialization, string> = {
  [Specialization.BACKEND]: 'Backend Development',
  [Specialization.FRONTEND]: 'Frontend Development',
  [Specialization.FULLSTACK]: 'Full-Stack Development',
  [Specialization.MOBILE]: 'Mobile Development',
  [Specialization.DEVOPS]: 'DevOps & Cloud',
  [Specialization.UIUX]: 'UI/UX Design',
  [Specialization.DATA]: 'Data & Analytics',
  [Specialization.QA]: 'QA & Testing',
  [Specialization.SECURITY]: 'Cybersecurity',
  [Specialization.AI_ENGINEER]: 'AI / Machine Learning',
};

export interface ExplanationContext {
  job: ScorableJob;
  preferences: ScoringCandidatePreferences;
  breakdown: ScoreBreakdown;
  score: number;
}

export class TransparentExplanationBuilder {
  /**
   * Generates localized bullet points explaining each component of the match score.
   */
  public buildReasons(
    breakdown: ScoreBreakdown,
    context?: {
      job?: ScorableJob;
      preferences?: ScoringCandidatePreferences;
    },
    language: 'ar' | 'en' = 'ar',
  ): string[] {
    return language === 'en'
      ? this.buildEnglishReasons(breakdown, context)
      : this.buildArabicReasons(breakdown, context);
  }

  /**
   * Generates developer-friendly Arabic explanation bullet points (DeployMe tone).
   */
  private buildArabicReasons(
    breakdown: ScoreBreakdown,
    context?: {
      job?: ScorableJob;
      preferences?: ScoringCandidatePreferences;
    },
  ): string[] {
    const reasons: string[] = [];

    // 1. Specialization explanation
    if (breakdown.specializationScore === 50) {
      const primarySpec = context?.preferences?.specializations?.[0];
      const specLabel = primarySpec ? SPECIALIZATION_ARABIC_NAMES[primarySpec] || primarySpec : '';
      reasons.push(
        specLabel
          ? `🎯 تطابق صريح مع تخصصك الأساسي: ${specLabel} (+50)`
          : `🎯 تطابق صريح مع تخصصك الأساسي (+50)`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 بتطابق تخصصك الثانوي (+30)`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💻 مستوى الخبرة مفصّل على بروفايلك (+15)`);
    } else if (breakdown.levelScore === 10) {
      if (!context?.preferences?.experienceLevel || context?.preferences?.experienceLevel === 'ANY') {
        reasons.push(`💻 مفتوحة لكل مستويات الخبرة (+10)`);
      } else {
        reasons.push(`💻 مستوى الخبرة مرن وغير مقيد (+10)`);
      }
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 شغل Remote عالمي — اشتغل من أي مكان (+15)`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 فرصة موجهة للمنطقة العربية والشرق الأوسط (+15)`);
      } else {
        reasons.push(`🌐 بتطابق تفضيلاتك الجغرافية ونطاق الـ Remote (+15)`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ فرصة جديدة — لسه نازلة اليوم (+10)`);
    } else if (breakdown.freshnessScore >= 7) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ نازلة قريب (منذ ${days} ${days === 1 ? 'يوم' : days === 2 ? 'يومين' : 'أيام'}) (+${breakdown.freshnessScore})`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`📅 نازلة من ${days} أيام (+${breakdown.freshnessScore})`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 تقديم مباشر على ATS الشركة بدون وسطاء (+5)`);
    }

    return reasons;
  }

  /**
   * Generates developer-friendly English explanation bullet points.
   */
  private buildEnglishReasons(
    breakdown: ScoreBreakdown,
    context?: {
      job?: ScorableJob;
      preferences?: ScoringCandidatePreferences;
    },
  ): string[] {
    const reasons: string[] = [];

    // 1. Specialization explanation
    if (breakdown.specializationScore === 50) {
      const primarySpec = context?.preferences?.specializations?.[0];
      const specLabel = primarySpec ? SPECIALIZATION_ENGLISH_NAMES[primarySpec] || primarySpec : '';
      reasons.push(
        specLabel
          ? `🎯 Direct hit on your primary stack: ${specLabel} (+50)`
          : `🎯 Direct hit on your primary specialization (+50)`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 Matches your secondary specialization (+30)`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💻 Seniority level matches your profile (+15)`);
    } else if (breakdown.levelScore === 10) {
      reasons.push(`💻 Flexible / open seniority level (+10)`);
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 Worldwide Remote — work from anywhere (+15)`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 Targeted for the Arab / MENA tech market (+15)`);
      } else {
        reasons.push(`🌐 Fits your remote & location preferences (+15)`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ Fresh build — posted today (+10)`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ Posted ${days} ${days === 1 ? 'day' : 'days'} ago (+${breakdown.freshnessScore})`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 Direct company ATS link — no middlemen (+5)`);
    }

    return reasons;
  }

  /**
   * Formats a complete transparent score report for message dispatch.
   */
  public formatScoreReport(
    result: ScoringResult,
    context?: {
      job?: ScorableJob;
      preferences?: ScoringCandidatePreferences;
    },
    language: 'ar' | 'en' = 'ar',
  ): string {
    const reasons = this.buildReasons(result.breakdown, context, language);

    if (language === 'en') {
      const header = `🎯 *Stack Fit Score: ${result.score}% (${result.score}/100)*`;
      if (reasons.length === 0) {
        return header;
      }
      return `${header}\n${reasons.map((r) => `• ${r}`).join('\n')}`;
    }

    const header = `🎯 *نسبة تطابق الـ Stack: ${result.score}% (${result.score}/100)*`;
    if (reasons.length === 0) {
      return header;
    }
    return `${header}\n${reasons.map((r) => `• ${r}`).join('\n')}`;
  }

  /**
   * Formats a concise one-line summary.
   */
  public formatShortSummary(
    result: ScoringResult,
    context?: {
      job?: ScorableJob;
      preferences?: ScoringCandidatePreferences;
    },
    language: 'ar' | 'en' = 'ar',
  ): string {
    const reasons = this.buildReasons(result.breakdown, context, language);
    const topReason = reasons[0] || (language === 'en' ? 'General stack fit' : 'تطابق عام');

    if (language === 'en') {
      return `[${result.score}% Fit] ${topReason}`;
    }
    return `[تطابق ${result.score}%] ${topReason}`;
  }
}

export const transparentExplanationBuilder = new TransparentExplanationBuilder();
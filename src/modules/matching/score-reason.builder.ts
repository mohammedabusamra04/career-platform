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
   * Generates detailed Arabic explanation bullet points.
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
          ? `🎯 تطابق تام مع تخصصك الأساسي: ${specLabel} (+50)`
          : `🎯 تطابق تام مع تخصصك الأساسي (+50)`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 تطابق مع تخصصك الثانوي (+30)`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💼 مستوى الخبرة متطابق تماماً مع ملفك (+15)`);
    } else if (breakdown.levelScore === 10) {
      if (!context?.preferences?.experienceLevel || context?.preferences?.experienceLevel === 'ANY') {
        reasons.push(`💼 مناسبة لكافة مستويات الخبرة (+10)`);
      } else {
        reasons.push(`💼 مستوى الخبرة مرن / غير مقيد (+10)`);
      }
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 عمل عن بُعد متاح عالمياً من أي مكان (+15)`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 وظيفة مناسبة وموجهة للمنطقة العربية (+15)`);
      } else {
        reasons.push(`🌐 تطابق مع تفضيلاتك الجغرافية ونطاق العمل عن بُعد (+15)`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ فرصة جديدة طازجة (نُشرت اليوم) (+10)`);
    } else if (breakdown.freshnessScore >= 7) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ نُشرت حديثاً (منذ ${days} ${days === 1 ? 'يوم' : days === 2 ? 'يومين' : 'أيام'}) (+${breakdown.freshnessScore})`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`📅 نُشرت منذ ${days} أيام (+${breakdown.freshnessScore})`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 تقديم مباشر عبر نظام توظيف الشركة المعتمد (ATS) (+5)`);
    }

    return reasons;
  }

  /**
   * Generates English explanation bullet points.
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
          ? `🎯 Exact match with your primary specialization: ${specLabel} (+50)`
          : `🎯 Exact match with your primary specialization (+50)`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 Matches your secondary specialization (+30)`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💼 Experience level matches your profile exactly (+15)`);
    } else if (breakdown.levelScore === 10) {
      reasons.push(`💼 Open / flexible experience level (+10)`);
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 Worldwide remote (work from anywhere) (+15)`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 Targeted to the Arab region / Middle East (+15)`);
      } else {
        reasons.push(`🌐 Matches your remote region preference (+15)`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ Fresh opportunity (published today) (+10)`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ Recently posted (${days} ${days === 1 ? 'day' : 'days'} ago) (+${breakdown.freshnessScore})`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 Direct application via company ATS (+5)`);
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
      const header = `🎯 **Match Score: ${result.score}% (${result.score}/100)**`;
      if (reasons.length === 0) {
        return header;
      }
      return `${header}\n${reasons.map((r) => `• ${r}`).join('\n')}`;
    }

    const header = `🎯 **نسبة التوافق: ${result.score}% (${result.score}/100)**`;
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
    const topReason = reasons[0] || (language === 'en' ? 'General match' : 'تطابق عام');

    if (language === 'en') {
      return `[${result.score}% Match] ${topReason}`;
    }
    return `[توافق ${result.score}%] ${topReason}`;
  }
}

export const transparentExplanationBuilder = new TransparentExplanationBuilder();

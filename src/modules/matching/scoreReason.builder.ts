import { Specialization } from '../preferences/preference.taxonomy.js';
import { hardFilterEngine } from './hardFilter.engine.js';
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
          ? `🎯 تطابق صريح مع تخصصك الأساسي: ${specLabel}`
          : `🎯 تطابق صريح مع تخصصك الأساسي`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 بتطابق تخصصك الثانوي`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💻 مستوى الخبرة مفصّل على بروفايلك`);
    } else if (breakdown.levelScore === 10) {
      if (!context?.preferences?.experienceLevel || context?.preferences?.experienceLevel === 'ANY') {
        reasons.push(`💻 مفتوحة لكل مستويات الخبرة`);
      } else {
        reasons.push(`💻 مستوى الخبرة مرن وغير مقيد`);
      }
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 شغل Remote عالمي — اشتغل من أي مكان`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 فرصة موجهة للمنطقة العربية والشرق الأوسط`);
      } else {
        reasons.push(`🌐 بتطابق تفضيلاتك الجغرافية ونطاق الـ Remote`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ فرصة جديدة — لسه نازلة اليوم`);
    } else if (breakdown.freshnessScore >= 7) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ نازلة قريب (منذ ${days} ${days === 1 ? 'يوم' : days === 2 ? 'يومين' : 'أيام'})`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`📅 نازلة من ${days} أيام`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 تقديم مباشر على موقع الشركة الرسمي بدون وسطاء`);
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
          ? `🎯 Direct hit on your primary stack: ${specLabel}`
          : `🎯 Direct hit on your primary specialization`,
      );
    } else if (breakdown.specializationScore === 30) {
      reasons.push(`🎯 Matches your secondary specialization`);
    }

    // 2. Experience Level explanation
    if (breakdown.levelScore === 15) {
      reasons.push(`💻 Seniority level matches your profile`);
    } else if (breakdown.levelScore === 10) {
      reasons.push(`💻 Flexible / open seniority level`);
    }

    // 3. Region / Remote Scope explanation
    if (breakdown.regionScore === 15) {
      const scope = (context?.job?.remoteScope || '').toUpperCase();
      if (scope === 'WORLDWIDE') {
        reasons.push(`🌍 Worldwide Remote — work from anywhere`);
      } else if (context?.job && hardFilterEngine.isArabMarketJob(context.job)) {
        reasons.push(`📍 Targeted for the Arab / MENA tech market`);
      } else {
        reasons.push(`🌐 Fits your remote & location preferences`);
      }
    }

    // 4. Freshness explanation
    if (breakdown.freshnessScore === 10) {
      reasons.push(`⚡ Fresh build — posted today`);
    } else if (breakdown.freshnessScore > 0) {
      const days = 10 - breakdown.freshnessScore;
      reasons.push(`⏱️ Posted ${days} ${days === 1 ? 'day' : 'days'} ago`);
    }

    // 5. Direct ATS source explanation
    if (breakdown.atsScore === 5) {
      reasons.push(`🏢 Direct company ATS link — no middlemen`);
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

    const badge =
      result.score >= 80
        ? language === 'en' ? '🎯 High Stack Fit' : '🎯 تطابق قوي مع الـ Stack'
        : result.score >= 65
          ? language === 'en' ? '⚡ Solid Match' : '⚡ تطابق جيد مع الـ Stack'
          : language === 'en' ? '🌱 Partial Match' : '🌱 تطابق مبدئي مع الـ Stack';

    const header = `*${badge}*`;
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

    const badge =
      result.score >= 80
        ? language === 'en' ? 'High Fit' : 'تطابق قوي'
        : result.score >= 65
          ? language === 'en' ? 'Solid Match' : 'تطابق جيد'
          : language === 'en' ? 'Partial Match' : 'تطابق مبدئي';

    return `[${badge}] ${topReason}`;
  }
}

export const transparentExplanationBuilder = new TransparentExplanationBuilder();
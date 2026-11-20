import { describe, it, expect } from 'vitest';
import {
  TransparentExplanationBuilder,
  transparentExplanationBuilder,
  SPECIALIZATION_ARABIC_NAMES,
  SPECIALIZATION_ENGLISH_NAMES,
} from '../../src/modules/matching/score-reason.builder.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';
import type { ScoreBreakdown, ScoringResult } from '../../src/modules/matching/scoring.calculator.js';

describe('TransparentExplanationBuilder (TASK-38.2)', () => {
  const builder = new TransparentExplanationBuilder();

  describe('Specialization Localization Names', () => {
    it('covers all 10 approved specializations in Arabic and English', () => {
      const specs = Object.values(Specialization);
      for (const spec of specs) {
        expect(SPECIALIZATION_ARABIC_NAMES[spec]).toBeDefined();
        expect(SPECIALIZATION_ENGLISH_NAMES[spec]).toBeDefined();
        expect(SPECIALIZATION_ARABIC_NAMES[spec].length).toBeGreaterThan(0);
        expect(SPECIALIZATION_ENGLISH_NAMES[spec].length).toBeGreaterThan(0);
      }
    });
  });

  describe('Arabic Reason Generation', () => {
    it('generates rich explanation for a 95-point perfect match job', () => {
      const breakdown: ScoreBreakdown = {
        specializationScore: 50,
        levelScore: 15,
        regionScore: 15,
        freshnessScore: 10,
        atsScore: 5,
        rawTotal: 95,
        totalScore: 95,
      };

      const reasons = builder.buildReasons(
        breakdown,
        {
          preferences: {
            specializations: [Specialization.BACKEND],
            regionPreference: RegionPreference.BOTH,
          },
          job: {
            title: 'Senior Backend Engineer',
            specialization: 'BACKEND',
            remoteScope: 'WORLDWIDE',
          },
        },
        'ar',
      );

      expect(reasons).toHaveLength(5);
      expect(reasons[0]).toContain('تطابق صريح مع تخصصك الأساسي');
      expect(reasons[0]).toContain('الواجهات الخلفية');
      expect(reasons[0]).toContain('+50');
      expect(reasons[1]).toContain('مستوى الخبرة مفصّل على بروفايلك');
      expect(reasons[1]).toContain('+15');
      expect(reasons[2]).toContain('شغل Remote عالمي');
      expect(reasons[2]).toContain('+15');
      expect(reasons[3]).toContain('فرصة جديدة — لسه نازلة اليوم');
      expect(reasons[3]).toContain('+10');
      expect(reasons[4]).toContain('تقديم مباشر على ATS الشركة');
      expect(reasons[4]).toContain('+5');
    });

    it('generates appropriate explanation for secondary match and Arab market job', () => {
      const breakdown: ScoreBreakdown = {
        specializationScore: 30,
        levelScore: 10,
        regionScore: 15,
        freshnessScore: 8,
        atsScore: 0,
        rawTotal: 63,
        totalScore: 63,
      };

      const reasons = builder.buildReasons(
        breakdown,
        {
          preferences: {
            specializations: [Specialization.FULLSTACK, Specialization.FRONTEND],
            regionPreference: RegionPreference.ARAB,
          },
          job: {
            title: 'Frontend Developer',
            specialization: 'FRONTEND',
            country: 'EG',
          },
        },
        'ar',
      );

      expect(reasons).toHaveLength(4);
      expect(reasons[0]).toContain('بتطابق تخصصك الثانوي (+30)');
      expect(reasons[1]).toContain('مفتوحة لكل مستويات الخبرة (+10)');
      expect(reasons[2]).toContain('فرصة موجهة للمنطقة العربية والشرق الأوسط (+15)');
      expect(reasons[3]).toContain('نازلة قريب (منذ 2 يومين) (+8)');
    });

    it('handles zero or minimal scores without error', () => {
      const breakdown: ScoreBreakdown = {
        specializationScore: 0,
        levelScore: 0,
        regionScore: 0,
        freshnessScore: 0,
        atsScore: 0,
        rawTotal: 0,
        totalScore: 0,
      };

      const reasons = builder.buildReasons(breakdown, {}, 'ar');
      expect(reasons).toEqual([]);
    });
  });

  describe('English Reason Generation', () => {
    it('generates English explanations properly', () => {
      const breakdown: ScoreBreakdown = {
        specializationScore: 50,
        levelScore: 15,
        regionScore: 15,
        freshnessScore: 10,
        atsScore: 5,
        rawTotal: 95,
        totalScore: 95,
      };

      const reasons = builder.buildReasons(
        breakdown,
        {
          preferences: {
            specializations: [Specialization.AI_ENGINEER],
            regionPreference: RegionPreference.INTERNATIONAL,
          },
          job: {
            title: 'AI Engineer',
            specialization: 'AI_ENGINEER',
            remoteScope: 'WORLDWIDE',
          },
        },
        'en',
      );

      expect(reasons).toHaveLength(5);
      expect(reasons[0]).toContain('Direct hit on your primary stack');
      expect(reasons[0]).toContain('AI / Machine Learning');
      expect(reasons[1]).toContain('Seniority level matches your profile');
      expect(reasons[2]).toContain('Worldwide Remote');
      expect(reasons[3]).toContain('Fresh build — posted today');
      expect(reasons[4]).toContain('Direct company ATS link');
    });
  });

  describe('Formatting Reports & Summaries', () => {
    it('formats a full Markdown report in Arabic', () => {
      const result: ScoringResult = {
        score: 85,
        breakdown: {
          specializationScore: 50,
          levelScore: 15,
          regionScore: 15,
          freshnessScore: 5,
          atsScore: 0,
          rawTotal: 85,
          totalScore: 85,
        },
        isEligibleForDigest: true,
      };

      const report = builder.formatScoreReport(
        result,
        {
          preferences: {
            specializations: [Specialization.BACKEND],
            regionPreference: RegionPreference.BOTH,
          },
          job: {
            title: 'Backend Developer',
            remoteScope: 'WORLDWIDE',
          },
        },
        'ar',
      );

      expect(report).toContain('🎯 *نسبة تطابق الـ Stack: 85% (85/100)*');
      expect(report).toContain('• 🎯 تطابق صريح مع تخصصك الأساسي');
      expect(report).toContain('• 💻 مستوى الخبرة مفصّل على بروفايلك');
      expect(report).toContain('• 🌍 شغل Remote عالمي');
      expect(report).toContain('• 📅 نازلة من 5 أيام (+5)');
    });

    it('formats a short one-line summary', () => {
      const result: ScoringResult = {
        score: 90,
        breakdown: {
          specializationScore: 50,
          levelScore: 15,
          regionScore: 15,
          freshnessScore: 10,
          atsScore: 0,
          rawTotal: 90,
          totalScore: 90,
        },
        isEligibleForDigest: true,
      };

      const summaryAr = builder.formatShortSummary(result, {}, 'ar');
      expect(summaryAr).toContain('[تطابق 90%]');
      expect(summaryAr).toContain('تطابق صريح مع تخصصك الأساسي');

      const summaryEn = builder.formatShortSummary(result, {}, 'en');
      expect(summaryEn).toContain('[90% Fit]');
      expect(summaryEn).toContain('Direct hit on your primary');
    });

    it('exports singleton transparentExplanationBuilder instance', () => {
      expect(transparentExplanationBuilder).toBeInstanceOf(TransparentExplanationBuilder);
    });
  });
});

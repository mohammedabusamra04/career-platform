import { describe, it, expect } from 'vitest';
import {
  Specialization,
  APPROVED_SPECIALIZATIONS,
  isApprovedSpecialization,
  RegionPreference,
  ExperienceLevelPreference,
  WorkTypePreference,
  UserPreferenceSchema,
  validateUserPreferences,
  safeValidateUserPreferences,
  PreferenceValidationError,
} from '../../../src/modules/preferences/index.js';

describe('Preference Validation & Specialization Taxonomy (TASK-21.2)', () => {
  describe('Taxonomy of 10 Approved Specializations', () => {
    it('contains exactly 10 approved specializations', () => {
      expect(APPROVED_SPECIALIZATIONS).toHaveLength(10);
      expect(APPROVED_SPECIALIZATIONS).toEqual([
        'BACKEND',
        'FRONTEND',
        'FULLSTACK',
        'MOBILE',
        'DEVOPS',
        'UIUX',
        'DATA',
        'QA',
        'SECURITY',
        'AI_ENGINEER',
      ]);
    });

    it('correctly identifies approved and unapproved specializations', () => {
      expect(isApprovedSpecialization('BACKEND')).toBe(true);
      expect(isApprovedSpecialization('frontend')).toBe(true);
      expect(isApprovedSpecialization('AI_ENGINEER')).toBe(true);

      expect(isApprovedSpecialization('BLOCKCHAIN')).toBe(false);
      expect(isApprovedSpecialization('MARKETING')).toBe(false);
      expect(isApprovedSpecialization('')).toBe(false);
    });
  });

  describe('UserPreferenceSchema - Specialization constraints (1 <= length <= 3)', () => {
    it('fails validation when specializations array is empty (length = 0)', () => {
      const payload = { specializations: [] };
      const result = safeValidateUserPreferences(payload);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('At least 1 specialization must be selected');
      }

      expect(() => validateUserPreferences(payload)).toThrow(PreferenceValidationError);
    });

    it('fails validation when 4 specializations are provided (length = 4)', () => {
      const payload = {
        specializations: [
          Specialization.BACKEND,
          Specialization.FRONTEND,
          Specialization.MOBILE,
          Specialization.DEVOPS,
        ],
      };
      const result = safeValidateUserPreferences(payload);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('At most 3 specializations can be selected');
      }

      expect(() => validateUserPreferences(payload)).toThrow(PreferenceValidationError);
    });

    it('successfully validates 1 specialization', () => {
      const payload = { specializations: [Specialization.BACKEND] };
      const validated = validateUserPreferences(payload);

      expect(validated.specializations).toEqual([Specialization.BACKEND]);
      expect(validated.regionPreference).toBe(RegionPreference.BOTH);
    });

    it('successfully validates 2 specializations', () => {
      const payload = {
        specializations: [Specialization.FRONTEND, Specialization.UIUX],
      };
      const validated = validateUserPreferences(payload);

      expect(validated.specializations).toEqual([Specialization.FRONTEND, Specialization.UIUX]);
    });

    it('successfully validates 3 specializations', () => {
      const payload = {
        specializations: [
          Specialization.BACKEND,
          Specialization.DATA,
          Specialization.AI_ENGINEER,
        ],
      };
      const validated = validateUserPreferences(payload);

      expect(validated.specializations).toHaveLength(3);
      expect(validated.specializations).toContain(Specialization.AI_ENGINEER);
    });

    it('fails validation when duplicates are provided within the limit', () => {
      const payload = {
        specializations: [Specialization.BACKEND, Specialization.BACKEND],
      };
      const result = safeValidateUserPreferences(payload);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Duplicate specializations are not allowed');
      }
    });

    it('fails validation when an invalid specialization name is given', () => {
      const payload = {
        specializations: ['CLOUD_ENGINEER'],
      };
      const result = safeValidateUserPreferences(payload);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid specialization');
      }
    });

    it('normalizes lowercase valid specializations to uppercase', () => {
      const payload = {
        specializations: ['backend', 'frontend'],
      };
      const validated = validateUserPreferences(payload);

      expect(validated.specializations).toEqual([
        Specialization.BACKEND,
        Specialization.FRONTEND,
      ]);
    });
  });

  describe('UserPreferenceSchema - Region and Optional Filters', () => {
    it('defaults regionPreference to BOTH if omitted', () => {
      const payload = { specializations: [Specialization.FULLSTACK] };
      const validated = validateUserPreferences(payload);

      expect(validated.regionPreference).toBe(RegionPreference.BOTH);
    });

    it('accepts explicit region preferences (ARAB, INTERNATIONAL, BOTH)', () => {
      expect(
        validateUserPreferences({
          specializations: [Specialization.QA],
          regionPreference: RegionPreference.ARAB,
        }).regionPreference,
      ).toBe(RegionPreference.ARAB);

      expect(
        validateUserPreferences({
          specializations: [Specialization.QA],
          regionPreference: RegionPreference.INTERNATIONAL,
        }).regionPreference,
      ).toBe(RegionPreference.INTERNATIONAL);
    });

    it('fails validation on invalid region preference', () => {
      const payload = {
        specializations: [Specialization.QA],
        regionPreference: 'EUROPE',
      };
      expect(() => validateUserPreferences(payload)).toThrow(PreferenceValidationError);
    });

    it('validates optional experienceLevel and workType filters', () => {
      const payload = {
        specializations: [Specialization.SECURITY],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: ExperienceLevelPreference.SENIOR,
        workType: WorkTypePreference.CONTRACT,
      };

      const validated = validateUserPreferences(payload);

      expect(validated.experienceLevel).toBe(ExperienceLevelPreference.SENIOR);
      expect(validated.workType).toBe(WorkTypePreference.CONTRACT);
    });

    it('allows null or undefined for optional filters', () => {
      const payload = {
        specializations: [Specialization.DEVOPS],
        experienceLevel: null,
        workType: null,
      };

      const validated = validateUserPreferences(payload);

      expect(validated.experienceLevel).toBeNull();
      expect(validated.workType).toBeNull();
    });

    it('fails validation on invalid experience level or work type', () => {
      expect(() =>
        validateUserPreferences({
          specializations: [Specialization.DEVOPS],
          experienceLevel: 'DIRECTOR',
        }),
      ).toThrow(PreferenceValidationError);

      expect(() =>
        validateUserPreferences({
          specializations: [Specialization.DEVOPS],
          workType: 'VOLUNTEER',
        }),
      ).toThrow(PreferenceValidationError);
    });
  });
});

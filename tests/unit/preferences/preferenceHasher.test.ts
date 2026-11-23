import { describe, it, expect } from 'vitest';
import {
  Specialization,
  RegionPreference,
  ExperienceLevelPreference,
  WorkTypePreference,
  computePreferenceHash,
  buildPreferenceVectorString,
} from '../../../src/modules/preferences/index.js';

describe('Equivalence Class Vector Hashing (TASK-21.3)', () => {
  describe('buildPreferenceVectorString', () => {
    it('sorts specializations alphabetically and applies canonical separators', () => {
      const vector = buildPreferenceVectorString({
        specializations: [Specialization.FRONTEND, Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: ExperienceLevelPreference.SENIOR,
        workType: WorkTypePreference.FULL_TIME,
      });

      expect(vector).toBe('BACKEND,FRONTEND|ARAB|SENIOR|FULL_TIME');
    });

    it('defaults omitted region to BOTH and omitted filters to ANY', () => {
      const vector = buildPreferenceVectorString({
        specializations: [Specialization.AI_ENGINEER],
      });

      expect(vector).toBe('AI_ENGINEER|BOTH|ANY|ANY');
    });
  });

  describe('computePreferenceHash', () => {
    it('generates identical hash values for differing specialization orders (order invariance)', () => {
      const hash1 = computePreferenceHash({
        specializations: [Specialization.BACKEND, Specialization.FRONTEND],
        regionPreference: RegionPreference.BOTH,
      });

      const hash2 = computePreferenceHash({
        specializations: [Specialization.FRONTEND, Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it('generates identical hash regardless of input casing or whitespace', () => {
      const hash1 = computePreferenceHash({
        specializations: ['backend', ' frontend '],
        regionPreference: 'both',
      });

      const hash2 = computePreferenceHash({
        specializations: [Specialization.FRONTEND, Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      });

      expect(hash1).toBe(hash2);
    });

    it('produces distinct hashes for differing region preferences', () => {
      const hashBoth = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      });

      const hashArab = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
      });

      const hashInternational = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.INTERNATIONAL,
      });

      expect(hashBoth).not.toBe(hashArab);
      expect(hashBoth).not.toBe(hashInternational);
      expect(hashArab).not.toBe(hashInternational);
    });

    it('produces distinct hashes for differing experience levels', () => {
      const hashJunior = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        experienceLevel: ExperienceLevelPreference.JUNIOR,
      });

      const hashSenior = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        experienceLevel: ExperienceLevelPreference.SENIOR,
      });

      const hashAny = computePreferenceHash({
        specializations: [Specialization.BACKEND],
        experienceLevel: null,
      });

      expect(hashJunior).not.toBe(hashSenior);
      expect(hashJunior).not.toBe(hashAny);
    });

    it('produces distinct hashes for differing work types', () => {
      const hashFullTime = computePreferenceHash({
        specializations: [Specialization.DEVOPS],
        workType: WorkTypePreference.FULL_TIME,
      });

      const hashContract = computePreferenceHash({
        specializations: [Specialization.DEVOPS],
        workType: WorkTypePreference.CONTRACT,
      });

      expect(hashFullTime).not.toBe(hashContract);
    });
  });
});

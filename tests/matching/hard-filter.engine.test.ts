import { describe, it, expect } from 'vitest';
import {
  HardFilterEngine,
  hardFilterEngine,
  type FilterableJob,
  type CandidatePreferences,
} from '../../src/modules/matching/hard-filter.engine.js';
import {
  Specialization,
  RegionPreference,
} from '../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-37.1: Specialization & Region Incompatibility Exclusion (#109)', () => {
  const engine = new HardFilterEngine();

  describe('Specialization Filtering', () => {
    it('accepts job when primarySpecialization matches candidate preference', () => {
      const job: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
      };
      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      };

      const result = engine.evaluate(job, preferences);
      expect(result.passed).toBe(true);
      expect(result.exclusionReason).toBeUndefined();
    });

    it('accepts job when secondarySpecialization matches candidate preference', () => {
      const job: FilterableJob = {
        primarySpecialization: Specialization.FULLSTACK,
        secondarySpecialization: Specialization.BACKEND,
      };
      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      };

      const result = engine.evaluate(job, preferences);
      expect(result.passed).toBe(true);
    });

    it('rejects candidate with [BACKEND] preference on a FRONTEND job with 100% certainty (Test Spec #109)', () => {
      const job: FilterableJob = {
        primarySpecialization: Specialization.FRONTEND,
        secondarySpecialization: null,
      };
      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      };

      const result = engine.evaluate(job, preferences);
      expect(result.passed).toBe(false);
      expect(result.exclusionReason).toBe('SPECIALIZATION_MISMATCH');
      expect(result.details).toContain('FRONTEND');
    });

    it('handles multiple candidate preferences (1..3) accurately', () => {
      const jobDevops: FilterableJob = {
        primarySpecialization: Specialization.DEVOPS,
      };
      const jobMobile: FilterableJob = {
        primarySpecialization: Specialization.MOBILE,
      };
      const jobSec: FilterableJob = {
        primarySpecialization: Specialization.SECURITY,
      };
      const jobData: FilterableJob = {
        primarySpecialization: Specialization.DATA,
      };

      const preferences: CandidatePreferences = {
        specializations: [
          Specialization.DEVOPS,
          Specialization.MOBILE,
          Specialization.SECURITY,
        ],
        regionPreference: RegionPreference.BOTH,
      };

      expect(engine.isSpecializationCompatible(jobDevops, preferences.specializations)).toBe(true);
      expect(engine.isSpecializationCompatible(jobMobile, preferences.specializations)).toBe(true);
      expect(engine.isSpecializationCompatible(jobSec, preferences.specializations)).toBe(true);
      expect(engine.isSpecializationCompatible(jobData, preferences.specializations)).toBe(false);
    });
  });

  describe('Region Filtering: BOTH Preference', () => {
    it('allows all geographic scopes when preference is BOTH', () => {
      const arabJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'EG',
        remoteScope: 'COUNTRY',
      };
      const usJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'US',
        remoteScope: 'COUNTRY',
      };
      const globalRemoteJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'DE',
        remoteScope: 'WORLDWIDE',
      };

      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      };

      expect(engine.evaluate(arabJob, preferences).passed).toBe(true);
      expect(engine.evaluate(usJob, preferences).passed).toBe(true);
      expect(engine.evaluate(globalRemoteJob, preferences).passed).toBe(true);
    });
  });

  describe('Region Filtering: ARAB Preference', () => {
    const preferences: CandidatePreferences = {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.ARAB,
    };

    it('allows jobs located in Arab countries (EG, SA, AE, QA, etc.)', () => {
      const egJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'EG',
        remoteScope: 'COUNTRY',
      };
      const saJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'SA',
        remoteScope: 'COUNTRY',
      };

      expect(engine.evaluate(egJob, preferences).passed).toBe(true);
      expect(engine.evaluate(saJob, preferences).passed).toBe(true);
    });

    it('allows jobs from Arab job boards (tanqeeb, wuzzuf, baeed, etc.)', () => {
      const tanqeebJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        source: 'tanqeeb',
      };
      const wuzzufJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        source: 'wuzzuf',
      };

      expect(engine.evaluate(tanqeebJob, preferences).passed).toBe(true);
      expect(engine.evaluate(wuzzufJob, preferences).passed).toBe(true);
    });

    it('allows jobs explicitly classified as WORLDWIDE even if company is in a foreign country', () => {
      const globalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'US',
        remoteScope: 'WORLDWIDE',
      };

      expect(engine.evaluate(globalJob, preferences).passed).toBe(true);
    });

    it('excludes non-worldwide jobs restricted to non-Arab countries', () => {
      const usLocalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'US',
        remoteScope: 'COUNTRY',
      };
      const germanyLocalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'DE',
        remoteScope: 'COUNTRY',
      };

      const usResult = engine.evaluate(usLocalJob, preferences);
      expect(usResult.passed).toBe(false);
      expect(usResult.exclusionReason).toBe('REGION_INCOMPATIBLE');

      const deResult = engine.evaluate(germanyLocalJob, preferences);
      expect(deResult.passed).toBe(false);
      expect(deResult.exclusionReason).toBe('REGION_INCOMPATIBLE');
    });
  });

  describe('Region Filtering: INTERNATIONAL Preference', () => {
    const preferences: CandidatePreferences = {
      specializations: [Specialization.BACKEND],
      regionPreference: RegionPreference.INTERNATIONAL,
    };

    it('allows global remote / WORLDWIDE jobs without restriction', () => {
      const globalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'US',
        remoteScope: 'WORLDWIDE',
      };
      const egGlobalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'EG',
        remoteScope: 'WORLDWIDE',
      };

      expect(engine.evaluate(globalJob, preferences).passed).toBe(true);
      expect(engine.evaluate(egGlobalJob, preferences).passed).toBe(true);
    });

    it('allows international roles in foreign countries', () => {
      const deJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'DE',
        remoteScope: 'COUNTRY',
      };
      const usJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'US',
        remoteScope: 'COUNTRY',
      };

      expect(engine.evaluate(deJob, preferences).passed).toBe(true);
      expect(engine.evaluate(usJob, preferences).passed).toBe(true);
    });

    it('excludes on-site local roles restricted to Arab countries', () => {
      const egLocalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'EG',
        remoteScope: 'COUNTRY',
      };
      const saLocalJob: FilterableJob = {
        primarySpecialization: Specialization.BACKEND,
        country: 'SA',
        remoteScope: 'COUNTRY',
      };

      const egResult = engine.evaluate(egLocalJob, preferences);
      expect(egResult.passed).toBe(false);
      expect(egResult.exclusionReason).toBe('REGION_INCOMPATIBLE');

      const saResult = engine.evaluate(saLocalJob, preferences);
      expect(saResult.passed).toBe(false);
      expect(saResult.exclusionReason).toBe('REGION_INCOMPATIBLE');
    });
  });

  describe('Batch Filtering Method: filter()', () => {
    it('filters candidates array in O(1) checks per item discarding mismatches', () => {
      const jobs: FilterableJob[] = [
        // 1. Matches BACKEND and ARAB (EG local) -> KEEP
        { id: '1', primarySpecialization: Specialization.BACKEND, country: 'EG', remoteScope: 'COUNTRY' },
        // 2. Mismatch specialization (FRONTEND) -> DROP
        { id: '2', primarySpecialization: Specialization.FRONTEND, country: 'EG', remoteScope: 'COUNTRY' },
        // 3. Matches secondary BACKEND and ARAB (Worldwide) -> KEEP
        { id: '3', primarySpecialization: Specialization.FULLSTACK, secondarySpecialization: Specialization.BACKEND, country: 'US', remoteScope: 'WORLDWIDE' },
        // 4. Matches BACKEND but region is US local (for ARAB preference) -> DROP
        { id: '4', primarySpecialization: Specialization.BACKEND, country: 'US', remoteScope: 'COUNTRY' },
        // 5. Matches BACKEND and Arab source -> KEEP
        { id: '5', primarySpecialization: Specialization.BACKEND, source: 'wuzzuf' },
      ];

      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
      };

      const filtered = engine.filter(jobs, preferences);

      expect(filtered.map((j) => j.id)).toEqual(['1', '3', '5']);
      expect(filtered).toHaveLength(3);
    });
  });

  describe('TASK-37.2: Historical Delivery Exclusion ($O(1)$ Hash Set) (#110)', () => {
    it('filters out previously delivered jobs in O(1) time: 10 input jobs, 4 in sentSet -> 6 output (Test Spec #110)', () => {
      // 10 candidate jobs (IDs job-1 to job-10)
      const candidates: FilterableJob[] = Array.from({ length: 10 }, (_, i) => ({
        id: `job-${i + 1}`,
        primarySpecialization: Specialization.BACKEND,
      }));

      // 4 already present in sentSet: job-2, job-5, job-7, job-10
      const sentSet = new Set<string>(['job-2', 'job-5', 'job-7', 'job-10']);

      const unsent = engine.filterUnsentCandidates(candidates, sentSet);

      expect(unsent).toHaveLength(6);
      expect(unsent.map((j) => j.id)).toEqual([
        'job-1',
        'job-3',
        'job-4',
        'job-6',
        'job-8',
        'job-9',
      ]);
    });

    it('evaluate() flags previously delivered jobs with HISTORICAL_DELIVERY exclusion reason', () => {
      const job: FilterableJob = {
        id: 'job-already-sent',
        primarySpecialization: Specialization.BACKEND,
      };
      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.BOTH,
      };
      const sentSet = new Set<string>(['job-already-sent']);

      const result = engine.evaluate(job, preferences, sentSet);

      expect(result.passed).toBe(false);
      expect(result.exclusionReason).toBe('HISTORICAL_DELIVERY');
      expect(result.details).toContain('job-already-sent');
    });

    it('filter() integrates sentSet exclusion alongside specialization and region filters', () => {
      const jobs: FilterableJob[] = [
        // 1. Matches BACKEND, EG (ARAB), NOT sent -> KEEP
        { id: 'job-1', primarySpecialization: Specialization.BACKEND, country: 'EG' },
        // 2. Matches BACKEND, EG (ARAB), but ALREADY sent -> DROP
        { id: 'job-2', primarySpecialization: Specialization.BACKEND, country: 'EG' },
        // 3. Specialization mismatch (FRONTEND), NOT sent -> DROP
        { id: 'job-3', primarySpecialization: Specialization.FRONTEND, country: 'EG' },
        // 4. Matches BACKEND, Worldwide, NOT sent -> KEEP
        { id: 'job-4', primarySpecialization: Specialization.BACKEND, remoteScope: 'WORLDWIDE' },
      ];

      const preferences: CandidatePreferences = {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
      };
      const sentSet = new Set<string>(['job-2']);

      const filtered = engine.filter(jobs, preferences, sentSet);

      expect(filtered.map((j) => j.id)).toEqual(['job-1', 'job-4']);
      expect(filtered).toHaveLength(2);
    });
  });

  describe('Singleton Instance', () => {
    it('exports singleton instance hardFilterEngine', () => {
      expect(hardFilterEngine).toBeInstanceOf(HardFilterEngine);
    });
  });
});

import type { RemoteScope, WorkType } from '../../shared/types/domain.types.js';
import {
  Specialization,
  RegionPreference,
} from '../preferences/preference.taxonomy.js';

export const ARAB_COUNTRY_CODES = new Set<string>([
  'EG', // Egypt
  'SA', // Saudi Arabia
  'AE', // United Arab Emirates
  'QA', // Qatar
  'KW', // Kuwait
  'BH', // Bahrain
  'OM', // Oman
  'JO', // Jordan
  'LB', // Lebanon
  'IQ', // Iraq
  'MA', // Morocco
  'TN', // Tunisia
  'DZ', // Algeria
  'PS', // Palestine
  'SD', // Sudan
  'YE', // Yemen
  'LY', // Libya
  'SY', // Syria
  'MR', // Mauritania
  'SO', // Somalia
  'DJ', // Djibouti
  'KM', // Comoros
]);

export const ARAB_SOURCES = new Set<string>([
  'tanqeeb',
  'taqneeb',
  'wuzzuf',
  'forasna',
  'baeed',
  'mostaql',
  'mostaqel',
  'bayt',
  'souq',
  'naukrigulf',
  'narigulf',
]);

const ARAB_REGION_REGEX =
  /\b(?:mena|middle east|gcc|arab world|gulf)\b|(?:الشرق\s+الأوسط|الخليج|الخليج\s+العربي|دول\s+الخليج|شمال\s+إفريقيا|الوطن\s+العربي)/i;

const NON_ARAB_REGION_REGEX =
  /\b(?:europe|european union|eu|north america|latin america|latam|apac|asia-pacific|nordics?|benelux)\b|(?:أوروبا|اوروبا|أمريكا\s+الشمالية)/i;

export interface FilterableJob {
  id?: string;
  title?: string;
  primarySpecialization?: Specialization | null;
  secondarySpecialization?: Specialization | null;
  remoteScope?: RemoteScope | string | null;
  country?: string | null;
  location?: string | null;
  workType?: WorkType | string | null;
  source?: string | null;
  experienceLevel?: string | null;
}

export interface CandidatePreferences {
  specializations: Specialization[];
  regionPreference: RegionPreference;
  experienceLevel?: string | null;
}

export type ExclusionReason =
  | 'SPECIALIZATION_MISMATCH'
  | 'REGION_INCOMPATIBLE'
  | 'EXPERIENCE_INCOMPATIBLE'
  | 'HISTORICAL_DELIVERY';

export interface HardFilterEvaluation {
  passed: boolean;
  exclusionReason?: ExclusionReason;
  details?: string;
}

/**
 * Hard Filter Exclusion Engine (TASK-37.1)
 *
 * Discards clearly incompatible jobs with O(1) set operations
 * before computing scoring and ranking.
 */
export class HardFilterEngine {
  /**
   * Checks if a job is located in or targeted at the Arab / MENA market.
   */
  public isArabMarketJob(job: FilterableJob): boolean {
    if (job.location && NON_ARAB_REGION_REGEX.test(job.location)) {
      return false;
    }

    if (job.country && ARAB_COUNTRY_CODES.has(job.country.toUpperCase())) {
      return true;
    }

    if (job.source && ARAB_SOURCES.has(job.source.toLowerCase())) {
      return true;
    }

    if (job.location && ARAB_REGION_REGEX.test(job.location)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if a job has worldwide / global remote eligibility.
   */
  public isWorldwideJob(job: FilterableJob): boolean {
    return job.remoteScope === 'WORLDWIDE';
  }

  /**
   * Evaluates specialization compatibility.
   * Job primary OR secondary specialization MUST intersect with candidate's chosen specializations.
   */
  public isSpecializationCompatible(
    job: FilterableJob,
    userSpecializations: Specialization[] | Set<Specialization>,
  ): boolean {
    const userSpecsSet =
      userSpecializations instanceof Set
        ? userSpecializations
        : new Set(userSpecializations);

    if (job.primarySpecialization && userSpecsSet.has(job.primarySpecialization)) {
      return true;
    }

    if (
      job.secondarySpecialization &&
      userSpecsSet.has(job.secondarySpecialization)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Evaluates geographic market compatibility based on candidate region preference:
   * - BOTH: Allows all matching roles.
   * - ARAB: Excludes non-worldwide roles restricted to non-Arab countries.
   * - INTERNATIONAL: Excludes on-site local roles restricted to Arab countries.
   */
  public isRegionCompatible(
    job: FilterableJob,
    preference: RegionPreference,
  ): boolean {
    if (preference === RegionPreference.BOTH) {
      return true;
    }

    const isWorldwide = this.isWorldwideJob(job);
    const isArab = this.isArabMarketJob(job);

    if (preference === RegionPreference.ARAB) {
      if (isWorldwide || isArab) {
        return true;
      }
      return false;
    }

    if (preference === RegionPreference.INTERNATIONAL) {
      if (isWorldwide) {
        return true;
      }

      // Exclude on-site local roles restricted to Arab countries
      if (isArab) {
        return false;
      }

      return true;
    }

    return true;
  }

  /**
   * Evaluates experience level compatibility:
   * - If candidate has no experience preference, or 'ALL' / 'ANY': allows all roles.
   * - If candidate is 'JUNIOR': strictly excludes 'SENIOR', 'LEAD', 'PRINCIPAL', 'STAFF', 'DIRECTOR', 'VP', etc.
   * - If candidate is 'SENIOR': strictly excludes 'JUNIOR', 'INTERN', 'ENTRY-LEVEL'.
   * - If candidate is 'MID': excludes pure intern / trainee roles.
   */
  public isExperienceCompatible(
    job: FilterableJob,
    candidateLevel?: string | null,
  ): boolean {
    if (!candidateLevel) {
      return true;
    }

    const normCandidate = candidateLevel.trim().toUpperCase();
    if (normCandidate === 'ALL' || normCandidate === 'ANY') {
      return true;
    }

    const jobTitle = (job.title || '').trim();
    const jobLevel = (job.experienceLevel || '').trim().toUpperCase();

    const isLeadershipOrSeniorTitle =
      /\b(?:senior|sr\.?|lead|staff|principal|architect|head\s+of|director|vp|chief|expert|manager|management|supervisor|team\s*lead)\b|(?:سينيور|خبير|قائد|رئيس|معماري|مدير|إدارة|مشرف)/i.test(
        jobTitle,
      );

    const isJuniorTitle =
      /\b(?:junior|jr\.?|entry[- ]level|associate|intern|internship|trainee|apprentice|fresh\s+grad)\b|(?:مبتدئ|جونيور|متدرب|حديث\s+التخرج|مساعد)/i.test(
        jobTitle,
      );

    if (normCandidate === 'JUNIOR') {
      // Junior candidates MUST NOT receive senior, mid-level, or leadership/manager roles
      if (jobLevel === 'SENIOR' || jobLevel === 'MID' || isLeadershipOrSeniorTitle) {
        return false;
      }
      return true;
    }

    if (normCandidate === 'MID') {
      // Mid-level candidates: exclude senior/leadership and pure junior/intern
      if (jobLevel === 'SENIOR' || isLeadershipOrSeniorTitle) {
        return false;
      }
      if (jobLevel === 'JUNIOR' || isJuniorTitle) {
        return false;
      }
      return true;
    }

    if (normCandidate === 'SENIOR') {
      // Senior candidates MUST NOT receive junior or mid roles
      if (jobLevel === 'JUNIOR' || jobLevel === 'MID' || isJuniorTitle) {
        return false;
      }
      return true;
    }

    return true;
  }

  /**
   * Filters candidate array by excluding previously delivered jobs in O(1) lookup time.
   * (TASK-37.2: Historical Delivery Exclusion)
   */
  public filterUnsentCandidates<T extends FilterableJob>(
    candidates: readonly T[],
    sentJobIds: Set<string>,
  ): T[] {
    return candidates.filter((job) => !job.id || !sentJobIds.has(job.id));
  }

  /**
   * Evaluates full hard filter compatibility for a job against candidate preferences
   * and optional historical sent set.
   */
  public evaluate(
    job: FilterableJob,
    preferences: CandidatePreferences,
    sentJobIds?: Set<string>,
  ): HardFilterEvaluation {
    if (sentJobIds && job.id && sentJobIds.has(job.id)) {
      return {
        passed: false,
        exclusionReason: 'HISTORICAL_DELIVERY',
        details: `Job with ID "${job.id}" was previously delivered to this subscriber.`,
      };
    }

    const userSpecsSet = new Set(preferences.specializations);

    if (!this.isSpecializationCompatible(job, userSpecsSet)) {
      return {
        passed: false,
        exclusionReason: 'SPECIALIZATION_MISMATCH',
        details: `Job specializations [${[job.primarySpecialization, job.secondarySpecialization].filter(Boolean).join(', ')}] do not overlap with candidate preferences [${preferences.specializations.join(', ')}].`,
      };
    }

    if (!this.isRegionCompatible(job, preferences.regionPreference)) {
      return {
        passed: false,
        exclusionReason: 'REGION_INCOMPATIBLE',
        details: `Job with country "${job.country || 'N/A'}" and remoteScope "${job.remoteScope || 'N/A'}" does not match user region preference "${preferences.regionPreference}".`,
      };
    }

    if (!this.isExperienceCompatible(job, preferences.experienceLevel)) {
      return {
        passed: false,
        exclusionReason: 'EXPERIENCE_INCOMPATIBLE',
        details: `Job with level "${job.experienceLevel || 'N/A'}" and title "${job.title || 'N/A'}" is incompatible with candidate experience level "${preferences.experienceLevel}".`,
      };
    }

    return { passed: true };
  }

  /**
   * Filters candidate jobs array, discarding incompatible and previously delivered jobs in O(1) checks per item.
   */
  public filter<T extends FilterableJob>(
    jobs: readonly T[],
    preferences: CandidatePreferences,
    sentJobIds?: Set<string>,
  ): T[] {
    const userSpecsSet = new Set(preferences.specializations);

    return jobs.filter((job) => {
      if (sentJobIds && job.id && sentJobIds.has(job.id)) {
        return false;
      }

      return (
        this.isSpecializationCompatible(job, userSpecsSet) &&
        this.isRegionCompatible(job, preferences.regionPreference) &&
        this.isExperienceCompatible(job, preferences.experienceLevel)
      );
    });
  }
}

export const hardFilterEngine = new HardFilterEngine();

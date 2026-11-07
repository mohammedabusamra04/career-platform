import type { UserPreferences } from '../modules/preferences/preference.types.js';
import type { Specialization, RegionPreference } from '../modules/preferences/preference.taxonomy.js';

export type SupportedLanguage = 'ar' | 'en';

export type PreferenceStep =
  | 'language'
  | 'specializations'
  | 'region'
  | 'confirmation'
  | 'job-title'
  | 'work-type'
  | 'experience-level'
  | 'location'
  | 'skills';

export interface PreferenceSession {
  step: PreferenceStep;
  language?: SupportedLanguage;
  selectedSpecializations?: Specialization[];
  selectedRegion?: RegionPreference;
  preferences: Partial<UserPreferences>;
}

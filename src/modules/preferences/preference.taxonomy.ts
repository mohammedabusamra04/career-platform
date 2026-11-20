/**
 * Approved technical specializations for SmartJobsBot V2.
 * Exactly 10 closed, curated domains.
 */
export enum Specialization {
  BACKEND = 'BACKEND',
  FRONTEND = 'FRONTEND',
  FULLSTACK = 'FULLSTACK',
  MOBILE = 'MOBILE',
  DEVOPS = 'DEVOPS',
  UIUX = 'UIUX',
  DATA = 'DATA',
  QA = 'QA',
  SECURITY = 'SECURITY',
  AI_ENGINEER = 'AI_ENGINEER',
}

export const APPROVED_SPECIALIZATIONS = Object.freeze(
  Object.values(Specialization) as readonly Specialization[],
);

export function isApprovedSpecialization(value: string): value is Specialization {
  return (APPROVED_SPECIALIZATIONS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Geographic region targeting preferences.
 */
export enum RegionPreference {
  ARAB = 'ARAB',
  INTERNATIONAL = 'INTERNATIONAL',
  BOTH = 'BOTH',
}

/**
 * Candidate seniority levels for preference filtering.
 */
export enum ExperienceLevelPreference {
  JUNIOR = 'JUNIOR',
  MID = 'MID',
  SENIOR = 'SENIOR',
}

/**
 * Contractual work engagement types.
 */
export enum WorkTypePreference {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  CONTRACT = 'CONTRACT',
  INTERNSHIP = 'INTERNSHIP',
}

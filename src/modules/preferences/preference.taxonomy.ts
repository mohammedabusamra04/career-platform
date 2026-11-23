/**
 * Approved technical specializations for SmartJobsBot V2.
 * Exactly 10 closed, curated domains.
 */
import {
  Specialization,
  RegionPreference,
} from '../../shared/types/domain.types.js';

export { Specialization, RegionPreference };

export const APPROVED_SPECIALIZATIONS = Object.freeze(
  Object.values(Specialization) as readonly Specialization[],
);

export function isApprovedSpecialization(value: string): value is Specialization {
  return (APPROVED_SPECIALIZATIONS as readonly string[]).includes(value.toUpperCase());
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

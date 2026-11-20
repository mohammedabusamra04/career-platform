import { createHash } from 'node:crypto';
import {
  Specialization,
  RegionPreference,
} from './preference.taxonomy.js';

export interface PreferenceVectorInput {
  specializations: (Specialization | string)[];
  regionPreference?: RegionPreference | string;
  experienceLevel?: string | null;
  workType?: string | null;
}

/**
 * Normalizes preference attributes into a canonical vector string:
 * - Specializations sorted alphabetically
 * - Region uppercase (defaults to 'BOTH')
 * - Level uppercase or 'ANY'
 * - WorkType uppercase or 'ANY'
 *
 * Pattern: "SPEC1,SPEC2|REGION|LEVEL|WORK_TYPE"
 */
export function buildPreferenceVectorString(input: PreferenceVectorInput): string {
  const sortedSpecs = [...input.specializations]
    .map((s) => s.trim().toUpperCase())
    .sort();

  const region = (input.regionPreference ?? RegionPreference.BOTH).trim().toUpperCase();
  const level = input.experienceLevel ? input.experienceLevel.trim().toUpperCase() : 'ANY';
  const workType = input.workType ? input.workType.trim().toUpperCase() : 'ANY';

  return `${sortedSpecs.join(',')}|${region}|${level}|${workType}`;
}

/**
 * Computes deterministic SHA-256 hash for preference vector.
 * Hash formula:
 * crypto.createHash('sha256').update(sortedSpecs.join(',') + '|' + region + '|' + (level ?? 'ANY') + '|' + (workType ?? 'ANY')).digest('hex')
 */
export function computePreferenceHash(input: PreferenceVectorInput): string {
  const vectorString = buildPreferenceVectorString(input);
  return createHash('sha256').update(vectorString).digest('hex');
}

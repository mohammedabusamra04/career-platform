import { z } from 'zod';
import {
  Specialization,
  RegionPreference,
  ExperienceLevelPreference,
  WorkTypePreference,
} from './preference.taxonomy.js';

export class PreferenceValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const formatted = issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join(', ');
    super(`User preference validation failed: ${formatted}`);
    this.name = 'PreferenceValidationError';
  }
}

const PreprocessedSpecialization = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
  z.nativeEnum(Specialization, {
    errorMap: () => ({
      message: `Invalid specialization. Must be one of 10 approved specializations: ${Object.values(Specialization).join(', ')}`,
    }),
  }),
);

const PreprocessedRegionPreference = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
  z.nativeEnum(RegionPreference, {
    errorMap: () => ({
      message: `Invalid region preference. Must be one of: ${Object.values(RegionPreference).join(', ')}`,
    }),
  }),
);

const PreprocessedExperienceLevel = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
  z.nativeEnum(ExperienceLevelPreference, {
    errorMap: () => ({
      message: `Invalid experience level. Must be one of: ${Object.values(ExperienceLevelPreference).join(', ')}`,
    }),
  }),
);

const PreprocessedWorkType = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
  z.nativeEnum(WorkTypePreference, {
    errorMap: () => ({
      message: `Invalid work type. Must be one of: ${Object.values(WorkTypePreference).join(', ')}`,
    }),
  }),
);

/**
 * Zod schema enforcing US-0102b validation rules:
 * - 1 <= specializations.length <= 3
 * - Exactly 10 approved specializations
 * - No duplicates
 * - Region: ARAB | INTERNATIONAL | BOTH (default: BOTH)
 * - Optional: experienceLevel, workType
 */
export const UserPreferenceSchema = z.object({
  specializations: z
    .array(PreprocessedSpecialization, {
      required_error: 'Specializations are required',
      invalid_type_error: 'Specializations must be an array',
    })
    .min(1, 'At least 1 specialization must be selected')
    .max(3, 'At most 3 specializations can be selected')
    .refine(
      (items) => new Set(items).size === items.length,
      'Duplicate specializations are not allowed',
    ),
  regionPreference: PreprocessedRegionPreference.default(RegionPreference.BOTH),
  experienceLevel: PreprocessedExperienceLevel.optional().nullable(),
  workType: PreprocessedWorkType.optional().nullable(),
});

export type UserPreferenceInput = z.input<typeof UserPreferenceSchema>;
export type UserPreferenceOutput = z.output<typeof UserPreferenceSchema>;

/**
 * Validates and normalizes user preference payload.
 * Throws PreferenceValidationError if input violates schema.
 */
export function validateUserPreferences(input: unknown): UserPreferenceOutput {
  const result = UserPreferenceSchema.safeParse(input);

  if (!result.success) {
    throw new PreferenceValidationError(result.error.issues);
  }

  return result.data;
}

/**
 * Safe validator returning Zod result without throwing.
 */
export function safeValidateUserPreferences(
  input: unknown,
): z.SafeParseReturnType<UserPreferenceInput, UserPreferenceOutput> {
  return UserPreferenceSchema.safeParse(input);
}

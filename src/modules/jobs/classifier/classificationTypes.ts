import {
  Specialization,
  RemoteScope,
  ExperienceLevel,
  WorkType,
} from '../../../shared/types/domain.types.js';
import type { Job } from '../job.types.js';

export type ClassificationMethod =
  | 'RULE_TITLE'
  | 'RULE_DESCRIPTION'
  | 'AI_FALLBACK'
  | 'DEFAULT'
  | 'NEGATIVE_EXCLUSION'
  | 'UNRESOLVED';

export interface TitleClassificationResult {
  primarySpecialization: Specialization;
  secondarySpecialization: Specialization | null;
  confidence: number;
  classificationMethod: 'RULE_TITLE';
  matchedTokens: string[];
}

export interface ClassificationResult {
  primarySpecialization: Specialization | null;
  secondarySpecialization: Specialization | null;
  remoteScope: RemoteScope;
  country?: string | null;
  remoteScopeEvidence?: string;
  remoteConfidence?: number;
  experienceLevel: ExperienceLevel;
  workType: WorkType;
  confidence: number;
  classificationMethod: ClassificationMethod;
  matchedTokens?: string[];
  isExcluded?: boolean;
  exclusionReason?: string;
}

export interface AmbiguityResolutionInput {
  title: string;
  description?: string;
  skills?: string[];
}

export interface AmbiguityResolutionOutput {
  specialization: Specialization | null;
  confidence: number;
  reasoning?: string;
}

export interface AmbiguityResolver {
  resolve(input: AmbiguityResolutionInput): Promise<AmbiguityResolutionOutput>;
}

export interface StageContext {
  job: Partial<Job>;
  title: string;
  description?: string;
  skills?: string[];
  normalizedTitle: string;
}

export interface StageResult {
  handled: boolean;
  primarySpecialization?: Specialization | null;
  secondarySpecialization?: Specialization | null;
  confidence: number;
  classificationMethod: ClassificationMethod;
  matchedTokens?: string[];
  isExcluded?: boolean;
  exclusionReason?: string;
}

export interface IClassificationStage {
  readonly name: string;
  execute(context: StageContext): Promise<StageResult | null> | StageResult | null;
}

export interface TaxonomyTokenEntry {
  spec: Specialization;
  weight: number;
  isDirectRole: boolean;
}

export interface SpecializationTaxonomyRule {
  spec: Specialization;
  roleTitles: string[];
  frameworks: string[];
  exclusiveTools: string[];
  antiSignals: string[];
  titleRegex: RegExp;
  skillsRegex?: RegExp;
  weight: number;
}

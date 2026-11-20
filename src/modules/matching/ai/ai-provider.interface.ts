import type { Job } from '../../jobs/job.types.js';
import type {
  MatchingInput,
  MatchingResult,
  JobAnalysisResult,
} from '../matching.types.js';

export interface AIProvider {
  match(input: MatchingInput): Promise<MatchingResult>;

  analyzeJob(
    job: Job,
  ): Promise<JobAnalysisResult>;

  generateText?(prompt: string): Promise<string | undefined>;

  hasAvailableSlot(): boolean;
  msUntilAvailable?(): number;
}
import type { Job } from '../jobs/job.types.js';
import type { AIProvider } from './ai/aiProvider.interface.js';
import type { JobAnalysis } from './matching.types.js';

export { JobAnalysis };

export class JobAnalysisService {
  constructor(
    private readonly aiProvider: AIProvider,
  ) {}

  async analyze(
    job: Job,
  ): Promise<JobAnalysis> {
    const result =
      await this.aiProvider.analyzeJob(job);

    return {
      role: result.role,
      level: result.experienceLevel,
      skills: result.skills,
      workType: result.workType,
    };
  }
}
import type { JobSearchQuery, JobSourceType, RawJobListing } from '../job.types.js';

export interface JobSource {
  readonly type: JobSourceType;

  fetchJobs(query?: JobSearchQuery): Promise<RawJobListing[]>;
}


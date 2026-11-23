import type { JobSearchQuery, JobSourceType, RawJobListing } from '../job.types.js';

export interface SourceDisplayName {
  ar: string;
  en: string;
}

export interface JobSource {
  readonly type: JobSourceType;
  readonly displayName?: SourceDisplayName;

  fetchJobs(query?: JobSearchQuery): Promise<RawJobListing[]>;
}

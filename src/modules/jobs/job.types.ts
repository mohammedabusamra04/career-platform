import { WorkType, ExperienceLevel } from '../../shared/types/job.js';

export enum JobSourceType {
  ARBEITNOW = 'arbeitnow',
  ADZUNA = 'adzuna',
  JOOBLE = 'jooble',
  TANQEEB = 'tanqeeb',
  TAQNEEB = 'taqneeb',
  MOSTAQEL = 'mostaqel',
  BAEED = 'baeed',
  SOUQ = 'souq',
  BAYT = 'bayt',
  NARIGULF = 'narigulf',
  FREELANCER = 'freelancer',
  WE_WORK_REMOTELY = 'we_work_remotely',
  REMOTIVE = 'remotive',
  WUZZUF = 'wuzzuf',
  FORASNA = 'forasna',
  LINKEDIN = 'linkedin',
  OTHER = 'other',
}

export interface Job {
  title: string;
  company: string;
  source: JobSourceType | string;
  applicationUrl: string;
  url: string;

  location?: string;
  country?: string;
  remote?: boolean;

  workType?: WorkType;
  experienceLevel?: ExperienceLevel;

  description?: string;
  skills: string[];

  publicationDate: Date;
  publishedAt?: Date;

  salaryMin?: number;
  salaryMax?: number;
  currency?: string;

  scrapedAt: Date;
  sourcesSeen?: string[];
}

export type RawJobListing = Job;

export interface JobSearchQuery {
  jobTitle: string;
  workType?: WorkType;
  experienceLevel?: ExperienceLevel;
  location?: string;
  skills?: string[];
}

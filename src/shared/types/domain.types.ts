/**
 * Pure domain enums and types completely decoupled from @prisma/client.
 * Ports & Adapters / Dependency Inversion Principle (DIP).
 *
 * Uses `as const` object patterns so values and types are structurally compatible
 * with string literals and any ORM persistence layer (Prisma, Drizzle, etc.).
 */

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  BLOCKED: 'BLOCKED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const Specialization = {
  BACKEND: 'BACKEND',
  FRONTEND: 'FRONTEND',
  FULLSTACK: 'FULLSTACK',
  MOBILE: 'MOBILE',
  DEVOPS: 'DEVOPS',
  UIUX: 'UIUX',
  DATA: 'DATA',
  QA: 'QA',
  SECURITY: 'SECURITY',
  AI_ENGINEER: 'AI_ENGINEER',
} as const;
export type Specialization = (typeof Specialization)[keyof typeof Specialization];

export const RegionPreference = {
  ARAB: 'ARAB',
  INTERNATIONAL: 'INTERNATIONAL',
  BOTH: 'BOTH',
} as const;
export type RegionPreference = (typeof RegionPreference)[keyof typeof RegionPreference];

export const RemoteScope = {
  WORLDWIDE: 'WORLDWIDE',
  REGION: 'REGION',
  COUNTRY: 'COUNTRY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type RemoteScope = (typeof RemoteScope)[keyof typeof RemoteScope];

export const JobStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CLOSED: 'CLOSED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const DeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  SKIPPED_EXPIRED: 'SKIPPED_EXPIRED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const FeedbackType = {
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  NONE: 'NONE',
} as const;
export type FeedbackType = (typeof FeedbackType)[keyof typeof FeedbackType];

export const ExperienceLevel = {
  JUNIOR: 'JUNIOR',
  MID: 'MID',
  SENIOR: 'SENIOR',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel];

export const WorkType = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  INTERNSHIP: 'INTERNSHIP',
  UNKNOWN: 'UNKNOWN',
} as const;
export type WorkType = (typeof WorkType)[keyof typeof WorkType];

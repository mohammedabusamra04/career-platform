import ms from 'ms';

export const CACHE_TTL = {
  JOB: ms('24h') / 1000,

  JOB_ANALYSIS: ms('7d') / 1000,

  // Preferences must outlive daily runs; 24h caused silent skips after one day.
  PREFERENCES: ms('90d') / 1000,

  FINGERPRINT: ms('24h') / 1000,

  SENT_JOB: ms('30d') / 1000,

  LINK_LIVENESS: ms('24h') / 1000,

  JOB_ENRICHMENT: ms('24h') / 1000,
};
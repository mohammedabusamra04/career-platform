export const cacheKeys = {
  job: (fingerprint: string) => `job:${fingerprint}`,

  jobAnalysis: (fingerprint: string) =>
    `job:analysis:${fingerprint}`,

  jobs: (query: string) => `jobs:${query}`,

  preferences: (userId: string) =>
    `preferences:${userId}`,

  fingerprint: (fingerprint: string) =>
    `fingerprint:${fingerprint}`,

  subscriptionStatus: (userId: string) =>
    `subscription:${userId}`,

  userSentJob: (
    userId: string | number,
    fingerprint: string,
  ) => `user:${userId}:sent:${fingerprint}`,

  linkLiveness: (hash: string) => `link:liveness:${hash}`,

  jobEnrichment: (hash: string) => `job:enrichment:${hash}`,
};
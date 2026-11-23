import { describe, it, expect } from 'vitest';
import { validateJob, MAX_JOB_AGE_DAYS } from '../../src/modules/jobs/job.validator.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('validateJob', () => {
  const createValidJob = (overrides: Partial<Job> = {}): Job => ({
    title: 'Software Engineer',
    company: 'Acme',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com/jobs/123',
    url: 'https://example.com/jobs/123',
    skills: ['TypeScript'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
    ...overrides,
  });

  it('should return true for a valid job object', () => {
    expect(validateJob(createValidJob())).toBe(true);
  });

  it('should return false for missing or blank title', () => {
    expect(validateJob(createValidJob({ title: '' }))).toBe(false);
    expect(validateJob(createValidJob({ title: '   ' }))).toBe(false);
  });

  it('should return false for missing or blank company', () => {
    expect(validateJob(createValidJob({ company: '' }))).toBe(false);
  });

  it('should validate URLs properly', () => {
    expect(validateJob(createValidJob({ applicationUrl: 'http://example.com/job' }))).toBe(true);
    expect(validateJob(createValidJob({ applicationUrl: 'https://example.com/job' }))).toBe(true);
    expect(validateJob(createValidJob({ applicationUrl: '', url: '' }))).toBe(false);
    expect(validateJob(createValidJob({ applicationUrl: 'invalid-url', url: 'invalid-url' }))).toBe(false);
  });

  it('should reject jobs older than MAX_JOB_AGE_DAYS (21 days)', () => {
    expect(MAX_JOB_AGE_DAYS).toBe(21);

    const now = new Date('2026-11-23T12:00:00Z');
    // Exactly 21 days old: should be valid
    const edgeJob = createValidJob({
      publicationDate: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000),
    });
    expect(validateJob(edgeJob, now)).toBe(true);

    // 22 days old: should be rejected
    const oldJob = createValidJob({
      publicationDate: new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000),
    });
    expect(validateJob(oldJob, now)).toBe(false);

    // 2 years old: should be rejected
    const ancientJob = createValidJob({
      publicationDate: new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000),
    });
    expect(validateJob(ancientJob, now)).toBe(false);
  });
});

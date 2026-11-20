import { describe, it, expect } from 'vitest';
import { formatJobMessage } from '../../src/modules/notifications/telegram/job-message.formatter.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('formatJobMessage', () => {
  const dummyJob: Job = {
    title: 'Senior Backend Engineer',
    company: 'Stripe',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com/apply',
    url: 'https://example.com/apply',
    location: 'Remote',
    country: 'Worldwide',
    skills: ['Node.js'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  it('should format message with title, company, location, source, and match score in Arabic', () => {
    const formatted = formatJobMessage({
      job: dummyJob,
      score: 92,
      reason: 'Great match',
    }, 'ar');

    expect(formatted).toContain('💻 Senior Backend Engineer');
    expect(formatted).toContain('🏢 الشركة: Stripe');
    expect(formatted).toContain('🌍 Remote');
    expect(formatted).toContain('🌐 المصدر: arbeitnow');
    expect(formatted).toContain('⚡ Ping جديد من DeployMe — تطابق 92%');
  });

  it('should format message with title, company, location, source, and match score in English', () => {
    const formatted = formatJobMessage({
      job: dummyJob,
      score: 92,
      reason: 'Great match',
    }, 'en');

    expect(formatted).toContain('💻 Senior Backend Engineer');
    expect(formatted).toContain('🏢 Company: Stripe');
    expect(formatted).toContain('🌍 Remote');
    expect(formatted).toContain('🌐 Source: arbeitnow');
    expect(formatted).toContain('⚡ DeployMe Ping — 92% Stack Fit');
  });
});

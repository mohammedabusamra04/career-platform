import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { FingerprintService } from '../../src/modules/deduplication/fingerprint.service.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('TASK-28: Two-Tier Deduplication & Rich Data Merger', () => {
  const service = new FingerprintService();

  const baseJob: Job = {
    title: 'Senior Node.js Developer',
    company: 'Google LLC',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://google.com/jobs/123?utm_source=linkedin&ref=tracker',
    url: 'https://google.com/jobs/123?utm_source=linkedin&ref=tracker',
    skills: ['Node.js'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  describe('TASK-28.1: Level 1 SHA-256 Composite Fingerprint Engine', () => {
    describe('Formula Verification', () => {
      it('generates SHA256(canonicalTitle | canonicalCompany | canonicalUrl)', () => {
        const job: Job = {
          title: 'Backend Engineer',
          company: 'Stripe',
          source: JobSourceType.REMOTIVE,
          applicationUrl: 'https://stripe.com/jobs/456',
          url: 'https://stripe.com/jobs/456',
          skills: ['TypeScript'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        const expectedData = 'backend engineer|stripe|https://stripe.com/jobs/456';
        const expectedHash = createHash('sha256').update(expectedData).digest('hex');

        expect(service.generate(job)).toBe(expectedHash);
        expect(service.generateDeduplicationKey(job)).toBe(expectedHash);
      });
    });

    describe('Acceptance Criteria: Whitespace & Casing Invariance', () => {
      it('produces identical fingerprints regardless of varying whitespace in title, company, or URL', () => {
        const job1: Job = {
          ...baseJob,
          title: '  Senior   Node.js\t Developer \n',
          company: '  Google   LLC  ',
          applicationUrl: ' https://google.com/jobs/123 ',
        };

        const job2: Job = {
          ...baseJob,
          title: 'Senior Node.js Developer',
          company: 'Google LLC',
          applicationUrl: 'https://google.com/jobs/123',
        };

        expect(service.generate(job1)).toBe(service.generate(job2));
      });

      it('produces identical fingerprints regardless of uppercase vs lowercase variations', () => {
        const upperJob: Job = {
          ...baseJob,
          title: 'SENIOR NODE.JS DEVELOPER',
          company: 'GOOGLE LLC',
          applicationUrl: 'HTTPS://GOOGLE.COM/JOBS/123',
        };

        const lowerJob: Job = {
          ...baseJob,
          title: 'senior node.js developer',
          company: 'google llc',
          applicationUrl: 'https://google.com/jobs/123',
        };

        expect(service.generate(upperJob)).toBe(service.generate(lowerJob));
      });
    });

    describe('URL Canonicalization Invariance', () => {
      it('generates identical fingerprints for URLs differing only by tracking parameters', () => {
        const job1 = {
          ...baseJob,
          applicationUrl: 'https://google.com/jobs/123?utm_source=adzuna&utm_medium=cpc&fbclid=xyz123',
        };
        const job2 = {
          ...baseJob,
          applicationUrl: 'https://www.google.com/jobs/123/?gclid=abc999&ref=jobboard',
        };

        expect(service.generate(job1)).toBe(service.generate(job2));
      });

      it('generates identical fingerprints when functional query parameters appear in different orders', () => {
        const jobOrderA = {
          ...baseJob,
          applicationUrl: 'https://company.com/job?role=backend&id=100&dept=engineering',
        };
        const jobOrderB = {
          ...baseJob,
          applicationUrl: 'https://company.com/job?dept=engineering&id=100&role=backend',
        };

        expect(service.generate(jobOrderA)).toBe(service.generate(jobOrderB));
      });

      it('canonicalizes URLs by removing www, default ports, and hash fragments', () => {
        const raw = 'https://WWW.Example.com:443/jobs/dev/?utm_campaign=winter#application-form';
        const canonical = service.canonicalizeUrl(raw);
        expect(canonical).toBe('https://example.com/jobs/dev');
      });
    });

    describe('Title & Company Canonicalization', () => {
      it('strips common noise tags from job titles', () => {
        expect(service.canonicalizeTitle('Software Engineer (m/f/d)')).toBe('software engineer');
        expect(service.canonicalizeTitle('DevOps Engineer [Remote]')).toBe('devops engineer');
        expect(service.canonicalizeTitle('Backend Developer (Remote) [Urgent]')).toBe('backend developer');
      });

      it('strips common corporate entity suffixes from companies', () => {
        expect(service.canonicalizeCompany('Amazon Inc.')).toBe('amazon');
        expect(service.canonicalizeCompany('Meta Platforms, LLC')).toBe('meta platforms');
        expect(service.canonicalizeCompany('Shopify Ltd.')).toBe('shopify');
        expect(service.canonicalizeCompany('Siemens AG GMBH')).toBe('siemens ag');
        expect(service.canonicalizeCompany('شركة أرامكو السعودية')).toBe('أرامكو السعودية');
      });

      it('handles Arabic job titles and companies cleanly', () => {
        const job1: Job = {
          ...baseJob,
          title: 'مهندس برمجيات خلفية (عن بعد)',
          company: 'شركة التقنية المتقدمة ذ.م.م',
          applicationUrl: 'https://tech.sa/jobs/1',
        };

        const job2: Job = {
          ...baseJob,
          title: '  مهندس برمجيات خلفية  ',
          company: 'التقنية المتقدمة',
          applicationUrl: 'https://tech.sa/jobs/1?utm_source=tanqeeb',
        };

        expect(service.generate(job1)).toBe(service.generate(job2));
      });
    });

    describe('Distinct Job Separation', () => {
      it('produces distinct fingerprints for distinct job titles', () => {
        const jobA = { ...baseJob, title: 'Node.js Developer' };
        const jobB = { ...baseJob, title: 'Python Developer' };

        expect(service.generate(jobA)).not.toBe(service.generate(jobB));
      });

      it('produces distinct fingerprints for different companies', () => {
        const jobA = { ...baseJob, company: 'Google' };
        const jobB = { ...baseJob, company: 'Microsoft' };

        expect(service.generate(jobA)).not.toBe(service.generate(jobB));
      });

      it('produces distinct fingerprints for different job posting URLs', () => {
        const jobA = { ...baseJob, applicationUrl: 'https://company.com/job/1' };
        const jobB = { ...baseJob, applicationUrl: 'https://company.com/job/2' };

        expect(service.generate(jobA)).not.toBe(service.generate(jobB));
      });
    });
  });

  describe('TASK-28.2: Level 2 Cross-Source Semantic Fingerprint Engine', () => {
    describe('Acceptance Criteria: Cross-Source Detection Benchmark', () => {
      it('detects cross-source duplicate between "Senior Backend Engineer" (Source A) and "Sr. Back End Engineer" (Source B)', () => {
        const jobSourceA: Job = {
          title: 'Senior Backend Engineer',
          company: 'Acme Corp',
          source: JobSourceType.ADZUNA,
          applicationUrl: 'https://adzuna.com/jobs/101',
          url: 'https://adzuna.com/jobs/101',
          skills: ['Node.js'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        const jobSourceB: Job = {
          title: 'Sr. Back End Engineer',
          company: 'Acme Corp',
          source: JobSourceType.REMOTIVE,
          applicationUrl: 'https://remotive.com/jobs/202',
          url: 'https://remotive.com/jobs/202',
          skills: ['Node.js', 'PostgreSQL'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        // Level 1 differs because URLs and sources are different
        expect(service.generate(jobSourceA)).not.toBe(service.generate(jobSourceB));

        // Level 2 matches because semantic title and company are equivalent
        const semA = service.generateSemanticFingerprint(jobSourceA);
        const semB = service.generateSemanticFingerprint(jobSourceB);

        expect(semA).toBe(semB);
      });

      it('canonicalizes common title variants: Back End -> Backend, Full-Stack -> Full Stack, Sr. -> Senior', () => {
        expect(service.canonicalizeSemanticTitle('Back End Developer')).toBe('backend developer');
        expect(service.canonicalizeSemanticTitle('Back-End Developer')).toBe('backend developer');

        expect(service.canonicalizeSemanticTitle('Full-Stack Engineer')).toBe('full stack engineer');
        expect(service.canonicalizeSemanticTitle('Fullstack Engineer')).toBe('full stack engineer');

        expect(service.canonicalizeSemanticTitle('Sr. Software Engineer')).toBe('senior software engineer');
        expect(service.canonicalizeSemanticTitle('Jr. Frontend Developer')).toBe('junior frontend developer');
        expect(service.canonicalizeSemanticTitle('Mid-Level Python Developer')).toBe('mid python developer');
      });

      it('canonicalizes technical domain variations like Dev-Ops, QA, and ML', () => {
        expect(service.canonicalizeSemanticTitle('Dev-Ops Engineer')).toBe('devops engineer');
        expect(service.canonicalizeSemanticTitle('Quality Assurance Analyst')).toBe('qa analyst');
        expect(service.canonicalizeSemanticTitle('ML Engineer')).toBe('machine learning engineer');
      });

      it('canonicalizes framework names in titles: React.js -> react, Node.js -> node', () => {
        expect(service.canonicalizeSemanticTitle('Senior React.js Developer')).toBe('senior react developer');
        expect(service.canonicalizeSemanticTitle('Senior ReactJS Developer')).toBe('senior react developer');
        expect(service.canonicalizeSemanticTitle('Node.js Backend Developer')).toBe('node backend developer');
      });

      it('detects cross-source duplicates in Arabic with dialect and abbreviation synonyms', () => {
        const arabicA: Job = {
          title: 'مطور واجهات خلفية أول',
          company: 'شركة مسار للتقنية',
          source: JobSourceType.MOSTAQEL,
          applicationUrl: 'https://mostaql.com/job/1',
          url: 'https://mostaql.com/job/1',
          skills: ['PHP'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        const arabicB: Job = {
          title: 'مطور خلفي سينيور',
          company: 'مسار للتقنية ذ.م.م',
          source: JobSourceType.BAEED,
          applicationUrl: 'https://baeed.com/job/2',
          url: 'https://baeed.com/job/2',
          skills: ['PHP', 'Laravel'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        const semA = service.generateSemanticFingerprint(arabicA);
        const semB = service.generateSemanticFingerprint(arabicB);

        expect(semA).toBe(semB);
      });

      it('does not merge roles when titles differ semantically', () => {
        const frontend: Job = {
          title: 'Frontend Engineer',
          company: 'Stripe',
          source: JobSourceType.ADZUNA,
          applicationUrl: 'https://adzuna.com/1',
          url: 'https://adzuna.com/1',
          skills: ['React'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        const backend: Job = {
          title: 'Backend Engineer',
          company: 'Stripe',
          source: JobSourceType.REMOTIVE,
          applicationUrl: 'https://remotive.com/2',
          url: 'https://remotive.com/2',
          skills: ['Node.js'],
          publicationDate: new Date(),
          scrapedAt: new Date(),
        };

        expect(service.generateSemanticFingerprint(frontend)).not.toBe(
          service.generateSemanticFingerprint(backend),
        );
      });
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  escapeTelegramMarkdown,
  sanitizeApplicationUrl,
  formatMatchTone,
  formatExperienceLevel,
  formatRemoteScope,
  paginateDigestJobs,
  formatJobCard,
  formatDigestPageMessage,
  getTelegramDigestSendOptions,
  MAX_DIGEST_TOTAL_JOBS,
  DEFAULT_PAGE_SIZE,
  type DigestCardJob,
} from '../../src/modules/notifications/telegram/digest-card.formatter.js';

describe('DigestCardFormatter (TASK-43.1)', () => {
  describe('escapeTelegramMarkdown', () => {
    it('should escape Telegram Markdown control characters (*, _, [, ], `)', () => {
      const input = 'Senior Software Engineer *Fullstack* [Node_js] `Core`';
      const escaped = escapeTelegramMarkdown(input);

      expect(escaped).toBe('Senior Software Engineer \\*Fullstack\\* \\[Node\\_js\\] \\`Core\\`');
    });

    it('should handle empty or null-ish strings safely', () => {
      expect(escapeTelegramMarkdown('')).toBe('');
    });
  });

  describe('sanitizeApplicationUrl', () => {
    it('should strictly enforce HTTPS format, upgrading HTTP to HTTPS', () => {
      expect(sanitizeApplicationUrl('https://careers.google.com/jobs/123')).toBe(
        'https://careers.google.com/jobs/123',
      );
      expect(sanitizeApplicationUrl('http://jobs.example.com')).toBe(
        'https://jobs.example.com',
      );
      expect(sanitizeApplicationUrl('jobs.example.com/apply')).toBe(
        'https://jobs.example.com/apply',
      );
    });

    it('should reject unsafe schemes, malformed strings, and empty inputs', () => {
      expect(sanitizeApplicationUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeApplicationUrl('ftp://example.com')).toBe('');
      expect(sanitizeApplicationUrl('data:text/html,<script>')).toBe('');
      expect(sanitizeApplicationUrl('file:///etc/passwd')).toBe('');
      expect(sanitizeApplicationUrl('malformed url <>')).toBe('');
      expect(sanitizeApplicationUrl('')).toBe('');
      expect(sanitizeApplicationUrl(null)).toBe('');
      expect(sanitizeApplicationUrl(undefined)).toBe('');
    });
  });

  describe('formatMatchTone', () => {
    it('should format Arabic match tiers with strong/moderate/weak indicators and zero percentages', () => {
      const high = formatMatchTone(85, 'ar');
      const mid = formatMatchTone(72, 'ar');
      const low = formatMatchTone(50, 'ar');

      expect(high).toContain('تطابق قوي');
      expect(mid).toContain('تطابق متوسط');
      expect(low).toContain('تطابق ضعيف');

      // Verify strict requirement: no numerical percentages or % symbol
      expect(high).not.toContain('%');
      expect(mid).not.toContain('%');
      expect(low).not.toContain('%');
      expect(high).not.toMatch(/\d+/);
      expect(mid).not.toMatch(/\d+/);
      expect(low).not.toMatch(/\d+/);
    });

    it('should format English match tiers with strong/moderate/weak indicators and zero percentages', () => {
      const high = formatMatchTone(85, 'en');
      const mid = formatMatchTone(70, 'en');
      const low = formatMatchTone(55, 'en');

      expect(high).toContain('Strong Match');
      expect(mid).toContain('Moderate Match');
      expect(low).toContain('Weak Match');

      expect(high).not.toContain('%');
      expect(mid).not.toContain('%');
      expect(low).not.toContain('%');
    });
  });

  describe('formatExperienceLevel', () => {
    it('should format seniority in Arabic', () => {
      expect(formatExperienceLevel('JUNIOR', 'ar')).toContain('مبتدئ');
      expect(formatExperienceLevel('MID', 'ar')).toContain('متوسط');
      expect(formatExperienceLevel('SENIOR', 'ar')).toContain('متقدم');
      expect(formatExperienceLevel('UNKNOWN', 'ar')).toContain('كافة مستويات الخبرة');
      expect(formatExperienceLevel(null, 'ar')).toContain('كافة مستويات الخبرة');
    });

    it('should format seniority in English', () => {
      expect(formatExperienceLevel('JUNIOR', 'en')).toContain('Entry-level');
      expect(formatExperienceLevel('MID', 'en')).toContain('Mid-level');
      expect(formatExperienceLevel('SENIOR', 'en')).toContain('Senior');
      expect(formatExperienceLevel('UNKNOWN', 'en')).toContain('all experience levels');
    });
  });

  describe('formatRemoteScope', () => {
    it('should format remote and regional scopes in Arabic', () => {
      expect(formatRemoteScope('WORLDWIDE', null, null, 'ar')).toContain('عالمياً');
      expect(formatRemoteScope('REGION', null, 'MENA', 'ar')).toContain('إقليمياً (MENA)');
      expect(formatRemoteScope('COUNTRY', 'Egypt', null, 'ar')).toContain('محلي (Egypt)');
      expect(formatRemoteScope('UNKNOWN', 'Jordan', null, 'ar')).toContain('حضوري / هجين (Jordan)');
    });

    it('should format remote and regional scopes in English', () => {
      expect(formatRemoteScope('WORLDWIDE', null, null, 'en')).toContain('Worldwide Remote');
      expect(formatRemoteScope('REGION', null, 'EMEA', 'en')).toContain('Regional Remote (EMEA)');
      expect(formatRemoteScope('COUNTRY', 'UAE', null, 'en')).toContain('Remote (UAE)');
      expect(formatRemoteScope('UNKNOWN', 'Saudi Arabia', null, 'en')).toContain('On-site / Hybrid (Saudi Arabia)');
    });
  });

  describe('paginateDigestJobs', () => {
    const dummyJobs: DigestCardJob[] = Array.from({ length: 25 }, (_, i) => ({
      id: `job-${i + 1}`,
      title: `Software Engineer ${i + 1}`,
      company: `Company ${i + 1}`,
      applicationUrl: `https://example.com/apply/${i + 1}`,
      score: 80,
    }));

    it('should enforce max 20 total jobs cap across all pages', () => {
      const page1 = paginateDigestJobs(dummyJobs, 1, 5, 20);

      expect(page1.totalDigestJobs).toBe(MAX_DIGEST_TOTAL_JOBS);
      expect(page1.totalPages).toBe(4);
      expect(page1.currentPage).toBe(1);
      expect(page1.pagedJobs).toHaveLength(5);
      expect(page1.pagedJobs[0].title).toBe('Software Engineer 1');
      expect(page1.pagedJobs[4].title).toBe('Software Engineer 5');
      expect(page1.hasPreviousPage).toBe(false);
      expect(page1.hasNextPage).toBe(true);
    });

    it('should slice page 2 correctly', () => {
      const page2 = paginateDigestJobs(dummyJobs, 2, 5, 20);

      expect(page2.currentPage).toBe(2);
      expect(page2.pagedJobs).toHaveLength(5);
      expect(page2.pagedJobs[0].title).toBe('Software Engineer 6');
      expect(page2.pagedJobs[4].title).toBe('Software Engineer 10');
      expect(page2.hasPreviousPage).toBe(true);
      expect(page2.hasNextPage).toBe(true);
    });

    it('should slice last page (page 4) correctly', () => {
      const page4 = paginateDigestJobs(dummyJobs, 4, 5, 20);

      expect(page4.currentPage).toBe(4);
      expect(page4.pagedJobs).toHaveLength(5);
      expect(page4.pagedJobs[0].title).toBe('Software Engineer 16');
      expect(page4.pagedJobs[4].title).toBe('Software Engineer 20');
      expect(page4.hasPreviousPage).toBe(true);
      expect(page4.hasNextPage).toBe(false);
    });

    it('should clamp out-of-bounds page requests', () => {
      const clampUnder = paginateDigestJobs(dummyJobs, 0, 5, 20);
      expect(clampUnder.currentPage).toBe(1);

      const clampOver = paginateDigestJobs(dummyJobs, 99, 5, 20);
      expect(clampOver.currentPage).toBe(4);
    });

    it('should handle empty jobs collection gracefully', () => {
      const emptyResult = paginateDigestJobs([], 1, DEFAULT_PAGE_SIZE, MAX_DIGEST_TOTAL_JOBS);

      expect(emptyResult.totalDigestJobs).toBe(0);
      expect(emptyResult.totalPages).toBe(1);
      expect(emptyResult.currentPage).toBe(1);
      expect(emptyResult.pagedJobs).toEqual([]);
      expect(emptyResult.hasPreviousPage).toBe(false);
      expect(emptyResult.hasNextPage).toBe(false);
    });
  });

  describe('formatJobCard', () => {
    it('should format a job card with direct application markdown link in Arabic', () => {
      const job: DigestCardJob = {
        title: 'Backend Node.js Developer',
        company: 'Acme Corp',
        applicationUrl: 'https://acme.com/jobs/node-dev',
        location: 'Riyadh',
        remoteScope: 'REGION',
        experienceLevel: 'MID',
        score: 85,
      };

      const card = formatJobCard(job, 1, 'ar');

      expect(card).toContain('*1.* 💼 [Backend Node.js Developer](https://acme.com/jobs/node-dev)');
      expect(card).toContain('🏢 *Acme Corp* | 📍 Riyadh');
      expect(card).toContain('عمل عن بُعد إقليمياً');
      expect(card).toContain('مستوى متوسط (Mid-level)');
      expect(card).toContain('تطابق قوي');
      expect(card).toContain('🔗 [التقديم المباشر](https://acme.com/jobs/node-dev)');
    });

    it('should format a job card without link if url is missing', () => {
      const job: DigestCardJob = {
        title: 'Lead Systems Architect',
        company: 'Stark Industries',
        applicationUrl: null,
        url: null,
        experienceLevel: 'SENIOR',
        score: 60,
      };

      const card = formatJobCard(job, 2, 'en');

      expect(card).toContain('*2.* 💼 *Lead Systems Architect*');
      expect(card).toContain('🏢 *Stark Industries*');
      expect(card).toContain('Senior / Lead');
      expect(card).toContain('Weak Match');
      expect(card).not.toContain('🔗 [Direct Application]');
    });
  });

  describe('formatDigestPageMessage', () => {
    it('should return empty state message when no jobs are available', () => {
      const arEmpty = formatDigestPageMessage([], { language: 'ar' });
      expect(arEmpty).toContain('لا توجد وظائف مطابقة لتفضيلاتك حالياً');
      expect(arEmpty).toContain('/settings');

      const enEmpty = formatDigestPageMessage([], { language: 'en' });
      expect(enEmpty).toContain('No matching opportunities right now');
      expect(enEmpty).toContain('/settings');
    });

    it('should render page 1 of 5 jobs with header, cards, and page counter footer', () => {
      const jobs: DigestCardJob[] = Array.from({ length: 12 }, (_, i) => ({
        id: `job-${i + 1}`,
        title: `Fullstack Developer ${i + 1}`,
        company: `Company ${i + 1}`,
        applicationUrl: `https://example.com/${i + 1}`,
        score: 82,
      }));

      const message = formatDigestPageMessage(jobs, {
        language: 'ar',
        pageNumber: 1,
        pageSize: 5,
      });

      expect(message).toContain('فرص عمل واعدة مختارة لك بعناية');
      expect(message).toContain('Fullstack Developer 1');
      expect(message).toContain('Fullstack Developer 5');
      expect(message).not.toContain('Fullstack Developer 6');
      expect(message).toContain('الصفحة 1 من 3');
      expect(message).toContain('/jobs');
    });
  });

  describe('getTelegramDigestSendOptions', () => {
    it('should return markdown mode with disabled link previews', () => {
      const options = getTelegramDigestSendOptions();

      expect(options.parse_mode).toBe('Markdown');
      expect(options.disable_web_page_preview).toBe(true);
      expect(options.link_preview_options.is_disabled).toBe(true);
    });
  });
});


import { describe, it, expect } from 'vitest';
import ms from 'ms';
import {
  stripHtml,
  stripUtmParams,
  isValidUrl,
  cleanUrl,
  decodeHtmlEntities,
  stripControlCharacters,
  sanitizeSingleLine,
  sanitizeMultiLine,
  formatDurationMs,
  DEFAULT_SANITIZATION_TIMEOUT_MS,
  URL_NORMALIZATION_CACHE_TTL_MS,
  parsePublicationDate,
  normalizeLocation,
} from '../../src/modules/jobs/job.sanitizer.js';

describe('TASK-27.1: Text Sanitization & Safe HTML Stripping', () => {
  describe('HTML stripping and entity decoding', () => {
    it('meets acceptance criteria: strips HTML and decodes &amp;', () => {
      const input = '<p>Senior Backend <b>Engineer</b> &amp; Team Lead</p>';
      const output = stripHtml(input);
      expect(output).toBe('Senior Backend Engineer & Team Lead');
    });

    it('preserves line breaks for paragraph and block level elements', () => {
      const input = `
        <h3>Job Overview</h3>
        <p>First paragraph with <strong>bold</strong> text.</p>
        <p>Second paragraph with <em>italic</em> text.</p>
        <ul>
          <li>Point 1</li>
          <li>Point 2</li>
        </ul>
      `;
      const output = stripHtml(input);
      expect(output).toContain('Job Overview\nFirst paragraph with bold text.');
      expect(output).toContain('Second paragraph with italic text.');
      expect(output).toContain('Point 1\nPoint 2');
    });

    it('decodes various named, decimal, and hex HTML entities', () => {
      const input = 'Copyright &copy; 2026 &mdash; High&nbsp;Performance &quot;Fast&quot; &#39;Quotes&#39;';
      const output = decodeHtmlEntities(input);
      expect(output).toBe('Copyright © 2026 — High Performance "Fast" \'Quotes\'');
    });

    it('safely strips dangerous <script> and <style> blocks and their content', () => {
      const input = '<div>Hello<script>alert("XSS")</script><style>body { color: red; }</style> World!</div>';
      const output = stripHtml(input);
      expect(output).toBe('Hello World!');
      expect(output).not.toContain('alert');
      expect(output).not.toContain('color: red');
    });

    it('strips non-printable control characters while keeping tabs and newlines', () => {
      const input = 'Clean\x00\x07Text\twith\nnewlines';
      const output = stripControlCharacters(input);
      expect(output).toBe('CleanText\twith\nnewlines');
    });
  });

  describe('Single-line and multi-line field sanitizers', () => {
    it('collapses single-line strings like titles and companies', () => {
      const title = '<h1>  Senior\n  Fullstack\t Engineer  </h1>';
      expect(sanitizeSingleLine(title)).toBe('Senior Fullstack Engineer');

      const company = '  <b>Acme &amp; Co.</b>\x00 ';
      expect(sanitizeSingleLine(company)).toBe('Acme & Co.');
    });

    it('handles empty, null, or undefined inputs gracefully', () => {
      expect(sanitizeSingleLine(undefined)).toBe('');
      expect(sanitizeSingleLine(null)).toBe('');
      expect(sanitizeSingleLine('')).toBe('');
      expect(sanitizeMultiLine(undefined)).toBe('');
      expect(sanitizeMultiLine(null)).toBe('');
      expect(sanitizeMultiLine('')).toBe('');
    });
  });

  describe('URL sanitization and UTM parameter stripping', () => {
    it('meets acceptance criteria: strips UTM tracking parameters', () => {
      const input = 'https://company.com/job?utm_source=adzuna&utm_medium=api';
      const output = stripUtmParams(input);
      expect(output).toBe('https://company.com/job');
    });

    it('strips UTM, Facebook, and Google tracking parameters while preserving functional query params', () => {
      const input =
        'https://boards.greenhouse.io/job/123?utm_campaign=oct&fbclid=abc123xyz&id=999&gclid=g1&page=2&ref=jobboard';
      const output = stripUtmParams(input);
      expect(output).toBe('https://boards.greenhouse.io/job/123?id=999&page=2');
    });

    it('validates URLs using Zod schema', () => {
      expect(isValidUrl('https://example.com/jobs/1')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('cleanUrl strips UTM parameters and validates URL', () => {
      expect(cleanUrl('https://remotive.com/job/456?utm_source=google')).toBe('https://remotive.com/job/456');
      expect(cleanUrl('invalid-url-string')).toBe('');
      expect(cleanUrl(undefined)).toBe('');
      expect(cleanUrl(null)).toBe('');
    });
  });

  describe('ms library constants and duration formatting', () => {
    it('verifies ms library defines processing timeouts and cache TTLs', () => {
      expect(DEFAULT_SANITIZATION_TIMEOUT_MS).toBe(ms('2s'));
      expect(DEFAULT_SANITIZATION_TIMEOUT_MS).toBe(2000);

      expect(URL_NORMALIZATION_CACHE_TTL_MS).toBe(ms('1h'));
      expect(URL_NORMALIZATION_CACHE_TTL_MS).toBe(3600000);
    });

    it('formats duration in milliseconds to human-readable string', () => {
      expect(formatDurationMs(500)).toBe('500ms');
      expect(formatDurationMs(2500)).toBe('3s');
      expect(formatDurationMs(60000)).toBe('1m');
    });
  });
});

describe('TASK-27.2: Location & Timestamp Standardization', () => {
  const fixedNow = new Date('2026-10-31T12:00:00.000Z');

  describe('parsePublicationDate', () => {
    it('meets acceptance criteria: converts ISO-8601 strings to valid Date', () => {
      const date = parsePublicationDate('2026-10-15T12:00:00Z', fixedNow);
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    });

    it('meets acceptance criteria: converts RFC-2822 date strings to valid Date', () => {
      const date = parsePublicationDate('Wed, 14 Oct 2026 10:00:00 GMT', fixedNow);
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe('2026-10-14T10:00:00.000Z');
    });

    it('meets acceptance criteria: converts epoch in seconds to valid Date', () => {
      const date = parsePublicationDate(1792000000, fixedNow);
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(1792000000 * 1000);
    });

    it('converts epoch string and epoch in milliseconds to valid Date', () => {
      const fromStr = parsePublicationDate('1792000000', fixedNow);
      expect(fromStr.getTime()).toBe(1792000000 * 1000);

      const fromMs = parsePublicationDate(1792000000000, fixedNow);
      expect(fromMs.getTime()).toBe(1792000000000);
    });

    it('parses relative Arabic date expressions correctly', () => {
      const twoHoursAgo = parsePublicationDate('منذ ساعتين', fixedNow);
      expect(twoHoursAgo.getTime()).toBe(fixedNow.getTime() - ms('2h'));

      const threeHoursAgo = parsePublicationDate('منذ 3 ساعات', fixedNow);
      expect(threeHoursAgo.getTime()).toBe(fixedNow.getTime() - ms('3h'));

      const twoDaysAgo = parsePublicationDate('منذ يومين', fixedNow);
      expect(twoDaysAgo.getTime()).toBe(fixedNow.getTime() - ms('2d'));

      const threeDaysAgo = parsePublicationDate('منذ 3 أيام', fixedNow);
      expect(threeDaysAgo.getTime()).toBe(fixedNow.getTime() - ms('3d'));

      const oneWeekAgo = parsePublicationDate('منذ أسبوع', fixedNow);
      expect(oneWeekAgo.getTime()).toBe(fixedNow.getTime() - ms('7d'));

      const twoWeeksAgo = parsePublicationDate('منذ أسبوعين', fixedNow);
      expect(twoWeeksAgo.getTime()).toBe(fixedNow.getTime() - ms('14d'));

      const oneMonthAgo = parsePublicationDate('منذ شهر', fixedNow);
      expect(oneMonthAgo.getTime()).toBe(fixedNow.getTime() - ms('30d'));

      const today = parsePublicationDate('اليوم', fixedNow);
      expect(today.getTime()).toBe(fixedNow.getTime());
    });

    it('parses relative English date expressions correctly using ms library', () => {
      const justNow = parsePublicationDate('just now', fixedNow);
      expect(justNow.getTime()).toBe(fixedNow.getTime());

      const yesterday = parsePublicationDate('yesterday', fixedNow);
      expect(yesterday.getTime()).toBe(fixedNow.getTime() - ms('1d'));

      const twoHours = parsePublicationDate('2 hours ago', fixedNow);
      expect(twoHours.getTime()).toBe(fixedNow.getTime() - ms('2h'));

      const threeDays = parsePublicationDate('3 days ago', fixedNow);
      expect(threeDays.getTime()).toBe(fixedNow.getTime() - ms('3d'));

      const oneWeek = parsePublicationDate('1 week ago', fixedNow);
      expect(oneWeek.getTime()).toBe(fixedNow.getTime() - ms('7d'));

      const oneMonth = parsePublicationDate('1 month ago', fixedNow);
      expect(oneMonth.getTime()).toBe(fixedNow.getTime() - ms('30d'));
    });

    it('defaults missing or unparseable dates to scrapedAt timestamp', () => {
      expect(parsePublicationDate(undefined, fixedNow).getTime()).toBe(fixedNow.getTime());
      expect(parsePublicationDate(null, fixedNow).getTime()).toBe(fixedNow.getTime());
      expect(parsePublicationDate('', fixedNow).getTime()).toBe(fixedNow.getTime());
      expect(parsePublicationDate('invalid-gibberish-date', fixedNow).getTime()).toBe(fixedNow.getTime());
    });
  });

  describe('normalizeLocation', () => {
    it('normalizes Arab region locations and extracts city and ISO country code', () => {
      const riyadh = normalizeLocation('Riyadh, Saudi Arabia');
      expect(riyadh.city).toBe('Riyadh');
      expect(riyadh.country).toBe('SA');
      expect(riyadh.isRemote).toBe(false);

      const dubai = normalizeLocation('Dubai, United Arab Emirates');
      expect(dubai.city).toBe('Dubai');
      expect(dubai.country).toBe('AE');
      expect(dubai.isRemote).toBe(false);

      const cairo = normalizeLocation('Cairo, Egypt');
      expect(cairo.city).toBe('Cairo');
      expect(cairo.country).toBe('EG');

      const amman = normalizeLocation('Amman, Jordan');
      expect(amman.city).toBe('Amman');
      expect(amman.country).toBe('JO');

      const kuwait = normalizeLocation('Kuwait City, Kuwait');
      expect(kuwait.city).toBe('Kuwait City');
      expect(kuwait.country).toBe('KW');
    });

    it('normalizes international locations and extracts city and ISO country code', () => {
      const london = normalizeLocation('London, UK');
      expect(london.city).toBe('London');
      expect(london.country).toBe('GB');

      const berlin = normalizeLocation('Berlin, Germany');
      expect(berlin.city).toBe('Berlin');
      expect(berlin.country).toBe('DE');

      const sf = normalizeLocation('San Francisco, USA');
      expect(sf.city).toBe('San Francisco');
      expect(sf.country).toBe('US');

      const toronto = normalizeLocation('Toronto, Canada');
      expect(toronto.city).toBe('Toronto');
      expect(toronto.country).toBe('CA');
    });

    it('detects remote indicators in both Arabic and English', () => {
      const engRemote = normalizeLocation('Remote - Work from anywhere');
      expect(engRemote.isRemote).toBe(true);

      const arabRemote = normalizeLocation('الرياض - العمل عن بعد');
      expect(arabRemote.isRemote).toBe(true);
      expect(arabRemote.city).toBe('Riyadh');
      expect(arabRemote.country).toBe('SA');

      const homeRemote = normalizeLocation('Cairo, Egypt (Work from home)');
      expect(homeRemote.isRemote).toBe(true);
      expect(homeRemote.city).toBe('Cairo');
      expect(homeRemote.country).toBe('EG');
    });

    it('honors explicitRemote parameter', () => {
      const loc = normalizeLocation('London, UK', true);
      expect(loc.isRemote).toBe(true);
      expect(loc.country).toBe('GB');
    });

    it('handles empty or undefined inputs safely', () => {
      const empty = normalizeLocation(undefined);
      expect(empty.location).toBe('');
      expect(empty.isRemote).toBe(false);
      expect(empty.country).toBeUndefined();
    });
  });
});

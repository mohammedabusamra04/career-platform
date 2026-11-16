/**
 * TASK-27: Job Normalization & Sanitization
 * TASK-27.1: Text Sanitization & Safe HTML Stripping (#84)
 * TASK-27.2: Location & Timestamp Standardization (#85)
 *
 * Implements:
 * - HTML tag stripping with paragraph and block line-break preservation
 * - Script and style element content removal
 * - Complete HTML entity decoding (named, decimal, and hexadecimal)
 * - Control character stripping (preventing terminal/markdown injection)
 * - Safe URL cleaning with UTM and click tracking parameter removal
 * - Strict URL validation via Zod (z.string().url() with http/https protocols)
 * - Publication date normalization (Epoch, ISO-8601, RFC-2822, Relative Arabic/English)
 * - Location normalization (City extraction, ISO country code mapping, remote indicator)
 * - Performance guard and duration formatting using ms library
 */

import ms from 'ms';
import { z } from 'zod';
import logger from '../../shared/utils/logger.js';

/** Default processing timeout for expensive regex operations */
export const DEFAULT_SANITIZATION_TIMEOUT_MS = ms('2s');

/** Default URL cache TTL for memoized normalization */
export const URL_NORMALIZATION_CACHE_TTL_MS = ms('1h');

/**
 * Zod schema for strict URL validation (HTTP / HTTPS).
 */
export const urlSchema = z
  .string()
  .url()
  .refine(
    (val) => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (err: unknown) {
        logger.debug(`[JobSanitizer] Invalid URL protocol parse for ${val}: ${(err as Error).message}`);
        return false;
      }
    },
    { message: 'URL must use http or https protocol' },
  );

/**
 * Common tracking and attribution query parameters stripped during URL sanitization.
 */
export const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_eid',
  'zanpid',
  'igshid',
  'ref',
  'referrer',
  'affiliate_id',
]);

/**
 * Standard named HTML entities mapping to their decoded characters.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&laquo;': '«',
  '&raquo;': '»',
  '&bull;': '•',
  '&middot;': '·',
  '&cent;': '¢',
  '&pound;': '£',
  '&yen;': '¥',
  '&euro;': '€',
  '&sect;': '§',
};

/**
 * HTML block-level elements that represent structural paragraph/line separation.
 */
const CLOSING_BLOCK_TAGS_RE =
  /<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi;

const BR_TAGS_RE = /<br\s*\/?>/gi;

/**
 * Regex matching `<script>`, `<style>`, and `<noscript>` blocks including their inner contents.
 */
const SCRIPT_STYLE_BLOCKS_RE =
  /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Dangerous control characters (excluding newline \n, carriage return \r, and tab \t).
 * Matches ASCII 0-8, 11-12, 14-31, 127.
 */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Decodes all HTML entities from a string.
 * Supports:
 * 1. Named entities (&amp;, &nbsp;, &quot;, etc.)
 * 2. Decimal entities (&#160;, &#8212;, etc.)
 * 3. Hexadecimal entities (&#xA0;, &#x2014;, etc.)
 */
export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes('&')) {
    return text;
  }

  return text
    .replace(/&[a-z0-9]+;/gi, (entity) => NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const codeNum = parseInt(code, 10);
      return Number.isNaN(codeNum) ? '' : String.fromCharCode(codeNum);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const codeNum = parseInt(hex, 16);
      return Number.isNaN(codeNum) ? '' : String.fromCharCode(codeNum);
    });
}

/**
 * Removes dangerous non-printable control characters from text.
 * Preserves tabs and standard newlines.
 */
export function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARS_RE, '');
}

/**
 * Strips HTML tags from input while preserving paragraph line breaks and decoding entities.
 *
 * Meets TASK-27.1 acceptance criteria:
 * - Input: `<p>Senior Backend <b>Engineer</b> &amp; Team Lead</p>`
 * - Output: `Senior Backend Engineer & Team Lead`
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  // 1. Remove dangerous script, style, noscript blocks completely
  const withoutScripts = html.replace(SCRIPT_STYLE_BLOCKS_RE, ' ');

  // 2. Convert <br> and closing block tags to newlines to preserve paragraph boundaries
  const withLineBreaks = withoutScripts
    .replace(BR_TAGS_RE, '\n')
    .replace(CLOSING_BLOCK_TAGS_RE, '\n');

  // 3. Remove all remaining HTML tags
  const noTags = withLineBreaks.replace(/<[^>]*>/g, ' ');

  // 4. Strip control characters
  const cleanChars = stripControlCharacters(noTags);

  // 5. Decode HTML entities
  const decoded = decodeHtmlEntities(cleanChars);

  // 6. Normalize whitespace while respecting line breaks
  const lines = decoded.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/[ \t]+/g, ' ').trim();
    if (trimmed.length > 0) {
      cleanedLines.push(trimmed);
    }
  }

  return cleanedLines.join('\n').trim();
}

/**
 * Sanitizes single-line fields (e.g., job title, company name).
 * Strips HTML tags, removes all line breaks, decodes entities, and collapses spaces.
 */
export function sanitizeSingleLine(text: string | undefined | null): string {
  if (!text) return '';
  const stripped = stripHtml(text);
  return stripped.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitizes multi-line text (e.g., job description).
 * Preserves structural line breaks for Telegram markdown and web rendering.
 */
export function sanitizeMultiLine(text: string | undefined | null): string {
  if (!text) return '';
  return stripHtml(text);
}

/**
 * Strips UTM and advertising tracking parameters from a URL while preserving functional query params.
 *
 * Meets TASK-27.1 acceptance criteria:
 * - Input: `https://company.com/job?utm_source=adzuna&utm_medium=api`
 * - Output: `https://company.com/job`
 */
export function stripUtmParams(rawUrl: string): string {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const keysToDelete: string[] = [];

    for (const key of parsed.searchParams.keys()) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }

    // Clean up empty query string delimiter
    return parsed.toString().replace(/\?$/, '');
  } catch (err: unknown) {
    logger.debug(`[JobSanitizer] URL normalization fallback for ${trimmed}: ${(err as Error).message}`);
    return trimmed;
  }
}

/**
 * Validates whether a given string is a valid URL using Zod.
 */
export function isValidUrl(url: string): boolean {
  return urlSchema.safeParse(url).success;
}

/**
 * Strips tracking parameters from a URL and validates it with Zod.
 * Returns the cleaned URL if valid, or an empty string if invalid.
 */
export function cleanUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  const cleaned = stripUtmParams(rawUrl.trim());
  return isValidUrl(cleaned) ? cleaned : '';
}

/**
 * Formats a duration in milliseconds using ms.
 */
export function formatDurationMs(durationMs: number): string {
  return ms(durationMs);
}

// ---------------------------------------------------------------------------
// TASK-27.2: Location & Timestamp Standardization
// ---------------------------------------------------------------------------

/**
 * Arabic relative time patterns mapping to duration offset functions.
 * Ordered intentionally: duals (يومين، ساعتين) before singulars (يوم، ساعة).
 */
const ARABIC_RELATIVE_DATE_PATTERNS: Array<[RegExp, (match: RegExpExecArray) => number]> = [
  // الآن / اليوم / أمس
  [/^(?:الآن|للتو|حالياً)$/i, () => 0],
  [/^(?:اليوم)$/i, () => 0],
  [/^(?:أمس|بالأمس)$/i, () => -ms('1d')],

  // ثوانٍ ودقائق
  [/منذ\s*(\d+)\s*(?:ثوانٍ|ثواني|ثانية)/i, (m) => -parseInt(m[1]!, 10) * ms('1s')],
  [/منذ\s*دقيقتين/i, () => -ms('2m')],
  [/منذ\s*دقيقة/i, () => -ms('1m')],
  [/منذ\s*(\d+)\s*(?:دقائق|دقيقة)/i, (m) => -parseInt(m[1]!, 10) * ms('1m')],

  // ساعات
  [/منذ\s*ساعتين/i, () => -ms('2h')],
  [/منذ\s*ساعة/i, () => -ms('1h')],
  [/منذ\s*(\d+)\s*(?:ساعات|ساعة)/i, (m) => -parseInt(m[1]!, 10) * ms('1h')],

  // أيام
  [/منذ\s*يومين/i, () => -ms('2d')],
  [/منذ\s*يوم(?![ء-ي])/i, () => -ms('1d')],
  [/منذ\s*(\d+)\s*(?:أيام|ايام|يوم)/i, (m) => -parseInt(m[1]!, 10) * ms('1d')],

  // أسابيع
  [/منذ\s*(?:أسبوعين|اسبوعين)/i, () => -ms('14d')],
  [/منذ\s*(?:أسبوع|اسبوع)(?![ء-ي])/i, () => -ms('7d')],
  [/منذ\s*(\d+)\s*(?:أسابيع|اسابيع|أسبوع|اسبوع)/i, (m) => -parseInt(m[1]!, 10) * ms('7d')],

  // أشهر
  [/منذ\s*شهرين/i, () => -ms('60d')],
  [/منذ\s*شهر(?![ء-ي])/i, () => -ms('30d')],
  [/منذ\s*(\d+)\s*(?:أشهر|اشهر|شهور|شهر)/i, (m) => -parseInt(m[1]!, 10) * ms('30d')],
];

/**
 * Parses English relative date strings into Date objects using `ms`.
 * Handles expressions like "just now", "yesterday", "2 hours ago", "3 days ago".
 */
function parseEnglishRelativeDate(text: string, now: Date): Date | null {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === 'just now' || trimmed === 'today') {
    return new Date(now.getTime());
  }
  if (trimmed === 'yesterday') {
    return new Date(now.getTime() - ms('1d'));
  }

  if (/^an?\s+hour\s+ago$/i.test(trimmed)) {
    return new Date(now.getTime() - ms('1h'));
  }
  if (/^a\s+day\s+ago$/i.test(trimmed)) {
    return new Date(now.getTime() - ms('1d'));
  }
  if (/^a\s+week\s+ago$/i.test(trimmed)) {
    return new Date(now.getTime() - ms('7d'));
  }
  if (/^a\s+month\s+ago$/i.test(trimmed)) {
    return new Date(now.getTime() - ms('30d'));
  }

  const agoMatch = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(trimmed);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1]!, 10);
    const unit = agoMatch[2]!.toLowerCase();

    let durationMs: number;
    if (unit === 'second') durationMs = amount * ms('1s');
    else if (unit === 'minute') durationMs = amount * ms('1m');
    else if (unit === 'hour') durationMs = amount * ms('1h');
    else if (unit === 'day') durationMs = amount * ms('1d');
    else if (unit === 'week') durationMs = amount * ms('7d');
    else if (unit === 'month') durationMs = amount * ms('30d');
    else if (unit === 'year') durationMs = amount * ms('365d');
    else return null;

    return new Date(now.getTime() - durationMs);
  }

  return null;
}

/**
 * Parses multiple date formats into a standard JS Date object.
 *
 * Supported formats:
 * 1. Date instance
 * 2. Epoch numbers or numeric strings (seconds or milliseconds)
 * 3. ISO-8601 strings (e.g., "2026-10-15T12:00:00Z")
 * 4. RFC-2822 dates (e.g., "Wed, 14 Oct 2026 10:00:00 GMT")
 * 5. Relative Arabic strings (e.g., "منذ ساعتين", "منذ 3 أيام")
 * 6. Relative English strings (e.g., "3 days ago", "just now")
 * 7. Fallback to scrapedAt (or new Date()) when missing/unparseable
 */
export function parsePublicationDate(
  value: string | number | Date | undefined | null,
  scrapedAt: Date = new Date(),
): Date {
  if (value === undefined || value === null || value === '') {
    return scrapedAt;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? scrapedAt : value;
  }

  // Epoch numeric timestamp
  if (
    typeof value === 'number' ||
    (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))
  ) {
    const num = typeof value === 'number' ? value : parseFloat(value.trim());
    if (Number.isNaN(num) || num <= 0) return scrapedAt;
    const ts = num < 1e11 ? num * 1000 : num;
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? scrapedAt : date;
  }

  const str = String(value).trim();

  // 1. Arabic relative patterns
  for (const [pattern, getOffset] of ARABIC_RELATIVE_DATE_PATTERNS) {
    const match = pattern.exec(str);
    if (match) {
      return new Date(scrapedAt.getTime() + getOffset(match));
    }
  }

  // 2. English relative patterns
  const englishRelative = parseEnglishRelativeDate(str, scrapedAt);
  if (englishRelative) {
    return englishRelative;
  }

  // 3. Standard ISO-8601 or RFC-2822 date string
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return scrapedAt;
}

// ---------------------------------------------------------------------------
// Location Standardization
// ---------------------------------------------------------------------------

export interface NormalizedLocation {
  /** Cleaned location text */
  location: string;
  /** Recognized city name if identified */
  city?: string;
  /** ISO 3166-1 alpha-2 country code if identified */
  country?: string;
  /** Whether the role is remote */
  isRemote: boolean;
}

const REMOTE_REGEX =
  /(?:\b(remote|remotely|telecommute|distributed|work from home|wfh|work from anywhere)\b|(?:عن\s*بعد|عمل\s*عن\s*بعد|العمل\s*عن\s*بعد|من\s*المنزل))/i;

interface LocationMetadata {
  countryCode: string;
  countryName: string;
  countryPattern: RegExp;
  cities: Array<{ name: string; pattern: RegExp }>;
}

const LOCATION_TAXONOMY: LocationMetadata[] = [
  // Arab Countries
  {
    countryCode: 'SA',
    countryName: 'Saudi Arabia',
    countryPattern: /(?:\b(saudi\s*arabia|saudi|ksa)\b|(?:السعودية|المملكة العربية السعودية))/i,
    cities: [
      { name: 'Riyadh', pattern: /(?:\briyadh\b|الرياض)/i },
      { name: 'Jeddah', pattern: /(?:\bjeddah\b|جدة)/i },
      { name: 'Dammam', pattern: /(?:\bdammam\b|الدمام)/i },
      { name: 'Khobar', pattern: /(?:\bkhobar\b|الخبر)/i },
      { name: 'Mecca', pattern: /(?:\b(mecca|makkah)\b|(?:مكة|مكة المكرمة))/i },
      { name: 'Medina', pattern: /(?:\b(medina|madinah)\b|(?:المدينة|المدينة المنورة))/i },
    ],
  },
  {
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    countryPattern: /(?:\b(uae|united\s*arab\s*emirates|emirates)\b|(?:الإمارات|الامارات|دولة الإمارات العربية المتحدة))/i,
    cities: [
      { name: 'Dubai', pattern: /(?:\bdubai\b|دبي)/i },
      { name: 'Abu Dhabi', pattern: /(?:\babu\s*dhabi\b|(?:أبوظبي|ابوظبي))/i },
      { name: 'Sharjah', pattern: /(?:\bsharjah\b|الشارقة)/i },
      { name: 'Ajman', pattern: /(?:\bajman\b|عجمان)/i },
    ],
  },
  {
    countryCode: 'EG',
    countryName: 'Egypt',
    countryPattern: /(?:\begypt\b|(?:مصر|جمهورية مصر العربية))/i,
    cities: [
      { name: 'Cairo', pattern: /(?:\bcairo\b|القاهرة)/i },
      { name: 'Alexandria', pattern: /(?:\b(alexandria|alex)\b|(?:الإسكندرية|الاسكندرية))/i },
      { name: 'Giza', pattern: /(?:\bgiza\b|الجيزة)/i },
      { name: 'Mansoura', pattern: /(?:\bmansoura\b|المنصورة)/i },
      { name: 'Tanta', pattern: /(?:\btanta\b|طنطا)/i },
    ],
  },
  {
    countryCode: 'JO',
    countryName: 'Jordan',
    countryPattern: /(?:\bjordan\b|(?:الأردن|الاردن|المملكة الأردنية الهاشمية))/i,
    cities: [
      { name: 'Amman', pattern: /(?:\bamman\b|عمان)/i },
      { name: 'Zarqa', pattern: /(?:\bzarqa\b|الزرقاء)/i },
      { name: 'Irbid', pattern: /(?:\birbid\b|(?:إربد|اربد))/i },
    ],
  },
  {
    countryCode: 'KW',
    countryName: 'Kuwait',
    countryPattern: /(?:\bkuwait\b|(?:الكويت|دولة الكويت))/i,
    cities: [
      { name: 'Kuwait City', pattern: /(?:\bkuwait\s*city\b|مدينة الكويت)/i },
      { name: 'Hawally', pattern: /(?:\bhawally\b|حولي)/i },
    ],
  },
  {
    countryCode: 'QA',
    countryName: 'Qatar',
    countryPattern: /(?:\bqatar\b|(?:قطر|دولة قطر))/i,
    cities: [
      { name: 'Doha', pattern: /(?:\bdoha\b|الدوحة)/i },
      { name: 'Al Rayyan', pattern: /(?:\bal\s*rayyan\b|الريان)/i },
    ],
  },
  {
    countryCode: 'BH',
    countryName: 'Bahrain',
    countryPattern: /(?:\bbahrain\b|(?:البحرين|مملكة البحرين))/i,
    cities: [
      { name: 'Manama', pattern: /(?:\bmanama\b|المنامة)/i },
    ],
  },
  {
    countryCode: 'OM',
    countryName: 'Oman',
    countryPattern: /(?:\boman\b|(?:عُمان|عمان|سلطنة عُمان|سلطنة عمان))/i,
    cities: [
      { name: 'Muscat', pattern: /(?:\bmuscat\b|مسقط)/i },
    ],
  },
  {
    countryCode: 'LB',
    countryName: 'Lebanon',
    countryPattern: /(?:\blebanon\b|(?:لبنان|الجمهورية اللبنانية))/i,
    cities: [
      { name: 'Beirut', pattern: /(?:\bbeirut\b|بيروت)/i },
      { name: 'Tripoli', pattern: /(?:\btripoli\b|طرابلس)/i },
    ],
  },
  {
    countryCode: 'MA',
    countryName: 'Morocco',
    countryPattern: /(?:\bmorocco\b|(?:المغرب|المملكة المغربية))/i,
    cities: [
      { name: 'Casablanca', pattern: /(?:\bcasablanca\b|الدار البيضاء)/i },
      { name: 'Rabat', pattern: /(?:\brabat\b|الرباط)/i },
      { name: 'Marrakesh', pattern: /(?:\bmarrakesh\b|مراكش)/i },
      { name: 'Tangier', pattern: /(?:\btangier\b|طنجة)/i },
    ],
  },
  {
    countryCode: 'TN',
    countryName: 'Tunisia',
    countryPattern: /(?:\btunisia\b|(?:تونس|الجمهورية التونسية))/i,
    cities: [
      { name: 'Tunis', pattern: /(?:\btunis\b|مدينة تونس)/i },
      { name: 'Sousse', pattern: /(?:\bsousse\b|سوسة)/i },
      { name: 'Sfax', pattern: /(?:\bsfax\b|صفاقس)/i },
    ],
  },
  {
    countryCode: 'DZ',
    countryName: 'Algeria',
    countryPattern: /(?:\balgeria\b|(?:الجزائر|الجمهورية الجزائرية))/i,
    cities: [
      { name: 'Algiers', pattern: /(?:\balgiers\b|مدينة الجزائر)/i },
      { name: 'Oran', pattern: /(?:\boran\b|وهران)/i },
    ],
  },
  {
    countryCode: 'IQ',
    countryName: 'Iraq',
    countryPattern: /(?:\biraq\b|(?:العراق|جمهورية العراق))/i,
    cities: [
      { name: 'Baghdad', pattern: /(?:\bbaghdad\b|بغداد)/i },
      { name: 'Erbil', pattern: /(?:\berbil\b|(?:أربيل|اربيل))/i },
      { name: 'Basra', pattern: /(?:\bbasra\b|البصرة)/i },
    ],
  },
  {
    countryCode: 'PS',
    countryName: 'Palestine',
    countryPattern: /(?:\bpalestine\b|(?:فلسطين|دولة فلسطين))/i,
    cities: [
      { name: 'Gaza', pattern: /(?:\bgaza\b|غزة)/i },
      { name: 'Ramallah', pattern: /(?:\bramallah\b|رام الله)/i },
      { name: 'Jerusalem', pattern: /(?:\bjerusalem\b|القدس)/i },
    ],
  },

  // International Markets
  {
    countryCode: 'US',
    countryName: 'United States',
    countryPattern: /\b(usa|united\s*states|u\.s\.a?|us\s*only|america)\b/i,
    cities: [
      { name: 'New York', pattern: /\b(new\s*york|nyc)\b/i },
      { name: 'San Francisco', pattern: /\b(san\s*francisco|sf)\b/i },
      { name: 'Seattle', pattern: /\b(seattle)\b/i },
      { name: 'Austin', pattern: /\b(austin)\b/i },
      { name: 'Boston', pattern: /\b(boston)\b/i },
      { name: 'Chicago', pattern: /\b(chicago)\b/i },
      { name: 'Los Angeles', pattern: /\b(los\s*angeles|la)\b/i },
    ],
  },
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    countryPattern: /\b(uk|united\s*kingdom|great\s*britain|britain|england)\b/i,
    cities: [
      { name: 'London', pattern: /\b(london)\b/i },
      { name: 'Manchester', pattern: /\b(manchester)\b/i },
      { name: 'Birmingham', pattern: /\b(birmingham)\b/i },
      { name: 'Edinburgh', pattern: /\b(edinburgh)\b/i },
    ],
  },
  {
    countryCode: 'DE',
    countryName: 'Germany',
    countryPattern: /\b(germany|deutschland)\b/i,
    cities: [
      { name: 'Berlin', pattern: /\b(berlin)\b/i },
      { name: 'Munich', pattern: /\b(munich|münchen)\b/i },
      { name: 'Frankfurt', pattern: /\b(frankfurt)\b/i },
      { name: 'Hamburg', pattern: /\b(hamburg)\b/i },
    ],
  },
  {
    countryCode: 'CA',
    countryName: 'Canada',
    countryPattern: /\b(canada)\b/i,
    cities: [
      { name: 'Toronto', pattern: /\b(toronto)\b/i },
      { name: 'Vancouver', pattern: /\b(vancouver)\b/i },
      { name: 'Montreal', pattern: /\b(montreal)\b/i },
      { name: 'Ottawa', pattern: /\b(ottawa)\b/i },
    ],
  },
  {
    countryCode: 'FR',
    countryName: 'France',
    countryPattern: /\b(france)\b/i,
    cities: [
      { name: 'Paris', pattern: /\b(paris)\b/i },
      { name: 'Lyon', pattern: /\b(lyon)\b/i },
    ],
  },
  {
    countryCode: 'NL',
    countryName: 'Netherlands',
    countryPattern: /\b(netherlands|holland)\b/i,
    cities: [
      { name: 'Amsterdam', pattern: /\b(amsterdam)\b/i },
      { name: 'Rotterdam', pattern: /\b(rotterdam)\b/i },
    ],
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    countryPattern: /\b(australia)\b/i,
    cities: [
      { name: 'Sydney', pattern: /\b(sydney)\b/i },
      { name: 'Melbourne', pattern: /\b(melbourne)\b/i },
      { name: 'Brisbane', pattern: /\b(brisbane)\b/i },
    ],
  },
];

/**
 * Normalizes a raw location string into structured city, country, and remote indicators.
 *
 * Meets TASK-27.2 acceptance criteria:
 * - Maps recognized Arab and international cities and countries
 * - Detects remote / work-from-home indicators
 */
export function normalizeLocation(
  rawLocation: string | undefined | null,
  explicitRemote?: boolean,
): NormalizedLocation {
  if (!rawLocation) {
    return {
      location: '',
      isRemote: explicitRemote ?? false,
    };
  }

  // Clean HTML tags, control chars, and collapse whitespace
  const cleaned = stripControlCharacters(rawLocation)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Detect remote
  const isRemote = explicitRemote ?? REMOTE_REGEX.test(cleaned);

  let detectedCountry: string | undefined;
  let detectedCity: string | undefined;

  // 1. Scan for cities first (city match directly pinpoints country!)
  for (const item of LOCATION_TAXONOMY) {
    for (const city of item.cities) {
      if (city.pattern.test(cleaned)) {
        detectedCity = city.name;
        detectedCountry = item.countryCode;
        break;
      }
    }
    if (detectedCity) break;
  }

  // 2. If no city matched, check country patterns
  if (!detectedCountry) {
    for (const item of LOCATION_TAXONOMY) {
      if (item.countryPattern.test(cleaned)) {
        detectedCountry = item.countryCode;
        break;
      }
    }
  }

  return {
    location: cleaned,
    city: detectedCity,
    country: detectedCountry,
    isRemote,
  };
}

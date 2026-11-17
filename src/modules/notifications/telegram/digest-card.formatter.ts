/**
 * Digest Card Formatter (TASK-43.1)
 *
 * Formats job recommendation cards for Telegram digests:
 * - 5 jobs per page, max 4 pages (20 jobs total).
 * - Human-centric, hopeful, and encouraging phrasing instead of cold percentage numbers.
 * - Bilingual support for Arabic and English.
 * - Direct application hyperlinks with link preview suppression (`disable_web_page_preview: true`).
 */

export interface DigestCardJob {
  id?: string;
  title: string;
  company: string;
  applicationUrl?: string | null;
  url?: string | null;
  location?: string | null;
  country?: string | null;
  remoteScope?: 'WORLDWIDE' | 'REGION' | 'COUNTRY' | 'UNKNOWN' | string | null;
  experienceLevel?: 'JUNIOR' | 'MID' | 'SENIOR' | 'UNKNOWN' | string | null;
  score?: number | null;
  explanationAr?: string | null;
  explanationEn?: string | null;
}

export interface DigestPageOptions {
  language?: 'ar' | 'en';
  pageNumber?: number; // 1-based index (1..4)
  pageSize?: number; // default: 5
  maxJobs?: number; // default: 20
  totalAvailableMatches?: number;
}

export interface DigestPaginationResult {
  pagedJobs: DigestCardJob[];
  currentPage: number;
  totalPages: number;
  totalDigestJobs: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export const MAX_DIGEST_TOTAL_JOBS = 20;
export const DEFAULT_PAGE_SIZE = 5;

/**
 * Escapes special formatting characters for Telegram standard Markdown format.
 * Legacy Telegram Markdown uses `*`, `_`, `` ` ``, and `[` for markup.
 */
export function escapeTelegramMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([*_[\]`])/g, '\\$1');
}

/**
 * Sanitizes and validates URLs to strictly enforce secure HTTPS protocol.
 * Automatically upgrades HTTP URLs to HTTPS, validates format via URL parser,
 * and strips unsafe schemes (javascript:, file:, data:, ftp:, etc.).
 */
export function sanitizeApplicationUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Reject unsafe schemes
  if (/^(javascript|data|file|ftp):/i.test(trimmed)) {
    return '';
  }

  // Upgrade http:// to https:// or prepend https:// if protocol is omitted
  if (/^http:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^http:\/\//i, 'https://');
  } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Translates match strength into concise descriptive badges (Strong, Moderate, Weak)
 * without displaying mechanical numerical percentages or long cluttered text.
 */
export function formatMatchTone(score: number = 70, lang: 'ar' | 'en' = 'ar'): string {
  if (lang === 'en') {
    if (score >= 80) {
      return '🎯 Strong Match';
    }
    if (score >= 65) {
      return '⚖️ Moderate Match';
    }
    return '🌱 Weak Match';
  }

  // Concise Arabic match tiers: Strong, Moderate, Weak
  if (score >= 80) {
    return '🎯 تطابق قوي';
  }
  if (score >= 65) {
    return '⚖️ تطابق متوسط';
  }
  return '🌱 تطابق ضعيف';
}

/**
 * Formats seniority experience level in clean, human-friendly terms.
 */
export function formatExperienceLevel(
  level?: string | null,
  lang: 'ar' | 'en' = 'ar',
): string {
  const norm = level ? level.toUpperCase() : 'UNKNOWN';

  if (lang === 'en') {
    switch (norm) {
      case 'JUNIOR':
        return 'Entry-level (Junior)';
      case 'MID':
        return 'Mid-level';
      case 'SENIOR':
        return 'Senior / Lead';
      default:
        return 'Open to all experience levels';
    }
  }

  switch (norm) {
    case 'JUNIOR':
      return 'مستوى مبتدئ (Junior)';
    case 'MID':
      return 'مستوى متوسط (Mid-level)';
    case 'SENIOR':
      return 'مستوى متقدم / خبير (Senior)';
    default:
      return 'متاح لكافة مستويات الخبرة';
  }
}

/**
 * Formats remote work scope and location clearly.
 */
export function formatRemoteScope(
  scope?: string | null,
  country?: string | null,
  location?: string | null,
  lang: 'ar' | 'en' = 'ar',
): string {
  const norm = scope ? scope.toUpperCase() : 'UNKNOWN';
  const displayLocation = location || country || '';

  if (lang === 'en') {
    switch (norm) {
      case 'WORLDWIDE':
        return '🌍 Worldwide Remote';
      case 'REGION':
        return displayLocation
          ? `🌐 Regional Remote (${displayLocation})`
          : '🌐 Regional Remote';
      case 'COUNTRY':
        return displayLocation
          ? `📍 Remote (${displayLocation})`
          : '📍 In-country Remote';
      default:
        return displayLocation
          ? `🏢 On-site / Hybrid (${displayLocation})`
          : '🏢 On-site / Flexible';
    }
  }

  switch (norm) {
    case 'WORLDWIDE':
      return '🌍 عمل عن بُعد (عالمياً)';
    case 'REGION':
      return displayLocation
        ? `🌐 عمل عن بُعد إقليمياً (${displayLocation})`
        : '🌐 عمل عن بُعد إقليمياً';
    case 'COUNTRY':
      return displayLocation
        ? `📍 عمل عن بُعد محلي (${displayLocation})`
        : '📍 عمل عن بُعد محلي';
    default:
      return displayLocation
        ? `🏢 عمل حضوري / هجين (${displayLocation})`
        : '🏢 عمل حضوري أو مرن';
  }
}

/**
 * Slices an arbitrary list of candidate jobs to max 20 jobs total,
 * partitioned into pages of 5 jobs each.
 */
export function paginateDigestJobs(
  jobs: DigestCardJob[],
  pageNumber: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  maxJobs: number = MAX_DIGEST_TOTAL_JOBS,
): DigestPaginationResult {
  const cappedJobs = jobs.slice(0, maxJobs);
  const totalDigestJobs = cappedJobs.length;
  const totalPages = Math.max(1, Math.ceil(totalDigestJobs / pageSize));
  const currentPage = Math.min(Math.max(1, pageNumber), totalPages);

  const startIndex = (currentPage - 1) * pageSize;
  const pagedJobs = cappedJobs.slice(startIndex, startIndex + pageSize);

  return {
    pagedJobs,
    currentPage,
    totalPages,
    totalDigestJobs,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
  };
}

/**
 * Formats a single job card.
 */
export function formatJobCard(
  job: DigestCardJob,
  indexOnPage: number,
  lang: 'ar' | 'en' = 'ar',
): string {
  const safeTitle = escapeTelegramMarkdown(job.title || 'Untitled Role');
  const safeCompany = escapeTelegramMarkdown(job.company || 'Company');
  const targetUrl = sanitizeApplicationUrl(job.applicationUrl || job.url);

  const applyText = lang === 'en' ? 'Direct Application' : 'التقديم المباشر';
  const titleLink = targetUrl ? `[${safeTitle}](${targetUrl})` : `*${safeTitle}*`;
  const directLinkLine = targetUrl ? `🔗 [${applyText}](${targetUrl})` : '';

  const locationPart = job.location || job.country || '';
  const safeLocation = escapeTelegramMarkdown(locationPart);
  const companyAndLocation = safeLocation
    ? `🏢 *${safeCompany}* | 📍 ${safeLocation}`
    : `🏢 *${safeCompany}*`;

  const remoteLine = formatRemoteScope(job.remoteScope, job.country, job.location, lang);
  const experienceLine = formatExperienceLevel(job.experienceLevel, lang);
  const matchToneLine = formatMatchTone(job.score ?? 70, lang);

  const lines = [
    `*${indexOnPage}.* 💼 ${titleLink}`,
    companyAndLocation,
    `🌐 ${escapeTelegramMarkdown(remoteLine)}`,
    `📊 ${escapeTelegramMarkdown(experienceLine)}`,
    `${escapeTelegramMarkdown(matchToneLine)}`,
  ];

  if (directLinkLine) {
    lines.push(directLinkLine);
  }

  return lines.join('\n');
}

/**
 * Formats a full page of digest cards with bilingual headers, footers, and page counters.
 */
export function formatDigestPageMessage(
  jobs: DigestCardJob[],
  options?: DigestPageOptions,
): string {
  const lang = options?.language || 'ar';
  const pageNumber = options?.pageNumber || 1;
  const pageSize = options?.pageSize || DEFAULT_PAGE_SIZE;
  const maxJobs = options?.maxJobs || MAX_DIGEST_TOTAL_JOBS;

  const pagination = paginateDigestJobs(jobs, pageNumber, pageSize, maxJobs);

  if (pagination.totalDigestJobs === 0) {
    if (lang === 'en') {
      return (
        `🔍 **No matching opportunities right now**\n\n` +
        `We are actively tracking new openings that suit your domain and will notify you as soon as fresh opportunities arrive.\n\n` +
        `💡 You can review or adjust your preferences anytime via /settings`
      );
    }
    return (
      `🔍 **لا توجد وظائف مطابقة لتفضيلاتك حالياً**\n\n` +
      `نواصل البحث باستمرار في كبرى المنصات وسنرسل لك أحدث الفرص فور رصدها.\n\n` +
      `💡 يمكنك مراجعة أو توسيع نطاق تفضيلاتك في أي وقت عبر /settings`
    );
  }

  // Header
  const headerText =
    lang === 'en'
      ? `✨ **Your Handpicked Job Opportunities**\n` +
        `Here are promising roles tailored for your profile and career growth:\n` +
        `────────────────────\n\n`
      : `✨ **فرص عمل واعدة مختارة لك بعناية**\n` +
        `إليك مجموعة مميزة من الفرص التي تناسب تطلعاتك ومسارك المهني:\n` +
        `────────────────────\n\n`;

  // Cards
  const cardsText = pagination.pagedJobs
    .map((job, idx) => {
      const overallIndex = (pagination.currentPage - 1) * pageSize + (idx + 1);
      return formatJobCard(job, overallIndex, lang);
    })
    .join('\n\n────────────────────\n\n');

  // Footer
  const footerText =
    lang === 'en'
      ? `\n\n────────────────────\n` +
        `📄 **Page ${pagination.currentPage} of ${pagination.totalPages}** • Showing ${pagination.pagedJobs.length} opportunities\n` +
        `💡 Click the title or direct link to apply. Use /jobs to explore the full shared database.`
      : `\n\n────────────────────\n` +
        `📄 **الصفحة ${pagination.currentPage} من ${pagination.totalPages}** • تم استعراض ${pagination.pagedJobs.length} فرص مميزة\n` +
        `💡 اضغط على عنوان الوظيفة للتقديم المباشر. يمكنك دائماً استكشاف كافة الفرص المتاحة عبر الأمر /jobs`;

  return `${headerText}${cardsText}${footerText}`;
}

/**
 * Standard Telegram send options for digests (disables link previews to keep chat clean).
 */
export function getTelegramDigestSendOptions(): {
  parse_mode: 'Markdown';
  disable_web_page_preview: boolean;
  link_preview_options: { is_disabled: boolean };
} {
  return {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    link_preview_options: {
      is_disabled: true,
    },
  };
}


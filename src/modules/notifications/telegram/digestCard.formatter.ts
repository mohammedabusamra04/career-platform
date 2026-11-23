/**
 * Digest Card Formatter (TASK-43.1) - DeployMe Identity
 *
 * Formats job recommendation cards for Telegram digests:
 * - 5 jobs per page, max 4 pages (20 jobs total).
 * - Developer-centric, witty, and encouraging phrasing (DeployMe persona).
 * - Bilingual support for Arabic (primary) and English.
 * - Direct application hyperlinks with link preview suppression (`disable_web_page_preview: true`).
 */

import { JobSourceRegistry } from '../../jobs/sources/jobSource.registry.js';
import logger from '../../../shared/utils/logger.js';

export interface DigestCardJob {
  id?: string;
  title: string;
  company: string;
  source?: string | null;
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
  } catch (err: unknown) {
    logger.debug(
      `[DigestCardFormatter] Invalid application URL ${trimmed}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
  return '';
}

/**
 * Translates match strength into concise developer-friendly badges
 * without displaying mechanical numerical percentages.
 */
export function formatMatchTone(score: number = 70, lang: 'ar' | 'en' = 'ar'): string {
  if (lang === 'en') {
    if (score >= 80) {
      return '🎯 High Stack Fit';
    }
    if (score >= 65) {
      return '⚡ Solid Fit';
    }
    return '🌱 Partial Fit';
  }

  if (score >= 80) {
    return '🎯 تطابق قوي مع الـ Stack';
  }
  if (score >= 65) {
    return '⚡ تطابق جيد';
  }
  return '🌱 تطابق مبدئي';
}

/**
 * Formats seniority experience level in clean, dev-friendly terms.
 */
export function formatExperienceLevel(
  level?: string | null,
  lang: 'ar' | 'en' = 'ar',
): string {
  const norm = level ? level.toUpperCase() : 'UNKNOWN';

  if (lang === 'en') {
    switch (norm) {
      case 'JUNIOR':
        return 'Junior / Entry-Level';
      case 'MID':
        return 'Mid-Level';
      case 'SENIOR':
        return 'Senior / Tech Lead';
      default:
        return 'All Experience Levels';
    }
  }

  switch (norm) {
    case 'JUNIOR':
      return 'مستوى مبتدئ (Junior)';
    case 'MID':
      return 'مستوى متوسط (Mid-Level)';
    case 'SENIOR':
      return 'مستوى متقدم / خبير (Senior)';
    default:
      return 'مفتوح لكل المستويات';
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
        return '🌍 Remote (Worldwide)';
      case 'REGION':
        return displayLocation
          ? `🌐 Regional Remote (${displayLocation})`
          : '🌐 Regional Remote';
      case 'COUNTRY':
        return displayLocation
          ? `📍 Remote (${displayLocation})`
          : '📍 In-Country Remote';
      default:
        return displayLocation
          ? `🏢 On-site / Hybrid (${displayLocation})`
          : '🏢 On-site / Flexible';
    }
  }

  switch (norm) {
    case 'WORLDWIDE':
      return '🌍 عن بُعد (عالمي - Remote)';
    case 'REGION':
      return displayLocation
        ? `🌐 عن بُعد إقليمياً (${displayLocation})`
        : '🌐 عن بُعد إقليمياً';
    case 'COUNTRY':
      return displayLocation
        ? `📍 عن بُعد محلياً (${displayLocation})`
        : '📍 عن بُعد محلياً';
    default:
      return displayLocation
        ? `🏢 حضوري / هجين (${displayLocation})`
        : '🏢 حضوري أو مرن';
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

  const applyText = lang === 'en' ? 'Apply Now' : 'تقديم مباشر';
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
  const platformBadge = JobSourceRegistry.formatSourceBadge(job.source, lang, job.applicationUrl || job.url);
  const platformLine = `🌐 ${escapeTelegramMarkdown(platformBadge)}`;

  const lines = [
    `*${indexOnPage}.* 💻 ${titleLink}`,
    companyAndLocation,
    platformLine,
    `${escapeTelegramMarkdown(remoteLine)}`,
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
        `📡 *No matching builds right now*\n\n` +
        `Our pipeline is scanning the market 24/7. The moment a role matches your stack, we'll ping you right away.\n\n` +
        `⚙️ Want to broaden your filters? Adjust your stack anytime via /settings`
      );
    }
    return (
      `📡 *ما في فرص مطابقة حالياً على الرادار*\n\n` +
      `الـ Pipeline تبعنا شغال 24/7 وبيراقب السوق؛ أول ما تنزل فرصة بتفصّل على الـ Stack تبعك رح نعملك Ping فوراً.\n\n` +
      `⚙️ حابب توسع نطاق البحث أو تعدل مهاراتك؟ اضبط إعداداتك من /settings`
    );
  }

  // Header
  const headerText =
    lang === 'en'
      ? `📬 *DeployMe Daily Build*\n` +
        `Top stack-matched roles ready for your next career deploy:\n` +
        `────────────────────\n\n`
      : `📬 *تجميعة DeployMe (ديبلوي مي)*\n` +
        `هاي أنسب الفرص اللي لقطناها وبتطابق الـ Stack تبعك — جاهز تطلع Production؟\n` +
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
        `📄 *Page ${pagination.currentPage} of ${pagination.totalPages}* • Showing ${pagination.pagedJobs.length} roles\n` +
        `⚡ Tap any role title to apply directly, or browse the full feed via /jobs`
      : `\n\n────────────────────\n` +
        `📄 *صفحة ${pagination.currentPage} من ${pagination.totalPages}* • معروض ${pagination.pagedJobs.length} فرص\n` +
        `⚡ اضغط على اسم الوظيفة للتقديم المباشر، أو تصفح كل الفرص المتاحة عبر /jobs`;

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
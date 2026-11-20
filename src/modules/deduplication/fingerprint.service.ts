import { createHash } from 'node:crypto';

import type { Job } from '../jobs/job.types.js';
import { TRACKING_QUERY_PARAMS } from '../jobs/job.sanitizer.js';
import logger from '../../shared/utils/logger.js';

/**
 * TASK-28: Two-Tier Deduplication & Rich Data Merger (#46)
 * - TASK-28.1: Level 1 SHA-256 Composite Fingerprint Engine (#86)
 * - TASK-28.2: Level 2 Cross-Source Semantic Fingerprint Engine (#87)
 *
 * Implements:
 * 1. Level 1: Deterministic composite hashing (deduplicationKey)
 *    Formula: SHA256(canonical(title) + "|" + canonical(company) + "|" + cleanUrl(url))
 * 2. Level 2: Cross-source semantic hashing (semanticKey)
 *    Formula: SHA256(canonicalSemanticTitle(title) + "|" + canonicalCompany(company))
 */
export class FingerprintService {
  /**
   * Generates the primary composite fingerprint (Level 1) for a job posting.
   * Matches identical listings from the same source/URL.
   *
   * Formula: SHA256(canonical(title) + "|" + canonical(company) + "|" + cleanUrl(url))
   */
  generate(job: Partial<Job>): string {
    const canonicalTitle = this.canonicalizeTitle(job.title || '');
    const canonicalCompany = this.canonicalizeCompany(job.company || '');
    const canonicalUrl = this.canonicalizeUrl(job.applicationUrl || job.url || '');

    const data = `${canonicalTitle}|${canonicalCompany}|${canonicalUrl}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Explicit semantic alias for generate() representing the PostgreSQL Job.deduplicationKey.
   */
  generateDeduplicationKey(job: Partial<Job>): string {
    return this.generate(job);
  }

  /**
   * Generates a semantic fingerprint (Level 2) based on canonical title variants and company.
   * Enables consolidating duplicate listings posted across different job boards (e.g. Adzuna & Remotive).
   *
   * Formula: SHA256(canonicalSemanticTitle(title) + "|" + canonicalCompany(company))
   */
  generateSemanticFingerprint(job: Partial<Job>): string {
    const canonicalTitle = this.canonicalizeSemanticTitle(job.title || '');
    const canonicalCompany = this.canonicalizeCompany(job.company || '');

    const data = `${canonicalTitle}|${canonicalCompany}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generates a URL fingerprint based on the canonicalized URL.
   */
  generateUrlFingerprint(rawUrl: string): string {
    const canonicalUrl = this.canonicalizeUrl(rawUrl);
    return createHash('sha256').update(canonicalUrl).digest('hex');
  }

  /**
   * Canonicalizes a URL by:
   * 1. Stripping tracking parameters (UTM, click trackers, analytics tags)
   * 2. Lowercasing entire URL (protocol, hostname, pathname)
   * 3. Removing 'www.', default ports, trailing slashes, and hash fragments
   * 4. Sorting remaining functional query parameters deterministically
   */
  canonicalizeUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(rawUrl.trim());

      // Strip known tracking query params
      const keysToDelete: string[] = [];
      for (const key of parsed.searchParams.keys()) {
        const lowerKey = key.toLowerCase();
        if (
          TRACKING_QUERY_PARAMS.has(lowerKey) ||
          lowerKey === 'trk' ||
          lowerKey === 'spjobid' ||
          lowerKey === 'source' ||
          lowerKey === 'origin'
        ) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        parsed.searchParams.delete(key);
      }

      // Remove fragment / hash
      parsed.hash = '';

      // Normalize hostname and protocol
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const protocol = parsed.protocol.toLowerCase();

      // Normalize pathname: lowercase and remove trailing slash unless root
      let pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      if (!pathname) {
        pathname = '/';
      }

      // Sort remaining functional query parameters deterministically
      const searchParams = Array.from(parsed.searchParams.entries()).sort(
        ([aKey, aVal], [bKey, bVal]) => {
          const comp = aKey.toLowerCase().localeCompare(bKey.toLowerCase());
          return comp !== 0 ? comp : aVal.localeCompare(bVal);
        },
      );

      const search = searchParams
        .map(([k, v]) => `${encodeURIComponent(k.toLowerCase())}=${encodeURIComponent(v)}`)
        .join('&');

      return `${protocol}//${host}${pathname}${search ? `?${search}` : ''}`;
    } catch (err: unknown) {
      logger.debug(`[FingerprintService] URL canonicalization fallback for ${rawUrl}: ${(err as Error).message}`);
      return rawUrl.trim().toLowerCase().replace(/\/+$/, '');
    }
  }

  /**
   * Canonicalizes a job title for Level 1 exact composite matching:
   * 1. Converts to lowercase
   * 2. Removes noise tags like (m/f/d), (Remote), [Urgent], (عن بعد), etc.
   * 3. Removes special characters and symbols while preserving unicode alphanumeric text
   * 4. Collapses whitespace
   */
  canonicalizeTitle(title: string): string {
    if (!title || typeof title !== 'string') {
      return '';
    }

    return title
      .toLowerCase()
      // Remove common noise tags (English & Arabic)
      .replace(
        /\((?:m\/f\/d|m\/w\/d|w\/m\/d|f\/m\/d|remote|hybrid|onsite|urgent|عن\s*بعد|عمل\s*عن\s*بعد|دوام\s*كامل|دوام\s*جزئي)\)/gi,
        ' ',
      )
      .replace(
        /\[(?:remote|hybrid|onsite|urgent|full-time|part-time|عن\s*بعد|عمل\s*عن\s*بعد|دوام\s*كامل|دوام\s*جزئي)\]/gi,
        ' ',
      )
      .replace(/[-_–—|#/]/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Canonicalizes a job title for Level 2 cross-source semantic matching (TASK-28.2).
   * Maps common title variations, abbreviations, and technical role synonyms to a unified form.
   *
   * Examples:
   * - "Sr. Back End Engineer" -> "senior backend engineer"
   * - "Senior Backend Engineer" -> "senior backend engineer"
   * - "Full-Stack Developer" -> "full stack developer"
   * - "Fullstack Developer" -> "full stack developer"
   */
  canonicalizeSemanticTitle(title: string): string {
    if (!title || typeof title !== 'string') {
      return '';
    }

    let normalized = title.toLowerCase();

    // 1. Remove noise tags in brackets or parentheses
    normalized = normalized
      .replace(
        /\((?:m\/f\/d|m\/w\/d|w\/m\/d|f\/m\/d|remote|hybrid|onsite|urgent|عن\s*بعد|عمل\s*عن\s*بعد|دوام\s*كامل|دوام\s*جزئي)\)/gi,
        ' ',
      )
      .replace(
        /\[(?:remote|hybrid|onsite|urgent|full-time|part-time|عن\s*بعد|عمل\s*عن\s*بعد|دوام\s*كامل|دوام\s*جزئي)\]/gi,
        ' ',
      );

    // 2. Canonicalize seniority and level prefixes / abbreviations
    normalized = normalized
      .replace(/\b(?:sr\.?|snr\.?|senior)\b/gi, 'senior')
      .replace(/\b(?:jr\.?|jnr\.?|junior)\b/gi, 'junior')
      .replace(/\b(?:mid[\s-]?level)\b/gi, 'mid');

    // 3. Canonicalize specialization and domain title variants
    normalized = normalized
      .replace(/\b(?:back[\s-]?end)\b/gi, 'backend')
      .replace(/\b(?:front[\s-]?end)\b/gi, 'frontend')
      .replace(/\b(?:full[\s-]?stack|fullstack)\b/gi, 'full stack')
      .replace(/\b(?:dev[\s-]?ops)\b/gi, 'devops')
      .replace(/\b(?:quality[\s-]?assurance|q\.?a\.?)\b/gi, 'qa')
      .replace(/\b(?:sde[\s-]?[i|1|2|3]?)\b/gi, 'software engineer')
      .replace(/\b(?:software\s*development\s*engineer)\b/gi, 'software engineer')
      .replace(/\b(?:machine[\s-]?learning|ml)\b/gi, 'machine learning')
      .replace(/\b(?:artificial[\s-]?intelligence|ai)\b/gi, 'ai');

    // 4. Canonicalize common framework names
    normalized = normalized
      .replace(/\b(?:node(?:\.js|js)?)\b/gi, 'node')
      .replace(/\b(?:react(?:\.js|js)?)\b/gi, 'react')
      .replace(/\b(?:vue(?:\.js|js)?)\b/gi, 'vue')
      .replace(/\b(?:angular(?:\.js|js)?)\b/gi, 'angular')
      .replace(/\b(?:next(?:\.js|js)?)\b/gi, 'next');

    // 5. Arabic role and level normalization
    normalized = normalized
      .replace(/(?:^|\s)(?:سينيور|خبير|أول|اول)(?:\s|$)/gi, ' خبير ')
      .replace(/(?:^|\s)(?:جونيور|مبتدئ)(?:\s|$)/gi, ' مبتدئ ')
      .replace(/(?:^|\s)(?:واجهات\s*خلفية|باك\s*اند|باكيند)(?:\s|$)/gi, ' خلفي ')
      .replace(/(?:^|\s)(?:واجهات\s*أمامية|واجهات\s*امامية|فرونت\s*اند|فرونتيند)(?:\s|$)/gi, ' أمامي ')
      .replace(/(?:^|\s)(?:فل\s*ستاك|شامل)(?:\s|$)/gi, ' شامل ');

    // 6. Clean punctuation, symbols, and collapse whitespace
    return normalized
      .replace(/[-_–—|#/]/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Backward-compatible alias for canonicalizeTitle.
   */
  normalizeTitle(title: string): string {
    return this.canonicalizeTitle(title);
  }

  /**
   * Canonicalizes a company name by:
   * 1. Converting to lowercase
   * 2. Stripping legal / corporate entity suffixes in English and Arabic
   * 3. Removing special characters and symbols while preserving unicode alphanumeric text
   * 4. Collapsing whitespace
   */
  canonicalizeCompany(company: string): string {
    if (!company || typeof company !== 'string') {
      return '';
    }

    // Strip corporate suffixes iteratively to catch multiple suffixes (e.g. "شركة ... ذ.م.م")
    let cleaned = company.toLowerCase();

    // English corporate suffixes
    cleaned = cleaned.replace(
      /\b(?:inc\.?|llc\.?|ltd\.?|limited|corp\.?|corporation|gmbh|co\.?|sae|fze|plc)\b/gi,
      ' ',
    );

    // Arabic corporate prefixes & suffixes
    cleaned = cleaned.replace(
      /(?:^|\s)(?:شركة|ش[\s.]*م[\s.]*م|ذ[\s.]*م[\s.]*م|مساهمة|القابضة|المحدودة)(?:\s|$)/gi,
      ' ',
    );
    cleaned = cleaned.replace(
      /(?:^|\s)(?:شركة|ش[\s.]*م[\s.]*م|ذ[\s.]*م[\s.]*م|مساهمة|القابضة|المحدودة)(?:\s|$)/gi,
      ' ',
    );

    return cleaned
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Backward-compatible alias for canonicalizeCompany.
   */
  normalizeCompany(company: string): string {
    return this.canonicalizeCompany(company);
  }
}

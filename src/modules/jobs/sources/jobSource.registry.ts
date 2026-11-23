import type { JobSource, SourceDisplayName } from './jobSource.interface.js';
import logger from '../../../shared/utils/logger.js';

export class JobSourceRegistry {
  private static readonly metadataRegistry = new Map<string, SourceDisplayName>([
    ['linkedin', { ar: 'لينكدإن (LinkedIn)', en: 'LinkedIn' }],
    ['firecrawl_linkedin', { ar: 'لينكدإن (LinkedIn)', en: 'LinkedIn' }],
    ['tanqeeb', { ar: 'تنقيب (Tanqeeb)', en: 'Tanqeeb' }],
    ['mostaqel', { ar: 'مستقل (Mostaql)', en: 'Mostaql' }],
    ['mostaql', { ar: 'مستقل (Mostaql)', en: 'Mostaql' }],
    ['baeed', { ar: 'بعيد (Baeed)', en: 'Baeed' }],
    ['wuzzuf', { ar: 'وظف (Wuzzuf)', en: 'Wuzzuf' }],
    ['forasna', { ar: 'فرصنا (Forasna)', en: 'Forasna' }],
    ['bayt', { ar: 'بيت.كوم (Bayt)', en: 'Bayt' }],
    ['adzuna', { ar: 'Adzuna', en: 'Adzuna' }],
    ['jooble', { ar: 'Jooble', en: 'Jooble' }],
    ['arbeitnow', { ar: 'Arbeitnow', en: 'Arbeitnow' }],
    ['remotive', { ar: 'Remotive', en: 'Remotive' }],
    ['we_work_remotely', { ar: 'WeWorkRemotely', en: 'WeWorkRemotely' }],
    ['weworkremotely', { ar: 'WeWorkRemotely', en: 'WeWorkRemotely' }],
    ['naukrigulf', { ar: 'Naukrigulf', en: 'Naukrigulf' }],
  ]);

  /**
   * Registers a source instance and records its localized display metadata.
   */
  static registerSource(source: JobSource): void {
    if (source.displayName) {
      this.metadataRegistry.set(source.type.toLowerCase(), source.displayName);
    }
  }

  /**
   * Directly registers display metadata for a source type.
   */
  static registerMetadata(sourceType: string, displayName: SourceDisplayName): void {
    this.metadataRegistry.set(sourceType.toLowerCase(), displayName);
  }

  /**
   * Resolves the localized display name for any job source without hardcoded switch/if-else.
   * Completely open for extension: any new class simply declares its displayName.
   * Also verifies URL authenticity: if marked as linkedin but url is from a third-party aggregator
   * (e.g. career.io, greenhouse.io), it resolves the true platform domain rather than falsely claiming LinkedIn.
   */
  static formatSourceBadge(
    sourceType?: string | null,
    lang: 'ar' | 'en' = 'ar',
    jobUrl?: string | null,
  ): string {
    const isAr = lang === 'ar';
    if (!sourceType) {
      return isAr ? 'المنصة: تقديم مباشر' : 'Platform: Direct';
    }

    const key = sourceType.toLowerCase();

    // Verify authenticity for LinkedIn: if url is not a linkedin.com link, extract actual platform
    if (key === 'linkedin' && jobUrl) {
      try {
        const parsed = new URL(jobUrl);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (!host.includes('linkedin.com')) {
          const parts = host.split('.');
          const domainName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          const capitalized = domainName.charAt(0).toUpperCase() + domainName.slice(1);
          return isAr ? `المنصة: ${capitalized}` : `Platform: ${capitalized}`;
        }
      } catch (err: unknown) {
        logger.debug(
          `[JobSourceRegistry] Could not parse job URL: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const meta = this.metadataRegistry.get(key);
    if (meta) {
      const name = isAr ? meta.ar : meta.en;
      return isAr ? `المنصة: ${name}` : `Platform: ${name}`;
    }

    // Dynamic fallback for any arbitrary new source: capitalize automatically
    const cleaned = sourceType.replace(/[_-]+/g, ' ');
    const formatted = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return isAr ? `المنصة: ${formatted}` : `Platform: ${formatted}`;
  }

  private readonly sources: JobSource[] = [];

  register(source: JobSource): void {
    this.sources.push(source);
    JobSourceRegistry.registerSource(source);
  }

  getSources(): JobSource[] {
    return [...this.sources];
  }
}

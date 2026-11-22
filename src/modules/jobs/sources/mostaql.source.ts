import * as cheerio from 'cheerio';

import type { Job, JobSearchQuery } from '../job.types.js';
import { JobSourceType } from '../job.types.js';
import type { JobSource } from './job-source.interface.js';
import { ExperienceLevel, WorkType } from '../../../shared/types/job.js';
import { negativeExclusionMatcher } from '../classifier/negative-exclusion.matcher.js';
import logger from '../../../shared/utils/logger.js';

interface CandidateProject {
  title: string;
  url: string;
  briefDescription: string;
  experienceLevel?: ExperienceLevel;
}

/**
 * Scrapes Mostaql freelance projects.
 * Enforces category scoping, non-technical exclusion, closed project filtering,
 * and concurrency-bounded page enrichment for real skill extraction.
 */
export class MostaqlJobSource implements JobSource {
  public readonly type = JobSourceType.MOSTAQEL;
  public readonly displayName = { ar: 'مستقل (Mostaql)', en: 'Mostaql' };

  private static readonly MAX_CANDIDATES = 15;
  private static readonly ENRICHMENT_CONCURRENCY = 4;
  private static readonly ENRICHMENT_TIMEOUT_MS = 4000;

  async fetchJobs(query?: JobSearchQuery): Promise<Job[]> {
    const url = this.buildSearchUrl(query);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const candidates = this.parseCandidates(html, query);

      if (candidates.length === 0) {
        return [];
      }

      // Enrich candidate projects with bounded concurrency (4) and short 4s timeout
      const enrichedJobs = await this.enrichCandidates(candidates);
      return enrichedJobs;
    } catch (err: unknown) {
      logger.warn(`[MostaqlJobSource] Fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Scopes Mostaql category and keyword based on search query.
   * UI/UX queries use category=design, technical roles use category=development.
   */
  public buildSearchUrl(query?: JobSearchQuery): string {
    const isUiUx =
      Boolean(query?.jobTitle) &&
      /\b(?:ui|ux|ui\/ux|design|figma)\b|تصميم|واجهات/i.test(query!.jobTitle);
    const category = isUiUx ? 'design' : 'development';
    const keyword = query?.jobTitle?.trim() || '';

    const params = new URLSearchParams();
    params.set('category', category);

    // Only inject keyword if it is not a generic category term
    if (keyword && !/^(?:برمجة|تطوير|developer|software)$/i.test(keyword)) {
      params.set('keyword', keyword);
    }

    return `https://mostaql.com/projects?${params.toString()}`;
  }

  private parseCandidates(html: string, query?: JobSearchQuery): CandidateProject[] {
    const $ = cheerio.load(html);
    const candidates: CandidateProject[] = [];

    $('.project-card, .project-row, li.media, tr.project-row').each((_, el) => {
      if (candidates.length >= MostaqlJobSource.MAX_CANDIDATES) {
        return;
      }

      const titleEl = $(el)
        .find('h2 a, .project-title a, a.o-card__title, h2.card--title a')
        .first();
      const title = titleEl.text().trim();
      let link = titleEl.attr('href');
      if (link && !link.startsWith('http')) {
        link = `https://mostaql.com${link}`;
      }

      if (!title || !link) {
        return;
      }

      // 1. Filter out clearly non-technical freelance projects (translation, voice-over, content writing, etc.)
      const exclusion = negativeExclusionMatcher.evaluate(title);
      if (exclusion.isExcluded) {
        return;
      }

      // 2. Filter out closed/completed projects from card badges/status
      const cardStatus = $(el)
        .find('.project__status, .badge, .status, .label, .project-meta .status')
        .text()
        .trim();
      if (/مغلق|مكتمل|قيد التنفيذ|ملغي|منتهي/i.test(cardStatus)) {
        return;
      }

      const briefDescription =
        $(el)
          .find('.project-brief, .project__brief, .o-card__description, .card--desc, p')
          .first()
          .text()
          .trim()
          .slice(0, 400) || title;

      candidates.push({
        title,
        url: link,
        briefDescription,
        experienceLevel: query?.experienceLevel || ExperienceLevel.MID,
      });
    });

    return candidates;
  }

  private async enrichCandidates(candidates: CandidateProject[]): Promise<Job[]> {
    const results: Array<Job | null> = new Array(candidates.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < candidates.length) {
        const i = index++;
        results[i] = await this.enrichProject(candidates[i]);
      }
    };

    const workerCount = Math.min(MostaqlJobSource.ENRICHMENT_CONCURRENCY, candidates.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results.filter((job): job is Job => job !== null);
  }

  private async enrichProject(candidate: CandidateProject): Promise<Job | null> {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(MostaqlJobSource.ENRICHMENT_TIMEOUT_MS),
      });

      if (!response.ok) {
        return this.createJobFromCandidate(candidate, []);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Verify open status on project detail page
      const pageStatus = $(
        '.project-meta, .meta-table, .project-status, .badge, .project__status, .status',
      ).text();
      if (/مغلق|مكتمل|قيد التنفيذ|ملغي|منتهي/i.test(pageStatus)) {
        return null; // Discard closed / finished project
      }

      // Extract full description
      const fullDescription = $(
        '#project-details, .project__brief, .project-details, .card--desc, .o-card__description, .project-brief',
      )
        .first()
        .text()
        .trim();

      // Extract real skill tags from project page (never inject query.skills)
      const skills: string[] = [];
      $('a[href*="/skills/"], .skills a, ul.tags a, .tag, a.skills__item').each((_, sEl) => {
        const tag = $(sEl).text().trim();
        if (tag && tag.length < 50 && !skills.includes(tag)) {
          skills.push(tag);
        }
      });

      return this.createJobFromCandidate(
        candidate,
        skills,
        fullDescription || candidate.briefDescription,
      );
    } catch {
      // Gracefully fall back to candidate card data if detail fetch times out or fails
      return this.createJobFromCandidate(candidate, []);
    }
  }

  private createJobFromCandidate(
    candidate: CandidateProject,
    skills: string[],
    description?: string,
  ): Job {
    return {
      title: candidate.title,
      company: 'مستقل (مشروع فريلانس)',
      source: JobSourceType.MOSTAQEL,
      applicationUrl: candidate.url,
      url: candidate.url,
      location: 'عن بعد (Freelance)',
      country: 'الشرق الأوسط / عن بعد',
      remote: true,
      workType: WorkType.REMOTE,
      experienceLevel: candidate.experienceLevel || ExperienceLevel.MID,
      description: description || candidate.briefDescription,
      skills, // Strictly real extracted skills or [] (never query.skills)
      publicationDate: new Date(),
      publishedAt: new Date(),
      scrapedAt: new Date(),
    };
  }
}

import ms from 'ms';
import type { JobSearchQuery, JobSourceType, RawJobListing } from '../job.types.js';
import type { JobSource, SourceDisplayName } from './jobSource.interface.js';
import logger from '../../../shared/utils/logger.js';

export interface BaseFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export abstract class BaseJobSource implements JobSource {
  public abstract readonly type: JobSourceType;
  public abstract readonly displayName?: SourceDisplayName;

  protected readonly defaultTimeoutMs: number = ms('8s');

  protected get defaultHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/html, application/xml, text/xml, */*;q=0.9',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    };
  }

  public abstract fetchJobs(query?: JobSearchQuery): Promise<RawJobListing[]>;

  /**
   * Encapsulates safe HTTP fetching with timeout (using ms), default headers,
   * and structured error logging (no silent swallowed errors).
   */
  protected async fetchWithTimeout(
    url: string,
    options: BaseFetchOptions = {},
  ): Promise<Response | null> {
    const timeout = options.timeoutMs ?? this.defaultTimeoutMs;
    const headers = {
      ...this.defaultHeaders,
      ...(options.headers as Record<string, string> | undefined),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        logger.warn(
          `[${this.type}] HTTP ${response.status} ${response.statusText} for URL: ${url}`,
        );
        return response;
      }

      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[${this.type}] Request failed for ${url} (${ms(timeout)} timeout): ${message}`);
      return null;
    }
  }
}


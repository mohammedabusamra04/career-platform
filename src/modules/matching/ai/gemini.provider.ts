import { GoogleGenAI } from '@google/genai';
import ms from 'ms';
import env from '../../../config/env.js';
import logger from '../../../shared/utils/logger.js';
import type { AIProvider } from './ai-provider.interface.js';
import { AIProviderError } from './ai-provider.error.js';
import type {
  JobAnalysisResult,
  MatchingInput,
  MatchingResult,
} from '../matching.types.js';
import type { Job } from '../../jobs/job.types.js';
import { WorkType } from '../../../shared/types/job.js';

/**
 * Simple token-bucket rate limiter.
 *
 * Spaces out requests so we never exceed `maxPerMinute`, instead of
 * bursting through the whole daily quota in the first few seconds and
 * then tripping a 429 for the rest of the run.
 */
class RateLimiter {
  private readonly intervalMs: number;
  private nextAvailableAt = 0;

  constructor(maxPerMinute: number) {
    this.intervalMs = ms('60s') / maxPerMinute;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const waitUntil = Math.max(now, this.nextAvailableAt);
    const waitMs = waitUntil - now;

    this.nextAvailableAt = waitUntil + this.intervalMs;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Per-(key,model) circuit state. */
interface CircuitState {
  unavailableUntil: number;
  reason: string | null;
}

/** One usable (API key, model) combination in the fallback chain. */
interface Slot {
  /** Index into env.geminiApiKeys — used only for logging/circuit keys, never logged raw. */
  keyIndex: number;
  client: GoogleGenAI;
  model: string;
}

export class GeminiProvider implements AIProvider {
  /**
   * Ordered model list, most capable first. Combined with every API key
   * to build the full fallback chain (see `slots`).
   *
   * Flash-Lite models have the most generous free-tier RPM/RPD, so they
   * anchor the chain as the workhorse fallback; Flash is tried first for
   * quality.
   */
  private readonly modelNames: string[] = [
    'gemini-3.6-flash',
    'gemini-3.8-flash',
  ];

  /**
   * Every (API key × model) combination, in fallback order: all models
   * on key 0 first, then all models on key 1, etc. Free-tier daily quota
   * is tracked per project (key) AND per model by Google, so a slot here
   * is the smallest unit that can be individually exhausted.
   *
   * Rotating keys this way means one key running out mid-day doesn't
   * stop the pipeline — it just moves down the list.
   */
  private readonly slots: Slot[];

  /**
   * Requests-per-minute cap PER API KEY (each key has its own RPM quota).
   * Kept conservative (below the published free-tier RPM) so we don't
   * rely on retries to stay under the limit.
   */
  private readonly rateLimiters: RateLimiter[];

  /**
   * Circuit-breaker state, per slot (keyed by `${keyIndex}:${model}`).
   *
   * NOTE: assumes ONE shared provider instance across the pipeline.
   * If a provider is constructed per job, move this state to Redis or a
   * module-level global, otherwise it will not be shared.
   */
  private readonly circuits = new Map<string, CircuitState>();

  /** Cooldown after a sustained 503 (transient outage). */
  private static readonly TRANSIENT_COOLDOWN_MS = ms('90s');

  /** Cooldown after daily quota exhaustion (resets on a daily boundary). */
  private static readonly DAILY_QUOTA_COOLDOWN_MS = ms('12h');

  constructor(apiKeysInput?: string[]) {
    let apiKeys: string[];

    if (apiKeysInput !== undefined) {
      apiKeys = apiKeysInput;
    } else {
      const configured =
        env.geminiApiKeys.length > 0
          ? env.geminiApiKeys
          : env.geminiApiKey
            ? [env.geminiApiKey]
            : [];

      if (
        (configured.length === 0 || !configured[0]) &&
        (process.env.NODE_ENV === 'test' || process.env.VITEST)
      ) {
        apiKeys = ['test-api-key'];
      } else {
        apiKeys = configured;
      }
    }

    if (apiKeys.length === 0 || !apiKeys[0]) {
      throw new AIProviderError('No Gemini API key configured');
    }

    const clients = apiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));

    this.rateLimiters = clients.map(() => new RateLimiter(8));

    this.slots = [];

    for (let keyIndex = 0; keyIndex < clients.length; keyIndex++) {
      for (const model of this.modelNames) {
        this.slots.push({
          keyIndex,
          client: clients[keyIndex],
          model,
        });
      }
    }

    if (apiKeys.length > 1) {
      logger.info(
        `Gemini provider initialised with ${apiKeys.length} API keys x ${this.modelNames.length} models (${this.slots.length} fallback slots).`,
      );
    }
  }

  async match(input: MatchingInput): Promise<MatchingResult> {
    const prompt = `
You are a highly accurate job matching engine.

Your task is to evaluate how well ONE job posting matches ONE user's career preferences.

IMPORTANT:
- Be strict and evidence-based.
- Do NOT give a high score just because a few keywords match.
- Judge the actual role, required skills, experience level, work type, and remote/location requirements.
- Never invent information.
- If information is missing from the job posting, treat it as unknown, not as a match.
- A job should receive a high score only when its core requirements genuinely fit the user's preferences.

USER PREFERENCES:
${JSON.stringify(input.preferences)}

JOB POSTING:
${JSON.stringify(input.job)}

SCORING RULES:

1. CORE ROLE — most important factor
- Exact target role/domain: strong positive.
- Closely related role: moderate positive.
- Different technical domain: strong negative.
- Completely unrelated role: score should normally be below 30.

Examples:
- Backend Developer <-> Node.js Backend Developer = strong match.
- Backend Developer <-> Full Stack Developer with substantial backend work = possible strong/moderate match.
- Backend Developer <-> Frontend Developer = weak/low match.
- Backend Developer <-> QA Engineer = low match.
- Backend Developer <-> DevOps Engineer = low/moderate only if backend is genuinely part of the role.

2. TECHNICAL SKILLS
- Match the skills that are actually required, not merely mentioned.
- Required/core skills matter much more than optional/nice-to-have skills.
- Exact technologies are stronger matches than vaguely related technologies.
- Missing an important required skill should reduce the score.
- Do not treat two technologies as equivalent unless they are genuinely interchangeable for the role.

Examples:
- User: Node.js + TypeScript
  Job: Node.js + TypeScript + Express = strong match.
- User: Node.js
  Job: Python/Django backend = weak match even though both are backend.
- User: PostgreSQL
  Job: PostgreSQL required = positive.
  Job: PostgreSQL only mentioned as "nice to have" = small positive.

3. EXPERIENCE LEVEL
- Exact level match = strong positive.
- Adjacent level can be acceptable.
- Senior/Lead positions should NOT receive a high score for a Junior user unless the job explicitly accepts junior candidates.
- If the job requires significantly more experience than the user preference, reduce the score.
- Internship can match a user looking for internship/junior opportunities when the role is technically relevant.

4. REMOTE / LOCATION
- If the user requires Remote, the job must explicitly allow remote work.
- Do NOT assume remote because the company is international.
- Do NOT assume remote because the job description does not mention an office.
- If remote eligibility is unclear, treat it as unknown and reduce confidence.
- If the job explicitly excludes the user's location, treat this as a major mismatch.

5. WORK TYPE
- Match full-time, part-time, contract, internship, freelance according to user preferences.
- If the work type conflicts with the user's requirement, reduce the score.

6. LOCATION
- If the user's preference is Worldwide/Remote, a worldwide remote position can match.
- If the job is remote but restricted to countries/regions that exclude the user, this is a mismatch.
- Never assume that "Remote" means worldwide.

7. OVERALL SCORE
Use this interpretation:

90-100 = Excellent match:
Core role matches, important skills match, experience level is appropriate, and remote/location/work-type requirements are satisfied.

75-89 = Strong match:
Core role clearly matches with only minor gaps.

60-74 = Moderate match:
Relevant role but there are meaningful skill, experience, or requirement gaps.

40-59 = Weak/partial match:
Some relevance exists, but important requirements do not match.

20-39 = Poor match:
Major mismatch in role or requirements.

0-19 = Irrelevant:
The job is fundamentally unrelated to the user's target.

IMPORTANT SCORE CONSTRAINTS:
- Do not give 80+ unless the core role clearly matches.
- Do not give 70+ if a major required preference is clearly violated.
- Do not give 60+ to a fundamentally different technical role just because some skills overlap.
- If the job explicitly excludes the user's location, score must be below 30.
- If the job is not remote while the user explicitly requires remote, score must be below 40.
- If the experience requirement is significantly above the user's target level, score should normally be below 60.
- Missing information must never be treated as a positive match.

REASON:
Return a short, factual explanation mentioning the strongest matching factors and the most important mismatch, if any.

Return ONLY valid JSON:

{
  "score": number,
  "reason": "short factual explanation"
}
`;

    let response;

    try {
      response = await this.generateWithFallback(prompt);
    } catch (err) {
      if (err instanceof AIProviderError && err.skipped) {
        throw err;
      }

      throw new AIProviderError(
        `Failed to generate AI matching result: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return this.parseResponse(response.text);
  }

  async analyzeJob(job: Job): Promise<JobAnalysisResult> {
    const prompt = `
You are a job posting analysis assistant.

Analyze the following job posting and extract structured information.

Job posting:
${JSON.stringify(job)}

Return ONLY valid JSON in this exact format:

{
  "role": "backend",
  "skills": ["Node.js", "TypeScript", "Express.js"],
  "experienceLevel": "junior",
  "workType": "remote",
  "summary": "Short summary of the job"
}

Rules:
- role must be one of:
  "backend", "frontend", "fullstack", "mobile", "devops", "qa", "data", "other"

- experienceLevel must be one of:
  "intern", "junior", "mid", "senior", "lead", "unknown"

- workType must be one of:
  "remote", "hybrid", "on-site", "any"
  ("remote" if fully remote, "hybrid" if partially remote, "on-site" if in-office)

- Extract the important technical skills.

- Keep summary short.

- Do not invent information that is not present in the job posting.
`;

    let response;

    try {
      response = await this.generateWithFallback(prompt);
    } catch (err) {
      if (err instanceof AIProviderError && err.skipped) {
        throw err;
      }

      throw new AIProviderError(
        `Failed to analyze job: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return this.parseJobAnalysisResponse(response.text);
  }

  /**
   * Generates raw text using the key-rotated, circuit-protected fallback chain.
   * Leveraged by downstream components such as GeminiAmbiguityResolver (TASK-31.2).
   */
  public async generateText(prompt: string): Promise<string | undefined> {
    const response = await this.generateWithFallback(prompt);
    return response.text;
  }

  /**
   * Tries each (API key, model) slot in order, before giving up.
   *
   * A slot whose circuit is open (daily quota exhausted, or a recent
   * sustained 503) is skipped immediately. Only when every slot is
   * unavailable do we throw a `skipped` error, which the pipeline
   * treats as "continue without analysis" rather than a hard failure.
   */
  private async generateWithFallback(
    prompt: string,
  ): Promise<{ text: string | undefined }> {
    let lastSkipReason = 'unavailable';

    for (const slot of this.slots) {
      const circuitKey = this.circuitKey(slot);

      if (!this.isAvailable(circuitKey)) {
        lastSkipReason = this.circuitReason(circuitKey);
        continue;
      }

      try {
        return await this.generateWithRetry(slot, prompt);
      } catch (err) {
        if (err instanceof AIProviderError && err.skipped) {
          // This slot's circuit just opened — fall through and try
          // the next (key, model) combination instead of failing the job.
          lastSkipReason = err.reason ?? lastSkipReason;
          continue;
        }

        throw err;
      }
    }

    throw new AIProviderError(
      `All Gemini keys/models unavailable (${lastSkipReason})`,
      {
        skipped: true,
        reason: lastSkipReason,
      },
    );
  }

  private circuitKey(slot: Slot): string {
    return `${slot.keyIndex}:${slot.model}`;
  }

  private isAvailable(circuitKey: string): boolean {
    const circuit = this.circuits.get(circuitKey);
    return !circuit || Date.now() >= circuit.unavailableUntil;
  }

  msUntilAvailable(): number {
  const now = Date.now();
  return Math.min(
    ...this.slots.map((s) => {
      const c = this.circuits.get(this.circuitKey(s));
      return c ? Math.max(0, c.unavailableUntil - now) : 0;
    }),
  );
}

  public hasAvailableSlot(): boolean {
    return this.slots.some((slot) =>
      this.isAvailable(this.circuitKey(slot)),
    );
  }
  private circuitReason(circuitKey: string): string {
    return this.circuits.get(circuitKey)?.reason ?? 'unavailable';
  }

  /** Opens the circuit for the given slot. */
  private openCircuit(slot: Slot, durationMs: number, reason: string): void {
    this.circuits.set(this.circuitKey(slot), {
      unavailableUntil: Date.now() + durationMs,
      reason,
    });
  }

  /** Closes the circuit for the given slot after a successful call. */
  private closeCircuit(slot: Slot): void {
    const circuitKey = this.circuitKey(slot);

    if (this.circuits.has(circuitKey)) {
      logger.info(
        `Gemini key #${slot.keyIndex} / model ${slot.model} recovered; circuit closed.`,
      );
      this.circuits.delete(circuitKey);
    }
  }

  /**
   * Retries transient Gemini failures with exponential backoff, for a
   * single (key, model) slot.
   *
   * Retryable:
   * - 503 Service Unavailable
   * - 500 Internal Server Error
   * - 429 temporary rate limit
   *
   * Daily quota exhaustion is NOT retried (waiting will not restore
   * quota); instead it opens this slot's circuit, and the caller
   * (`generateWithFallback`) moves on to the next slot in the chain.
   *
   * A sustained 503 (all attempts exhausted) also opens the circuit so
   * the rest of the pipeline skips this slot quickly instead of waiting
   * on every job.
   *
   * Every attempt goes through this key's own rate limiter first, so we
   * stay under the published per-key RPM instead of leaning on 429
   * retries.
   */
  private async generateWithRetry(
    slot: Slot,
    prompt: string,
    maxRetries = 2,
  ): Promise<{ text: string | undefined }> {
    let lastError: unknown;
    let saw503 = false;

    const rateLimiter = this.rateLimiters[slot.keyIndex];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await rateLimiter.acquire();

      try {
        const response = await slot.client.models.generateContent({
          model: slot.model,
          contents: prompt,
        });

        this.closeCircuit(slot);

        return response;
      } catch (err) {
        lastError = err;

        const status = (err as { status?: number })?.status;

        if (status === 503) {
          saw503 = true;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);

        /*
         * Daily free-tier quota exhaustion is not a transient
         * rate-limit error. Retrying will not restore the quota,
         * so open this slot's circuit and let the caller fall
         * back to the next (key, model) combination.
         */
        const isDailyQuotaExceeded =
          errorMessage.includes('GenerateRequestsPerDayPerProject-FreeTier') ||
          errorMessage.includes('GenerateRequestsPerDayPerModel-FreeTier') ||
          errorMessage.includes('generate_content_free_tier_requests');

        if (isDailyQuotaExceeded) {
          logger.warn(
            `Gemini daily quota exhausted for key #${slot.keyIndex} / model ${slot.model}. Opening circuit.`,
          );

          this.openCircuit(
            slot,
            GeminiProvider.DAILY_QUOTA_COOLDOWN_MS,
            'daily-quota-exhausted',
          );

          throw new AIProviderError('Gemini daily quota exhausted', {
            skipped: true,
            reason: 'daily-quota-exhausted',
          });
        }

        const isInvalidKey =
          errorMessage.includes('API_KEY_INVALID') ||
          errorMessage.includes('API key not valid') ||
          (status === 400 && errorMessage.toLowerCase().includes('api key')) ||
          status === 401;

        if (isInvalidKey) {
          logger.warn(
            `Gemini API key #${slot.keyIndex} is invalid. Opening circuit.`,
          );

          this.openCircuit(
            slot,
            GeminiProvider.DAILY_QUOTA_COOLDOWN_MS,
            'invalid-api-key',
          );

          throw new AIProviderError('Gemini API key invalid', {
            skipped: true,
            reason: 'invalid-api-key',
          });
        }

        const isRetryable = status === 503 || status === 429 || status === 500;

        if (!isRetryable || attempt === maxRetries) {
          /*
           * Out of retries (or non-retryable). If the failure was a
           * sustained 503, open this slot's circuit so remaining jobs
           * skip it quickly instead of each burning the full retry
           * cycle.
           */
          if (saw503) {
            logger.warn(
              `Gemini returned sustained 503 for key #${slot.keyIndex} / model ${slot.model}. Opening circuit.`,
            );

            this.openCircuit(slot, GeminiProvider.TRANSIENT_COOLDOWN_MS, 'service-unavailable');

            throw new AIProviderError('Gemini service unavailable (sustained 503)', {
              skipped: true,
              reason: 'service-unavailable',
            });
          }

          throw err;
        }

        const retryDelayMs = this.extractRetryDelay(errorMessage);

        let waitMs: number;

        if (retryDelayMs !== null) {
          waitMs = retryDelayMs;
        } else {
          const baseWaitMs = attempt === 0 ? ms('2s') : ms(`${2 ** attempt * 2}s`);

          const jitterMs = Math.floor(Math.random() * ms('1s'));

          waitMs = baseWaitMs + jitterMs;
        }

        logger.warn(
          `Transient Gemini error (status ${status}) on key #${slot.keyIndex} / ${slot.model}, retrying in ${(
            waitMs / 1000
          ).toFixed(3)}s (attempt ${attempt + 1}/${maxRetries + 1})`,
        );

        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    throw lastError;
  }

  /**
   * Extracts Gemini's retryDelay from the error message.
   *
   * Example:
   * retryDelay: "27s"
   */
  private extractRetryDelay(errorMessage: string): number | null {
    const match = errorMessage.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);

    if (!match) {
      return null;
    }

    const seconds = Number(match[1]);

    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }

    return Math.ceil(seconds * 1000);
  }

  private parseResponse(text: string | undefined): MatchingResult {
    if (!text) {
      throw new AIProviderError('AI returned an empty response');
    }

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;

    try {
      parsed = JSON.parse(cleaned);
    } catch (err: unknown) {
      throw new AIProviderError(`AI returned invalid JSON: ${(err as Error).message}`);
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('score' in parsed) ||
      !('reason' in parsed)
    ) {
      throw new AIProviderError('AI returned an invalid matching result');
    }

    const result = parsed as {
      score: unknown;
      reason: unknown;
    };

    if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) {
      throw new AIProviderError('AI returned an invalid score');
    }

    if (typeof result.reason !== 'string') {
      throw new AIProviderError('AI returned an invalid reason');
    }

    return {
      score: result.score,
      reason: result.reason,
    };
  }

  private parseJobAnalysisResponse(text: string | undefined): JobAnalysisResult {
    if (!text) {
      throw new AIProviderError('AI returned an empty job analysis response');
    }

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;

    try {
      parsed = JSON.parse(cleaned);
    } catch (err: unknown) {
      throw new AIProviderError(`AI returned invalid JSON for job analysis: ${(err as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new AIProviderError('AI returned an invalid job analysis result');
    }

    const result = parsed as Record<string, unknown>;

    if (
      typeof result.role !== 'string' ||
      !Array.isArray(result.skills) ||
      typeof result.experienceLevel !== 'string' ||
      typeof result.workType !== 'string' ||
      typeof result.summary !== 'string'
    ) {
      throw new AIProviderError('AI returned an invalid job analysis structure');
    }

    if (!result.skills.every((skill) => typeof skill === 'string')) {
      throw new AIProviderError('AI returned invalid job skills');
    }

    const rawWorkType = result.workType.toLowerCase().trim();
    let workType: WorkType = WorkType.ANY;
    if (rawWorkType === 'remote') {
      workType = WorkType.REMOTE;
    } else if (rawWorkType === 'hybrid') {
      workType = WorkType.HYBRID;
    } else if (rawWorkType === 'on-site' || rawWorkType === 'onsite') {
      workType = WorkType.ON_SITE;
    }

    return {
      role: result.role,
      skills: result.skills,
      experienceLevel: result.experienceLevel,
      workType,
      summary: result.summary,
    };
  }
}

import { z } from 'zod';
import { Specialization } from '@prisma/client';
import { GeminiProvider } from '../../matching/ai/gemini.provider.js';
import logger from '../../../shared/utils/logger.js';
import type {
  AmbiguityResolver,
  AmbiguityResolutionInput,
  AmbiguityResolutionOutput,
} from './job.classifier.js';

/**
 * Zod Schema for Structured AI Ambiguity Resolution (TASK-31.2 / Issue #95).
 * Enforces strict typing against Prisma Specialization enum with bounded confidence and reasoning.
 */
export const AIAmbiguityResolutionSchema = z.object({
  specialization: z.nativeEnum(Specialization),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});

export type AIAmbiguityResolution = z.infer<typeof AIAmbiguityResolutionSchema>;

/** Minimal interface for text generation capability in AI providers. */
export interface TextGenerator {
  generateText(prompt: string): Promise<string | undefined>;
}

/**
 * Gemini-powered Ambiguity Resolver with Zod Schema Validation (TASK-31.2).
 * Integrates directly with the platform's multi-key rotated GeminiProvider,
 * inheriting automatic key rotation, circuit breakers, and rate limiting.
 */
export class GeminiAmbiguityResolver implements AmbiguityResolver {
  private provider: TextGenerator | null = null;
  private readonly timeoutMs: number;

  public static readonly DEFAULT_TIMEOUT_MS = 5000;

  public static readonly SYSTEM_PROMPT =
    'You are a job specialization classifier. Categorize the role into exactly one of the 10 allowed specializations.';

  public static readonly ALLOWED_SPECIALIZATIONS: readonly Specialization[] = [
    Specialization.BACKEND,
    Specialization.FRONTEND,
    Specialization.FULLSTACK,
    Specialization.MOBILE,
    Specialization.DEVOPS,
    Specialization.DATA,
    Specialization.AI_ENGINEER,
    Specialization.SECURITY,
    Specialization.QA,
    Specialization.UIUX,
  ];

  constructor(options?: { provider?: TextGenerator; timeoutMs?: number }) {
    if (options?.provider) {
      this.provider = options.provider;
    }
    this.timeoutMs = options?.timeoutMs ?? GeminiAmbiguityResolver.DEFAULT_TIMEOUT_MS;
  }

  private getProvider(): TextGenerator {
    if (!this.provider) {
      this.provider = new GeminiProvider();
    }
    return this.provider;
  }

  /**
   * Resolves job specialization by prompting Gemini with clean title and first 500 chars of description.
   * Validates response strictly against AIAmbiguityResolutionSchema.
   * Wrapped in a 5-second timeout (TASK-31.3) to prevent pipeline blockage during AI latency.
   * On validation error, timeout, or failure, returns { specialization: null, confidence: 0 } without throwing.
   */
  public async resolve(input: AmbiguityResolutionInput): Promise<AmbiguityResolutionOutput> {
    const cleanTitle = (input.title || '').trim();
    const cleanDesc = (input.description || '').trim().slice(0, 500);

    const prompt = this.buildPrompt(cleanTitle, cleanDesc);

    try {
      const provider = this.getProvider();
      const rawText = await this.executeWithTimeout(
        provider.generateText(prompt),
        this.timeoutMs,
      );

      if (!rawText || !rawText.trim()) {
        logger.warn(`[GeminiAmbiguityResolver] Empty response received for title: "${cleanTitle}"`);
        return {
          specialization: null,
          confidence: 0,
          reasoning: 'Empty LLM response',
        };
      }

      return this.parseAndValidateResponse(rawText, cleanTitle);
    } catch (err) {
      logger.warn(
        `[GeminiAmbiguityResolver] Outage or API error resolving title "${cleanTitle}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        specialization: null,
        confidence: 0,
        reasoning: err instanceof Error ? err.message : 'AI outage',
      };
    }
  }

  /**
   * Wraps a promise in a timeout guard.
   * Rejects early if execution exceeds timeoutMs.
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`AI resolution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private buildPrompt(title: string, description: string): string {
    const specializationsList = GeminiAmbiguityResolver.ALLOWED_SPECIALIZATIONS.join(', ');

    return `SYSTEM: ${GeminiAmbiguityResolver.SYSTEM_PROMPT}

Classify the following job role into exactly one of the 10 allowed specializations.

Allowed Specializations:
[${specializationsList}]

Job Title: ${title}
Job Description:
${description || 'No description provided.'}

Respond strictly with a valid JSON object adhering to this schema:
{
  "specialization": "<ONE_OF_ALLOWED_SPECIALIZATIONS>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<short explanation, maximum 200 characters>"
}`;
  }

  private parseAndValidateResponse(rawText: string, title: string): AmbiguityResolutionOutput {
    try {
      const jsonStr = this.extractJson(rawText);
      const parsed = JSON.parse(jsonStr);

      const parseResult = AIAmbiguityResolutionSchema.safeParse(parsed);

      if (!parseResult.success) {
        logger.warn(
          `[GeminiAmbiguityResolver] Zod validation failed for title "${title}": ${parseResult.error.message}`,
        );
        return {
          specialization: null,
          confidence: 0,
          reasoning: `Zod validation error: ${parseResult.error.issues[0]?.message || 'Invalid schema'}`,
        };
      }

      return {
        specialization: parseResult.data.specialization,
        confidence: parseResult.data.confidence,
        reasoning: parseResult.data.reasoning,
      };
    } catch (parseError) {
      logger.warn(
        `[GeminiAmbiguityResolver] Malformed JSON response for title "${title}": ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
      return {
        specialization: null,
        confidence: 0,
        reasoning: 'Malformed JSON from LLM',
      };
    }
  }

  private extractJson(text: string): string {
    const trimmed = text.trim();
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return trimmed;
  }
}

export const geminiAmbiguityResolver = new GeminiAmbiguityResolver();

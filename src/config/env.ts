import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function resolveGeminiApiKeys(envKeys?: string, singleKey?: string): string[] {
  if (envKeys) {
    return envKeys
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
  }
  return singleKey ? [singleKey] : [];
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z
    .string({
      required_error: 'DATABASE_URL is required',
      invalid_type_error: 'DATABASE_URL must be a string',
    })
    .min(1, 'DATABASE_URL cannot be empty')
    .refine(
      (val) => val.startsWith('postgresql://') || val.startsWith('postgres://'),
      {
        message: 'DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://',
      },
    ),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(20),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEYS: z.string().optional().default(''),
  PIPELINE_API_SECRET: z.string().optional().default(''),
  JOB_RUN_TIME_1: z.string().default('09:00'),
  JOB_RUN_TIME_2: z.string().default('21:00'),
  TIMEZONE: z.string().default('Asia/Gaza'),
  ADZUNA_APP_ID: z.string().optional().default(''),
  ADZUNA_APP_KEY: z.string().optional().default(''),
  JOOBLE_API_KEY: z.string().optional().default(''),
  RAPIDAPI_KEY: z.string().optional().default(''),
  MIN_MATCH_SCORE: z.coerce.number().default(40),
  MIN_DIGEST_SCORE_THRESHOLD: z.coerce.number().default(55),
  FIRECRAWL_API_KEY: z.string().optional().default(''),
});

export type RawEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown> = process.env): RawEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `[${issue.path.join('.') || 'env'}]: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formattedErrors}`);
  }
  return result.data;
}

const rawValidated = validateEnv({
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    (process.env.NODE_ENV === 'test'
      ? 'postgresql://postgres:postgres@localhost:5432/career_platform?schema=public'
      : undefined),
});

const env = {
  nodeEnv: rawValidated.NODE_ENV,
  port: rawValidated.PORT,
  telegramBotToken: rawValidated.TELEGRAM_BOT_TOKEN,
  redisUrl: rawValidated.REDIS_URL,
  databaseUrl: rawValidated.DATABASE_URL,
  databasePoolSize: rawValidated.DATABASE_POOL_SIZE,
  /** @deprecated use geminiApiKeys — kept for any code still reading the single key. */
  geminiApiKey: rawValidated.GEMINI_API_KEY,
  geminiApiKeys: resolveGeminiApiKeys(rawValidated.GEMINI_API_KEYS, rawValidated.GEMINI_API_KEY),
  pipelineApiKey: rawValidated.PIPELINE_API_SECRET,
  jobRunTime1: rawValidated.JOB_RUN_TIME_1,
  jobRunTime2: rawValidated.JOB_RUN_TIME_2,
  timezone: rawValidated.TIMEZONE,
  adzunaAppId: rawValidated.ADZUNA_APP_ID,
  adzunaAppKey: rawValidated.ADZUNA_APP_KEY,
  joobleApiKey: rawValidated.JOOBLE_API_KEY,
  rapidApiKey: rawValidated.RAPIDAPI_KEY,
  minMatchScore: rawValidated.MIN_MATCH_SCORE,
  minDigestScoreThreshold: rawValidated.MIN_DIGEST_SCORE_THRESHOLD,
  firecrawlApiKey: rawValidated.FIRECRAWL_API_KEY,
};

export default env;
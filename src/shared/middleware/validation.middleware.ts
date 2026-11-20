import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';

/**
 * Safely extracts error details from the first Zod issue without looping over
 * user-controlled objects, mitigating Layer 7 denial of service vulnerabilities.
 */
function extractFirstIssueDetails(
  issues: readonly { path?: (string | number)[]; message: string }[],
  fallbackScope: string,
): string {
  const first = issues[0];
  if (!first) return 'Invalid input payload';
  const field = first.path && first.path.length > 0 ? String(first.path[0]) : fallbackScope;
  return `[${field}]: ${first.message}`;
}

/**
 * Express middleware to validate request body using a Zod schema.
 * Rejects malformed or unexpected payloads with HTTP 400 Bad Request.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        const errorDetails = extractFirstIssueDetails(parsed.error.issues, 'body');

        logger.warn(`[ValidationMiddleware] Invalid request body on ${req.method} ${req.path}: ${errorDetails}`);
        next(AppError.badRequest(`Validation error: ${errorDetails}`));
        return;
      }
      req.body = parsed.data;
      next();
    } catch (err: unknown) {
      logger.error(`[ValidationMiddleware] Unexpected error validating body: ${(err as Error).message}`);
      next(err);
    }
  };
}

/**
 * Express middleware to validate request query parameters using a Zod schema.
 * Rejects malformed or unexpected queries with HTTP 400 Bad Request.
 */
export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) {
        const errorDetails = extractFirstIssueDetails(parsed.error.issues, 'query');

        logger.warn(`[ValidationMiddleware] Invalid request query on ${req.method} ${req.path}: ${errorDetails}`);
        next(AppError.badRequest(`Validation error: ${errorDetails}`));
        return;
      }
      req.query = parsed.data;
      next();
    } catch (err: unknown) {
      logger.error(`[ValidationMiddleware] Unexpected error validating query: ${(err as Error).message}`);
      next(err);
    }
  };
}

import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';

/**
 * Express middleware to validate request body using a Zod schema.
 * Rejects malformed or unexpected payloads with HTTP 400 Bad Request.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        const errorDetails = parsed.error.issues
          .map((issue) => `[${issue.path.join('.') || 'body'}]: ${issue.message}`)
          .join(', ');

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
        const errorDetails = parsed.error.issues
          .map((issue) => `[${issue.path.join('.') || 'query'}]: ${issue.message}`)
          .join(', ');

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

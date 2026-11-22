import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import env from '../../config/env.js';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';

/**
 * Constant-time string comparison using SHA-256 digests to protect against
 * timing side-channel attacks on secret tokens.
 */
export function secureCompareTokens(provided: string, expected: string): boolean {
  try {
    const hashProvided = crypto.createHash('sha256').update(provided).digest();
    const hashExpected = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(hashProvided, hashExpected);
  } catch (error: unknown) {
    logger.error(
      `[PipelineAuth] Error performing constant-time token comparison: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * Express middleware to authenticate pipeline and administrative endpoints.
 * Requires HTTP header `Authorization: Bearer <PIPELINE_API_SECRET>`.
 * Also supports `x-api-key: <PIPELINE_API_SECRET>` for backward compatibility.
 * Rejects unauthorized requests with HTTP 401 and never logs secret tokens.
 */
export function requirePipelineAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    let providedKey: string | undefined;

    if (typeof authHeader === 'string' && authHeader.trim()) {
      const parts = authHeader.trim().split(/\s+/);
      if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer' && parts[1]?.trim()) {
        providedKey = parts[1].trim();
      }
    } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
      providedKey = apiKeyHeader.trim();
    }

    const expectedKeys = [
      env.pipelineApiKey?.trim(),
      process.env.API_BEARER_TOKEN?.trim(),
      process.env.PIPELINE_API_SECRET?.trim(),
    ].filter((k): k is string => Boolean(k && k.length > 0));

    const isMatch =
      Boolean(providedKey) &&
      expectedKeys.length > 0 &&
      expectedKeys.some((expected) => secureCompareTokens(providedKey!, expected));

    if (!providedKey || expectedKeys.length === 0 || !isMatch) {
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      logger.warn(
        `[PipelineAuth] Unauthorized pipeline access attempt on ${req.method} ${req.path} from ${clientIp}`,
      );
      next(AppError.unauthorized('Unauthorized: Invalid or missing API key'));
      return;
    }

    next();
  } catch (error: unknown) {
    logger.error(
      `[PipelineAuth] Unexpected error during pipeline authentication on ${req.method} ${req.path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    next(AppError.unauthorized('Unauthorized: Authentication processing failure'));
  }
}

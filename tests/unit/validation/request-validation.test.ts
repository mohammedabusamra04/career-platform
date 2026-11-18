import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  validateBody,
  validateQuery,
} from '../../../src/shared/middleware/validation.middleware.js';
import { AppError } from '../../../src/shared/errors/AppError.js';

describe('TASK-45.1: HTTP Inbound Request Zod Validation Middleware', () => {
  describe('validateBody', () => {
    const testBodySchema = z.object({
      name: z.string().min(2),
      count: z.number().int().positive(),
    });

    it('should pass validated body to next middleware when payload is valid', () => {
      const middleware = validateBody(testBodySchema);
      const req = {
        method: 'POST',
        path: '/test',
        body: { name: 'Fullstack', count: 10 },
      } as Request;
      const res = {} as Response;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(); // called with no arguments (success)
      expect(req.body).toEqual({ name: 'Fullstack', count: 10 });
    });

    it('should call next with AppError.badRequest when body fails schema validation', () => {
      const middleware = validateBody(testBodySchema);
      const req = {
        method: 'POST',
        path: '/test',
        body: { name: 'F', count: -5 }, // name too short, count negative
      } as Request;
      const res = {} as Response;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('Validation error');
    });
  });

  describe('validateQuery', () => {
    const testQuerySchema = z.object({
      force: z
        .enum(['true', 'false'])
        .optional()
        .transform((val) => val === 'true'),
    });

    it('should parse and transform valid query parameters', () => {
      const middleware = validateQuery(testQuerySchema);
      const req = {
        method: 'GET',
        path: '/test',
        query: { force: 'true' },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.query.force).toBe(true);
    });

    it('should reject invalid query parameter values with 400 Bad Request', () => {
      const middleware = validateQuery(testQuerySchema);
      const req = {
        method: 'GET',
        path: '/test',
        query: { force: 'maybe' },
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
    });
  });
});

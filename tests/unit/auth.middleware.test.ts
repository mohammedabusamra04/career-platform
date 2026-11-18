import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requirePipelineAuth, secureCompareTokens } from '../../src/shared/middleware/auth.middleware.js';
import env from '../../src/config/env.js';
import { AppError } from '../../src/shared/errors/AppError.js';
import logger from '../../src/shared/utils/logger.js';

describe('TASK-45.2: Secure Pipeline Endpoint Authentication (#129)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    vi.restoreAllMocks();
    env.pipelineApiKey = 'super-secret-pipeline-token-xyz';
    mockRequest = {
      method: 'POST',
      path: '/internal/pipeline/run',
      headers: {},
      ip: '127.0.0.1',
    };
    mockResponse = {};
    nextFunction = vi.fn();
  });

  describe('secureCompareTokens constant-time comparison', () => {
    it('returns true when tokens match exactly', () => {
      expect(secureCompareTokens('my-token', 'my-token')).toBe(true);
    });

    it('returns false when tokens differ', () => {
      expect(secureCompareTokens('token-a', 'token-b')).toBe(false);
    });

    it('returns false when tokens have different lengths', () => {
      expect(secureCompareTokens('short', 'much-longer-token')).toBe(false);
    });

    it('returns false and logs error safely if an unexpected exception occurs without throwing', () => {
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      // Pass null/undefined as invalid inputs to force exception
      const result = secureCompareTokens(null as unknown as string, 'expected');
      expect(result).toBe(false);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('[PipelineAuth] Error performing constant-time token comparison'));
    });
  });

  describe('requirePipelineAuth middleware', () => {
    it('accepts valid Authorization: Bearer <PIPELINE_API_SECRET> and invokes next()', () => {
      mockRequest.headers = {
        authorization: 'Bearer super-secret-pipeline-token-xyz',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });

    it('handles extra whitespace in Bearer header correctly', () => {
      mockRequest.headers = {
        authorization: 'Bearer    super-secret-pipeline-token-xyz   ',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });

    it('rejects missing Authorization header with HTTP 401 Unauthorized', () => {
      mockRequest.headers = {};

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('Unauthorized');
    });

    it('rejects incorrect Bearer token with HTTP 401 Unauthorized', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-attacker-token',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
    });

    it('rejects empty Bearer token with HTTP 401 Unauthorized', () => {
      mockRequest.headers = {
        authorization: 'Bearer ',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
    });

    it('rejects non-Bearer authentication schemes (e.g. Basic, Digest) with HTTP 401', () => {
      mockRequest.headers = {
        authorization: 'Basic dXNlcjpwYXNzd29yZA==',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
    });

    it('supports x-api-key header for backward compatibility', () => {
      mockRequest.headers = {
        'x-api-key': 'super-secret-pipeline-token-xyz',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith();
    });

    it('rejects when server env.pipelineApiKey is empty or undefined with HTTP 401', () => {
      env.pipelineApiKey = '';
      mockRequest.headers = {
        authorization: 'Bearer super-secret-pipeline-token-xyz',
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
    });

    it('never logs secret tokens or candidate tokens in logger or stdout', () => {
      const sensitiveCandidateToken = 'attempted-leak-token-12345';
      const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      mockRequest.headers = {
        authorization: `Bearer ${sensitiveCandidateToken}`,
      };

      requirePipelineAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = loggerSpy.mock.calls[0][0];

      // Verifies route & IP are logged, but secrets are strictly excluded
      expect(loggedMessage).toContain('/internal/pipeline/run');
      expect(loggedMessage).toContain('127.0.0.1');
      expect(loggedMessage).not.toContain(sensitiveCandidateToken);
      expect(loggedMessage).not.toContain('super-secret-pipeline-token-xyz');
    });

    it('handles unexpected exceptions during authentication safely without empty catch', () => {
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      // Create request object with throwing getter to trigger catch block
      const evilRequest = {
        get headers(): Record<string, string> {
          throw new Error('Memory corruption simulation');
        },
        method: 'POST',
        path: '/internal/pipeline/run',
      } as unknown as Request;

      requirePipelineAuth(evilRequest, mockResponse as Response, nextFunction);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PipelineAuth] Unexpected error during pipeline authentication'),
      );
      expect(nextFunction).toHaveBeenCalledWith(expect.any(AppError));
      const error = vi.mocked(nextFunction).mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(401);
    });
  });
});

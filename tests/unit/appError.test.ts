import { describe, expect, it } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../src/shared/errors/AppError.js';

describe('AppError', () => {
  it('should create an instance with correct properties', () => {
    const error = new AppError('Something went wrong', StatusCodes.BAD_REQUEST);

    expect(error.message).toBe('Something went wrong');
    expect(error.statusCode).toBe(StatusCodes.BAD_REQUEST);
    expect(error.name).toBe('AppError');
    expect(error.isOperational).toBe(true);
  });

  it('should create badRequest error', () => {
    const error = AppError.badRequest('Invalid input');
    expect(error.statusCode).toBe(StatusCodes.BAD_REQUEST);
    expect(error.message).toBe('Invalid input');
  });

  it('should create unauthorized error', () => {
    const error = AppError.unauthorized('No access');
    expect(error.statusCode).toBe(StatusCodes.UNAUTHORIZED);
  });

  it('should create forbidden error', () => {
    const error = AppError.forbidden('Forbidden');
    expect(error.statusCode).toBe(StatusCodes.FORBIDDEN);
  });

  it('should create notFound error', () => {
    const error = AppError.notFound('Resource not found');
    expect(error.statusCode).toBe(StatusCodes.NOT_FOUND);
  });

  it('should create conflict error', () => {
    const error = AppError.conflict('Already exists');
    expect(error.statusCode).toBe(StatusCodes.CONFLICT);
  });

  it('should create internal server error', () => {
    const error = AppError.internal('Internal failure');
    expect(error.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});

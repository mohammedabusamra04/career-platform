import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../../src/config/env.js';

describe('TASK-20.2: Zod Environment Validation for PostgreSQL', () => {
  it('should accept valid postgresql:// and postgres:// connection URLs', () => {
    const validConfig = {
      DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/career_platform?schema=public',
      DATABASE_POOL_SIZE: '25',
    };

    const validated = validateEnv(validConfig);
    expect(validated.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(validated.DATABASE_POOL_SIZE).toBe(25);
  });

  it('should accept postgres:// shorthand prefix', () => {
    const validConfig = {
      DATABASE_URL: 'postgres://app_user:pass@db.internal:5432/production_db',
    };

    const validated = validateEnv(validConfig);
    expect(validated.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(validated.DATABASE_POOL_SIZE).toBe(20); // Default value
  });

  it('should throw an informative error when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrowError(/DATABASE_URL is required/);
  });

  it('should throw an informative error when DATABASE_URL is empty', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrowError(/DATABASE_URL cannot be empty/);
  });

  it('should throw an informative error when DATABASE_URL protocol is not PostgreSQL', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://root:pass@localhost:3306/db' }),
    ).toThrowError(/DATABASE_URL must be a valid PostgreSQL connection string/);

    expect(() =>
      validateEnv({ DATABASE_URL: 'mongodb://localhost:27017/db' }),
    ).toThrowError(/DATABASE_URL must be a valid PostgreSQL connection string/);

    expect(() =>
      validateEnv({ DATABASE_URL: 'invalid-connection-string' }),
    ).toThrowError(/DATABASE_URL must be a valid PostgreSQL connection string/);
  });

  it('should reject non-positive or non-integer DATABASE_POOL_SIZE', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        DATABASE_POOL_SIZE: '-5',
      }),
    ).toThrowError(/DATABASE_POOL_SIZE/);

    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        DATABASE_POOL_SIZE: '0',
      }),
    ).toThrowError(/DATABASE_POOL_SIZE/);
  });
});

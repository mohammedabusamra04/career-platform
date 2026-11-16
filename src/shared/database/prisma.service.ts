import { PrismaClient } from '@prisma/client';
import env from '../../config/env.js';
import logger from '../utils/logger.js';

/**
 * Appends or updates connection_limit and pool_timeout parameters in the PostgreSQL connection string.
 */
export function buildDatabaseUrl(
  baseUrl: string,
  poolSize: number = 20,
  poolTimeout: number = 10,
): string {
  try {
    const parsed = new URL(baseUrl);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', String(poolSize));
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', String(poolTimeout));
    }
    return parsed.toString();
  } catch (err: unknown) {
    logger.warn(`[PrismaService] Failed parsing DATABASE_URL: ${(err as Error).message}`);
    return baseUrl;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma_singleton__: PrismaService | undefined;
}

export class PrismaService extends PrismaClient {
  private static instance: PrismaService | null = null;
  private isConnected = false;

  public constructor(customUrl?: string) {
    const url = customUrl ?? buildDatabaseUrl(env.databaseUrl, env.databasePoolSize, 10);
    super({
      datasources: {
        db: {
          url,
        },
      },
      log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  public static getInstance(): PrismaService {
    if (process.env.NODE_ENV === 'development') {
      // In development, preserve instance across hot-reloads via globalThis
      if (!global.__prisma_singleton__) {
        global.__prisma_singleton__ = new PrismaService();
      }
      return global.__prisma_singleton__;
    }

    if (!PrismaService.instance) {
      PrismaService.instance = new PrismaService();
    }
    return PrismaService.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    try {
      await this.$connect();
      this.isConnected = true;
      logger.info('Prisma connected to PostgreSQL successfully.');
    } catch (error) {
      logger.error(
        `Failed to connect to PostgreSQL via Prisma: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.$disconnect();
      this.isConnected = false;
      logger.info('Prisma disconnected from PostgreSQL.');
    } catch (error) {
      logger.error(
        `Error disconnecting Prisma from PostgreSQL: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return true;
    } catch (err: unknown) {
      logger.warn(`[PrismaService] Ping probe failed: ${(err as Error).message}`);
      return false;
    }
  }

  public static async resetInstanceForTesting(): Promise<void> {
    if (global.__prisma_singleton__) {
      await global.__prisma_singleton__.disconnect();
      global.__prisma_singleton__ = undefined;
    }
    if (PrismaService.instance) {
      await PrismaService.instance.disconnect();
      PrismaService.instance = null;
    }
  }
}

export const prisma = PrismaService.getInstance();

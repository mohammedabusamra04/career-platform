import type { RedisClientType } from 'redis';

import type { Cache } from './cache.interface.js';

import logger from '../shared/utils/logger.js';

export class RedisAdapter implements Cache {
  constructor(private readonly client: RedisClientType) {}

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (this.client.isReady === false) {
      return;
    }

    try {
      const data = JSON.stringify(value);

      if (ttl !== undefined) {
        await this.client.set(key, data, {
          EX: ttl,
        });

        return;
      }

      await this.client.set(key, data);
    } catch (error) {
      logger.warn(
        `⚠️ Redis SET degraded for key "${key}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.client.isReady === false) {
      return null;
    }

    try {
      const data = await this.client.get(key);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as T;
    } catch (error) {
      logger.warn(
        `⚠️ Redis GET degraded for key "${key}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return null;
    }
  }

  async setIfNotExists<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    if (this.client.isReady === false) {
      return true;
    }

    try {
      const data = JSON.stringify(value);

      const result =
        ttl !== undefined
          ? await this.client.set(key, data, {
              NX: true,
              EX: ttl,
            })
          : await this.client.set(key, data, {
              NX: true,
            });

      return result === 'OK';
    } catch (error) {
      logger.warn(
        `⚠️ Redis SET NX degraded for key "${key}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return true;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.client.isReady === false) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      logger.warn(
        `⚠️ Redis DELETE degraded for key "${key}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}
import { describe, expect, it, vi } from 'vitest';
import { RedisAdapter } from '../../src/cache/redis.adapter.js';

describe('RedisAdapter', () => {
  it('should set a value in Redis', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
    };

    const cache = new RedisAdapter(client as never);

    await cache.set('test:key', { name: 'Mohammed' });

    expect(client.set).toHaveBeenCalledWith('test:key', JSON.stringify({ name: 'Mohammed' }));
  });

  it('should set a value with TTL', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
    };

    const cache = new RedisAdapter(client as never);

    await cache.set('jobs:test', { title: 'Backend Developer' }, 86400);

    expect(client.set).toHaveBeenCalledWith(
      'jobs:test',
      JSON.stringify({ title: 'Backend Developer' }),
      {
        EX: 86400,
      },
    );
  });

  it('should set a value only if key does not exist', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
    };

    const cache = new RedisAdapter(client as never);

    const result = await cache.setIfNotExists('test:key', true);

    expect(result).toBe(true);

    expect(client.set).toHaveBeenCalledWith('test:key', JSON.stringify(true), {
      NX: true,
    });
  });

  it('should return false when key already exists', async () => {
    const client = {
      set: vi.fn().mockResolvedValue(null),
    };

    const cache = new RedisAdapter(client as never);

    const result = await cache.setIfNotExists('test:key', true);

    expect(result).toBe(false);
  });

  it('should set a value with NX and TTL', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
    };

    const cache = new RedisAdapter(client as never);

    const result = await cache.setIfNotExists('fingerprint:test', true, 86400);

    expect(result).toBe(true);

    expect(client.set).toHaveBeenCalledWith('fingerprint:test', JSON.stringify(true), {
      NX: true,
      EX: 86400,
    });
  });

  it('should get a value from Redis', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ title: 'Backend Developer' })),
    };

    const cache = new RedisAdapter(client as never);

    const result = await cache.get<{ title: string }>('jobs:test');

    expect(result).toEqual({
      title: 'Backend Developer',
    });

    expect(client.get).toHaveBeenCalledWith('jobs:test');
  });

  it('should return null when key does not exist', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(null),
    };

    const cache = new RedisAdapter(client as never);

    const result = await cache.get('missing:key');

    expect(result).toBeNull();
  });

  it('should delete a value from Redis', async () => {
    const client = {
      del: vi.fn().mockResolvedValue(1),
    };

    const cache = new RedisAdapter(client as never);

    await cache.delete('test:key');

    expect(client.del).toHaveBeenCalledWith('test:key');
  });

  it('should degrade gracefully when Redis SET fails', async () => {
    const error = new Error('Redis unavailable');

    const client = {
      set: vi.fn().mockRejectedValue(error),
    };

    const cache = new RedisAdapter(client as never);

    await expect(cache.set('test:key', 'value')).resolves.toBeUndefined();
  });

  it('should return null gracefully when Redis GET fails', async () => {
    const error = new Error('Redis unavailable');

    const client = {
      get: vi.fn().mockRejectedValue(error),
    };

    const cache = new RedisAdapter(client as never);

    await expect(cache.get('test:key')).resolves.toBeNull();
  });

  it('should degrade gracefully when Redis DELETE fails', async () => {
    const error = new Error('Redis unavailable');

    const client = {
      del: vi.fn().mockRejectedValue(error),
    };

    const cache = new RedisAdapter(client as never);

    await expect(cache.delete('test:key')).resolves.toBeUndefined();
  });
});
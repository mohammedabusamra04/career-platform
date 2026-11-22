import redisClient from '../../config/redis.js';
import { RedisAdapter } from '../../cache/redis.adapter.js';
import type { Cache } from '../../cache/cache.interface.js';
import { cacheKeys } from '../../cache/cache.keys.js';
import { CACHE_TTL } from '../../cache/cache.ttl.js';

import { AppError } from '../../shared/errors/AppError.js';

import type { UserPreferences } from './preference.types.js';
import type { ExperienceLevel, WorkType } from '../../shared/types/job.js';

import {
  isValidExperienceLevel,
  isValidWorkType,
  normalizeJobTitle,
  normalizeLocation,
  normalizeSkills,
  validateJobTitle,
} from './preference.validator.js';

import env from '../../config/env.js';

export class PreferenceService {
  constructor(private readonly cache: Cache) {}

  createPreferences(input: {
    jobTitle: string;
    workType: string;
    experienceLevel: string;
    location?: string;
    skills?: string;
    timezone?: string;
    notificationTimes?: string[];
  }): UserPreferences {
    const jobTitle = normalizeJobTitle(input.jobTitle);

    if (!validateJobTitle(jobTitle)) {
      throw AppError.badRequest('Invalid job title');
    }

    if (!isValidWorkType(input.workType)) {
      throw AppError.badRequest('Invalid work type');
    }

    if (!isValidExperienceLevel(input.experienceLevel)) {
      throw AppError.badRequest('Invalid experience level');
    }

    return {
      jobTitle,
      workType: input.workType as WorkType,
      experienceLevel: input.experienceLevel as ExperienceLevel,
      location: input.location ? normalizeLocation(input.location) : undefined,
      skills: input.skills ? normalizeSkills(input.skills) : undefined,
      timezone: input.timezone || env.timezone || 'Asia/Gaza',
      notificationTimes: input.notificationTimes || [env.dailyDigestTime],
    };
  }

  async savePreferences(userId: number, preferences: UserPreferences): Promise<void> {
    await this.cache.set(cacheKeys.preferences(String(userId)), preferences, CACHE_TTL.PREFERENCES);
  }

  async getPreferences(userId: number): Promise<UserPreferences | null> {
    return this.cache.get<UserPreferences>(cacheKeys.preferences(String(userId)));
  }

  async updatePreferences(userId: number, preferences: Partial<UserPreferences>): Promise<void> {
    const existing = await this.getPreferences(userId);

    if (!existing) {
      throw AppError.notFound('User preferences not found');
    }

    const updatedPreferences: UserPreferences = {
      ...existing,
      ...preferences,
    };

    await this.cache.set(
      cacheKeys.preferences(String(userId)),
      updatedPreferences,
      CACHE_TTL.PREFERENCES,
    );
  }

  async deletePreferences(userId: number): Promise<void> {
    await this.cache.delete(cacheKeys.preferences(String(userId)));
  }
}

const cache = new RedisAdapter(redisClient);

export const preferenceService = new PreferenceService(cache);

import { describe, expect, it, vi } from 'vitest';

import { PreferenceService } from '../../src/modules/preferences/preference.service.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';

describe('PreferenceService', () => {
  const createCacheMock = () => ({
    set: vi.fn(),
    setIfNotExists: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  });

  it('should create valid preferences with configured defaults', () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    const preferences = service.createPreferences({
      jobTitle: '  Backend   Developer  ',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      location: '  Gaza  ',
      skills: 'Node.js, TypeScript, Redis',
    });

    expect(preferences).toMatchObject({
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      location: 'Gaza',
      skills: ['Node.js', 'TypeScript', 'Redis'],
      timezone: 'Asia/Gaza',
    });
    expect(preferences.notificationTimes).toEqual(['21:00']);
  });

  it('should reject invalid job title', () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    expect(() =>
      service.createPreferences({
        jobTitle: 'A',
        workType: WorkType.REMOTE,
        experienceLevel: ExperienceLevel.JUNIOR,
      }),
    ).toThrow('Invalid job title');
  });

  it('should reject invalid work type', () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    expect(() =>
      service.createPreferences({
        jobTitle: 'Backend Developer',
        workType: 'invalid',
        experienceLevel: ExperienceLevel.JUNIOR,
      }),
    ).toThrow('Invalid work type');
  });

  it('should reject invalid experience level', () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    expect(() =>
      service.createPreferences({
        jobTitle: 'Backend Developer',
        workType: WorkType.REMOTE,
        experienceLevel: 'invalid',
      }),
    ).toThrow('Invalid experience level');
  });

  it('should save preferences', async () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    const preferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    };

    await service.savePreferences(123, preferences);

    expect(cache.set).toHaveBeenCalledWith('preferences:123', preferences, expect.any(Number));
  });

  it('should retrieve preferences', async () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    const preferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '18:00'],
    };

    vi.mocked(cache.get).mockResolvedValue(preferences);

    const result = await service.getPreferences(123);

    expect(result).toEqual(preferences);
    expect(cache.get).toHaveBeenCalledWith('preferences:123');
  });

  it('should update preferences', async () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    const existing = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '18:00'],
    };

    vi.mocked(cache.get).mockResolvedValue(existing);

    await service.updatePreferences(123, {
      experienceLevel: ExperienceLevel.MID,
    });

    expect(cache.set).toHaveBeenCalledWith(
      'preferences:123',
      {
        ...existing,
        experienceLevel: ExperienceLevel.MID,
      },
      expect.any(Number),
    );
  });

  it('should throw when preferences do not exist', async () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    vi.mocked(cache.get).mockResolvedValue(null);

    await expect(
      service.updatePreferences(123, {
        experienceLevel: ExperienceLevel.MID,
      }),
    ).rejects.toThrow('User preferences not found');
  });

  it('should delete preferences', async () => {
    const cache = createCacheMock();
    const service = new PreferenceService(cache);

    await service.deletePreferences(123);

    expect(cache.delete).toHaveBeenCalledWith('preferences:123');
  });
});

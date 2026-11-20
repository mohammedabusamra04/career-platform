import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import type { Job } from '../../src/modules/jobs/job.types.js';

import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';

import type { UserPreferences } from '../../src/modules/preferences/preference.types.js';

import { AIProviderError } from '../../src/modules/matching/ai/ai-provider.error.js';
import { GeminiProvider } from '../../src/modules/matching/ai/gemini.provider.js';

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock,
    };
  },
}));

beforeEach(() => {
  generateContentMock.mockReset();
  vi.useRealTimers();
});

const preferences: UserPreferences = {
  jobTitle: 'Backend Developer',
  workType: WorkType.REMOTE,
  experienceLevel: ExperienceLevel.JUNIOR,
  location: 'Palestine',
  skills: ['Node.js', 'TypeScript'],
  timezone: 'Asia/Gaza',
  notificationTimes: ['09:00', '21:00'],
};

const job: Job = {
  title: 'Backend Developer',
  company: 'Test Company',
  source: JobSourceType.OTHER,
  applicationUrl: 'https://example.com',
  url: 'https://example.com',
  location: 'Palestine',
  country: 'Palestine',
  workType: WorkType.REMOTE,
  experienceLevel: ExperienceLevel.JUNIOR,
  description: 'Backend development using Node.js and TypeScript.',
  skills: ['Node.js', 'TypeScript'],
  publicationDate: new Date(),
  scrapedAt: new Date(),
};

describe('GeminiProvider', () => {
  it('should return a valid matching result', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        score: 90,
        reason: 'Strong match',
      }),
    });

    const provider = new GeminiProvider();

    const result = await provider.match({
      job,
      preferences,
    });

    expect(result).toEqual({
      score: 90,
      reason: 'Strong match',
    });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('should throw AIProviderError for invalid JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: 'invalid json',
    });

    const provider = new GeminiProvider();

    await expect(
      provider.match({
        job,
        preferences,
      }),
    ).rejects.toThrow(AIProviderError);
  });

  it('should throw AIProviderError for invalid score', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        score: 150,
        reason: 'Strong match',
      }),
    });

    const provider = new GeminiProvider();

    await expect(
      provider.match({
        job,
        preferences,
      }),
    ).rejects.toThrow(AIProviderError);
  });

  it('should throw AIProviderError for invalid reason', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        score: 90,
        reason: 123,
      }),
    });

    const provider = new GeminiProvider();

    await expect(
      provider.match({
        job,
        preferences,
      }),
    ).rejects.toThrow(AIProviderError);
  });

  it('should throw AIProviderError for an empty response', async () => {
    generateContentMock.mockResolvedValue({
      text: undefined,
    });

    const provider = new GeminiProvider();

    await expect(
      provider.match({
        job,
        preferences,
      }),
    ).rejects.toThrow(AIProviderError);
  });

  it('should throw AIProviderError when Gemini API fails', async () => {
    generateContentMock.mockRejectedValue(new Error('Gemini API failed'));

    const provider = new GeminiProvider();

    await expect(
      provider.match({
        job,
        preferences,
      }),
    ).rejects.toThrow(AIProviderError);
  });

  it('should retry on transient Gemini errors then succeed', async () => {
    vi.useFakeTimers();

    const transientError = Object.assign(new Error('Overloaded'), { status: 503 });

    generateContentMock
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          score: 85,
          reason: 'Good match after retry',
        }),
      });

    const provider = new GeminiProvider();

    const matchPromise = provider.match({
      job,
      preferences,
    });

    await vi.runAllTimersAsync();
    const result = await matchPromise;

    expect(result).toEqual({
      score: 85,
      reason: 'Good match after retry',
    });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('should parse JSON wrapped in markdown fences', async () => {
    generateContentMock.mockResolvedValue({
      text: '```json\n{"score": 70, "reason": "Partial match"}\n```',
    });

    const provider = new GeminiProvider();

    const result = await provider.match({
      job,
      preferences,
    });

    expect(result).toEqual({
      score: 70,
      reason: 'Partial match',
    });
  });

  it('should throw AIProviderError when no API key is provided', () => {
    expect(() => new GeminiProvider([])).toThrow(AIProviderError);
  });

  it('should generate raw text via generateText (TASK-31.2)', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"specialization": "DEVOPS", "confidence": 0.9, "reasoning": "Platform engineering"}',
    });

    const provider = new GeminiProvider();
    const text = await provider.generateText('Classify role');

    expect(text).toContain('DEVOPS');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

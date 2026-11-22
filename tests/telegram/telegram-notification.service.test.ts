import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramNotificationService } from '../../src/modules/notifications/telegram/telegram-notification.service.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';

describe('TelegramNotificationService', () => {
  let api: { sendMessage: ReturnType<typeof vi.fn> };
  let service: TelegramNotificationService;

  const dummyJob: Job = {
    title: 'Node.js Developer',
    company: 'Acme Corp',
    source: JobSourceType.ARBEITNOW,
    applicationUrl: 'https://example.com/apply',
    url: 'https://example.com/apply',
    location: 'Remote',
    skills: ['Node.js'],
    publicationDate: new Date(),
    scrapedAt: new Date(),
  };

  beforeEach(() => {
    api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    };
    service = new TelegramNotificationService(api as never);
  });

  it('should send job message with inline Apply Now keyboard', async () => {
    await service.sendJob(123456, {
      job: dummyJob,
      score: 95,
      reason: 'Matches skills',
    });

    expect(api.sendMessage).toHaveBeenCalledWith(
      123456,
      expect.stringContaining('Node.js Developer'),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: 'Apply Now', url: 'https://example.com/apply' }]],
        },
      }),
    );
  });

  it('should send no-match notification when job list is empty', async () => {
    await service.sendJobs(123456, []);
    expect(api.sendMessage).toHaveBeenCalledWith(
      123456,
      expect.stringContaining('No new jobs matching your preferences were found'),
    );
  });

  it('should send a single digest message capped at 20 jobs with apply inline buttons, qualitative match tone, and disabled link previews', async () => {
    const manyJobs = Array.from({ length: 25 }, (_, i) => ({
      job: {
        ...dummyJob,
        title: `Backend Role ${i + 1}`,
        applicationUrl: `https://example.com/apply/${i + 1}`,
        url: `https://example.com/apply/${i + 1}`,
      },
      score: 85,
      reason: 'Strong match',
    }));

    await service.sendJobs(123456, manyJobs);

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const [, messageText, options] = api.sendMessage.mock.calls[0];
    expect(messageText).toContain('Backend Role 1');
    expect(messageText).toContain('Backend Role 20');
    expect(messageText).not.toContain('Backend Role 21');
    expect(messageText).toContain('تطابق قوي');
    expect(messageText).not.toContain('85%');
    expect(messageText).toContain('/jobs');
    expect(messageText).toContain('🔗 [تقديم مباشر](https://example.com/apply/1)');
    expect(options).toEqual(
      expect.objectContaining({
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true },
      }),
    );
  });

  it('should handle Telegram API error safely without throwing', async () => {
    api.sendMessage.mockRejectedValue(new Error('Telegram API unavailable'));
    await expect(
      service.sendJob(123456, {
        job: dummyJob,
        score: 90,
        reason: 'test',
      }),
    ).resolves.not.toThrow();
  });
});

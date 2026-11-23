import { describe, expect, it, vi } from 'vitest';

import { JobNotificationService } from '../../src/modules/notifications/jobNotification.service.js';
import type { Job } from '../../src/modules/jobs/job.types.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';

describe('JobNotificationService integration', () => {
  it('should collect, match, and send jobs to subscribed users', async () => {
    const job: Job = {
      title: 'Backend Developer',
      company: 'Tech Company',
      source: JobSourceType.LINKEDIN,
      applicationUrl: 'https://example.com/apply',
      url: 'https://example.com/apply',
      location: 'Remote',
      country: 'Palestine',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      skills: ['Node.js', 'TypeScript'],
      publicationDate: new Date(),
      scrapedAt: new Date(),
    };

    const preferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      location: 'Palestine',
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '18:00'],
      skills: ['Node.js', 'TypeScript'],
    };
    const matchedJob = {
      job,
      score: 92,
      reason: 'Strong match',
    };

    const jobCollectionService = {
      collectJobs: vi.fn().mockResolvedValue([job]),
    };

    const subscriptionService = {
      getSubscribedUsers: vi.fn().mockResolvedValue([123]),
      isSubscribed: vi.fn().mockResolvedValue(true),
    };

    const preferenceService = {
      getPreferences: vi.fn().mockResolvedValue(preferences),
    };

    const matchingService = {
      matchJobs: vi.fn().mockResolvedValue([matchedJob]),
    };

    const notificationService = {
      sendJobs: vi.fn().mockResolvedValue(undefined),
    };

    const service = new JobNotificationService(
      jobCollectionService,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
    );

    await service.run();

    expect(subscriptionService.getSubscribedUsers).toHaveBeenCalledTimes(1);
    expect(preferenceService.getPreferences).toHaveBeenCalledWith(123);
    expect(jobCollectionService.collectJobs).toHaveBeenCalledWith({
      jobTitle: preferences.jobTitle,
      workType: preferences.workType,
      experienceLevel: preferences.experienceLevel,
      location: preferences.location,
      skills: preferences.skills,
    });
    expect(matchingService.matchJobs).toHaveBeenCalledWith([job], preferences);
    expect(notificationService.sendJobs).toHaveBeenCalledWith(123, [matchedJob]);
  });
});

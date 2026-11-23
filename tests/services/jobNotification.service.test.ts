import { describe, expect, it, vi } from 'vitest';
import { JobNotificationService } from '../../src/modules/notifications/jobNotification.service.js';
import { JobSourceType, type Job } from '../../src/modules/jobs/job.types.js';
import type { MatchedJob } from '../../src/modules/matching/matching.service.js';
import type { UserPreferences } from '../../src/modules/preferences/preference.types.js';
import { ExperienceLevel, WorkType } from '../../src/shared/types/job.js';

describe('JobNotificationService', () => {
  const createJob = (): Job => ({
    title: 'Backend Developer',
    company: 'Example Company',
    source: JobSourceType.LINKEDIN,
    applicationUrl: 'https://example.com/apply',
    url: 'https://example.com/apply',
    skills: ['Node.js'],
    publicationDate: new Date(),
    publishedAt: new Date(),
    scrapedAt: new Date(),
  });

  const createMatchedJob = (): MatchedJob => ({
    job: createJob(),
    score: 90,
    reason: 'Strong match',
  });

  const createService = () => {
    const jobCollectionService = {
      collectJobs: vi.fn(),
    };

    const subscriptionService = {
      getSubscribedUsers: vi.fn(),
      isSubscribed: vi.fn().mockResolvedValue(true),
    };

    const preferenceService = {
      getPreferences: vi.fn(),
    };

    const matchingService = {
      matchJobs: vi.fn().mockResolvedValue([]),
    };

    const notificationService = {
      sendJobs: vi.fn(),
    };

    const service = new JobNotificationService(
      jobCollectionService as never,
      subscriptionService as never,
      preferenceService as never,
      matchingService as never,
      notificationService as never,
    );

    return {
      service,
      jobCollectionService,
      subscriptionService,
      preferenceService,
      matchingService,
      notificationService,
    };
  };

  it('should notify all subscribed users', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    const jobs = [createJob()];
    const preferences: UserPreferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    };
    const matchedJobs = [createMatchedJob()];

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101, 202]);
    vi.mocked(preferenceService.getPreferences).mockResolvedValue(preferences);
    vi.mocked(jobCollectionService.collectJobs).mockResolvedValue(jobs);
    vi.mocked(matchingService.matchJobs).mockResolvedValue(matchedJobs);

    await service.run();

    expect(notificationService.sendJobs).toHaveBeenCalledWith(101, matchedJobs);
    expect(notificationService.sendJobs).toHaveBeenCalledWith(202, matchedJobs);
  });

  it('should skip users without preferences', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101]);
    vi.mocked(preferenceService.getPreferences).mockResolvedValue(null);

    await service.run();

    expect(jobCollectionService.collectJobs).not.toHaveBeenCalled();
    expect(matchingService.matchJobs).not.toHaveBeenCalled();
    expect(notificationService.sendJobs).not.toHaveBeenCalled();
  });

  it('should collect jobs using user preferences', async () => {
    const { service, subscriptionService, preferenceService, jobCollectionService } =
      createService();

    const preferences: UserPreferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    };

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101]);
    vi.mocked(preferenceService.getPreferences).mockResolvedValue(preferences);
    vi.mocked(jobCollectionService.collectJobs).mockResolvedValue([]);

    await service.run();

    expect(jobCollectionService.collectJobs).toHaveBeenCalledWith({
      jobTitle: preferences.jobTitle,
      workType: preferences.workType,
      experienceLevel: preferences.experienceLevel,
      location: preferences.location,
      skills: preferences.skills,
    });
  });

  it('should not send notification when there are no matched jobs', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101]);
    vi.mocked(preferenceService.getPreferences).mockResolvedValue({
      jobTitle: 'Backend Developer',
      workType: 'remote',
      experienceLevel: 'junior',
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    });

    vi.mocked(jobCollectionService.collectJobs).mockResolvedValue([createJob()]);
    vi.mocked(matchingService.matchJobs).mockResolvedValue([]);

    await service.run();

    expect(notificationService.sendJobs).not.toHaveBeenCalled();
  });

  it('should send matched jobs to the user', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    const matchedJobs = [createMatchedJob()];

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101]);
    vi.mocked(preferenceService.getPreferences).mockResolvedValue({
      jobTitle: 'Backend Developer',
      workType: 'remote',
      experienceLevel: 'junior',
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    });

    vi.mocked(jobCollectionService.collectJobs).mockResolvedValue([createJob()]);
    vi.mocked(matchingService.matchJobs).mockResolvedValue(matchedJobs);

    await service.run();

    expect(notificationService.sendJobs).toHaveBeenCalledWith(101, matchedJobs);
  });

  it('should continue processing other users when one user fails', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    const preferences: UserPreferences = {
      jobTitle: 'Backend Developer',
      workType: WorkType.REMOTE,
      experienceLevel: ExperienceLevel.JUNIOR,
      timezone: 'Asia/Gaza',
      notificationTimes: ['09:00', '21:00'],
    };

    const matchedJobs = [createMatchedJob()];

    vi.mocked(subscriptionService.getSubscribedUsers).mockResolvedValue([101, 202]);
    vi.mocked(preferenceService.getPreferences)
      .mockRejectedValueOnce(new Error('Preference error'))
      .mockResolvedValueOnce(preferences);

    vi.mocked(jobCollectionService.collectJobs).mockResolvedValue([createJob()]);
    vi.mocked(matchingService.matchJobs).mockResolvedValue(matchedJobs);

    await service.run();

    expect(notificationService.sendJobs).toHaveBeenCalledWith(202, matchedJobs);
  });

  it('should not notify an unsubscribed user', async () => {
    const {
      service,
      subscriptionService,
      preferenceService,
      jobCollectionService,
      matchingService,
      notificationService,
    } = createService();

    vi.mocked(subscriptionService.isSubscribed).mockResolvedValue(false);

    await service.runForUser(101);

    expect(preferenceService.getPreferences).not.toHaveBeenCalled();
    expect(jobCollectionService.collectJobs).not.toHaveBeenCalled();
    expect(matchingService.matchJobs).not.toHaveBeenCalled();
    expect(notificationService.sendJobs).not.toHaveBeenCalled();
  });
});

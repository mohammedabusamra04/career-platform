import type { JobSearchQuery, Job } from '../jobs/job.types.js';
import type { MatchedJob } from '../matching/matching.service.js';
import type { UserPreferences } from '../preferences/preference.types.js';

interface JobCollector {
  collectJobs(query: JobSearchQuery): Promise<Job[]>;
}

interface SubscriptionReader {
  getSubscribedUsers(): Promise<number[]>;
  isSubscribed(userId: number): Promise<boolean>;
}

interface PreferenceReader {
  getPreferences(userId: number): Promise<UserPreferences | null>;
}

interface JobMatcher {
  matchJobs(jobs: Job[], preferences: UserPreferences): Promise<MatchedJob[]>;
}

interface JobNotifier {
  sendJobs(chatId: number, matchedJobs: MatchedJob[]): Promise<void>;
}

export class JobNotificationService {
  constructor(
    private readonly jobCollectionService: JobCollector,
    private readonly subscriptionService: SubscriptionReader,
    private readonly preferenceService: PreferenceReader,
    private readonly matchingService: JobMatcher,
    private readonly notificationService: JobNotifier,
  ) {}

  async run(): Promise<void> {
    const subscribers = await this.subscriptionService.getSubscribedUsers();

    for (const userId of subscribers) {
      await this.runForUser(userId);
    }
  }

  async runForUser(userId: number): Promise<void> {
    try {
      const isSubscribed = await this.subscriptionService.isSubscribed(userId);

      if (!isSubscribed) {
        return;
      }
      const preferences = await this.preferenceService.getPreferences(userId);

      if (!preferences) {
        return;
      }

      const jobs = await this.jobCollectionService.collectJobs({
        jobTitle: preferences.jobTitle,
        workType: preferences.workType,
        experienceLevel: preferences.experienceLevel,
        location: preferences.location,
        skills: preferences.skills,
      });

      const matchedJobs = await this.matchingService.matchJobs(jobs, preferences);

      if (matchedJobs.length === 0) {
        return;
      }

      await this.notificationService.sendJobs(userId, matchedJobs);
    } catch (error) {
      console.error(`Failed to process notifications for user ${userId}:`, error);
    }
  }
}

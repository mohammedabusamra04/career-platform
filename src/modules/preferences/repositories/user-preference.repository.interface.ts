import type {
  Specialization,
  RegionPreference,
} from '../preference.taxonomy.js';
import type { UserPreferenceInput } from '../preference.schema.js';

export interface UserPreferenceEntity {
  id: string;
  userId: string;
  specializations: Specialization[];
  regionPreference: RegionPreference;
  experienceLevel: string | null;
  workType: string | null;
  preferenceHash: string;
  updatedAt: Date;
}

export interface UserPreferenceGroup {
  preferenceHash: string;
  specializations: Specialization[];
  regionPreference: RegionPreference;
  experienceLevel: string | null;
  workType: string | null;
  userIds: string[];
}

export interface IUserPreferenceRepository {
  savePreferences(
    userId: string,
    data: UserPreferenceInput,
  ): Promise<UserPreferenceEntity>;

  findByUserId(userId: string): Promise<UserPreferenceEntity | null>;

  findByPreferenceHash(preferenceHash: string): Promise<UserPreferenceEntity[]>;

  findEquivalenceGroups(options?: {
    eligibleOnly?: boolean;
    now?: Date;
  }): Promise<Map<string, UserPreferenceGroup>>;

  deleteByUserId(userId: string): Promise<void>;
}

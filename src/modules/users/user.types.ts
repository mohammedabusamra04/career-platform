export enum UserStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  BLOCKED = 'BLOCKED',
  DELETED = 'DELETED',
}

export interface User {
  id: string;
  telegramId: number;
  firstName: string | null;
  username: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  pausedUntil: Date | null;
}

export interface CreateUserInput {
  telegramId: number | bigint;
  firstName?: string | null;
  username?: string | null;
  status?: UserStatus;
}

export interface UpdateUserStatusInput {
  status: UserStatus;
  pausedUntil?: Date | null;
}

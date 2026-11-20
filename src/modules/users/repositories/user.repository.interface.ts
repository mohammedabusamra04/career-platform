import type { User, UserStatus, CreateUserInput } from '../user.types.js';

export interface IUserRepository {
  findByTelegramId(telegramId: number | bigint): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserInput): Promise<User>;
  updateStatus(
    telegramId: number | bigint,
    status: UserStatus,
    pausedUntil?: Date | null,
  ): Promise<User>;
  updateStatusById(
    id: string,
    status: UserStatus,
    pausedUntil?: Date | null,
  ): Promise<User>;
  markAsDeleted(telegramId: number | bigint): Promise<User>;
  findActiveRecipients(now?: Date): Promise<User[]>;
}

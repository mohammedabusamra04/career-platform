import type { PrismaClient, User as PrismaUserRecord } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../shared/database/prisma.service.js';
import type { IUserRepository } from './user.repository.interface.js';
import {
  UserStatus,
  type User,
  type CreateUserInput,
} from '../user.types.js';
import { assertValidTransition } from '../user.state-machine.js';

export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async findByTelegramId(telegramId: number | bigint): Promise<User | null> {
    const record = await this.db.user.findUnique({
      where: {
        telegramId: BigInt(telegramId),
      },
    });

    return record ? this.mapToDomain(record) : null;
  }

  public async findById(id: string): Promise<User | null> {
    const record = await this.db.user.findUnique({
      where: { id },
    });

    return record ? this.mapToDomain(record) : null;
  }

  public async create(data: CreateUserInput): Promise<User> {
    const record = await this.db.user.upsert({
      where: {
        telegramId: BigInt(data.telegramId),
      },
      update: {
        firstName: data.firstName ?? null,
        username: data.username ?? null,
        status: (data.status ?? UserStatus.ACTIVE) as PrismaUserRecord['status'],
        pausedUntil: null,
      },
      create: {
        telegramId: BigInt(data.telegramId),
        firstName: data.firstName ?? null,
        username: data.username ?? null,
        status: (data.status ?? UserStatus.ACTIVE) as PrismaUserRecord['status'],
      },
    });

    return this.mapToDomain(record);
  }

  public async updateStatus(
    telegramId: number | bigint,
    status: UserStatus,
    pausedUntil: Date | null = null,
  ): Promise<User> {
    const existing = await this.db.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    if (!existing) {
      throw new Error(`User with telegramId ${telegramId.toString()} does not exist.`);
    }

    assertValidTransition(existing.status as UserStatus, status);

    const updated = await this.db.user.update({
      where: { telegramId: BigInt(telegramId) },
      data: {
        status: status as PrismaUserRecord['status'],
        pausedUntil: status === UserStatus.PAUSED ? pausedUntil : null,
      },
    });

    return this.mapToDomain(updated);
  }

  public async updateStatusById(
    id: string,
    status: UserStatus,
    pausedUntil: Date | null = null,
  ): Promise<User> {
    const existing = await this.db.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error(`User with id ${id} does not exist.`);
    }

    assertValidTransition(existing.status as UserStatus, status);

    const updated = await this.db.user.update({
      where: { id },
      data: {
        status: status as PrismaUserRecord['status'],
        pausedUntil: status === UserStatus.PAUSED ? pausedUntil : null,
      },
    });

    return this.mapToDomain(updated);
  }

  public async markAsDeleted(telegramId: number | bigint): Promise<User> {
    const existing = await this.db.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    if (!existing) {
      throw new Error(`User with telegramId ${telegramId.toString()} does not exist.`);
    }

    assertValidTransition(existing.status as UserStatus, UserStatus.DELETED);

    const anonymized = await this.db.user.update({
      where: { telegramId: BigInt(telegramId) },
      data: {
        firstName: null,
        username: null,
        status: UserStatus.DELETED,
        pausedUntil: null,
      },
    });

    return this.mapToDomain(anonymized);
  }

  public async findActiveRecipients(now: Date = new Date()): Promise<User[]> {
    const records = await this.db.user.findMany({
      where: {
        OR: [
          { status: UserStatus.ACTIVE },
          {
            status: UserStatus.PAUSED,
            pausedUntil: {
              lte: now,
            },
          },
        ],
      },
    });

    return records.map((record) => this.mapToDomain(record));
  }

  private mapToDomain(row: PrismaUserRecord): User {
    return {
      id: row.id,
      telegramId: Number(row.telegramId),
      firstName: row.firstName,
      username: row.username,
      status: row.status as UserStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      pausedUntil: row.pausedUntil,
    };
  }
}

export const userRepository = new PrismaUserRepository();

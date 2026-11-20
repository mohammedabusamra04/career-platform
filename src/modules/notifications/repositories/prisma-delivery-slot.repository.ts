import type {
  PrismaClient,
  DeliverySlot as PrismaDeliverySlotRecord,
  DigestDelivery as PrismaDigestDeliveryRecord,
  DeliveryStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../../shared/database/prisma.service.js';
import type {
  IDeliverySlotRepository,
  DeliverySlotEntity,
  DigestDeliveryEntity,
  DeliveryStatusUpdate,
} from './delivery-slot.repository.interface.js';

export function generateSlotKey(scheduledTime: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = scheduledTime.getUTCFullYear();
  const month = pad(scheduledTime.getUTCMonth() + 1);
  const day = pad(scheduledTime.getUTCDate());
  const hours = pad(scheduledTime.getUTCHours());
  const minutes = pad(scheduledTime.getUTCMinutes());
  return `digest:${year}-${month}-${day}:${hours}${minutes}`;
}

export class PrismaDeliverySlotRepository implements IDeliverySlotRepository {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async reconnect(): Promise<void> {
    if (typeof (this.db as any).reconnect === 'function') {
      await (this.db as any).reconnect();
    }
  }

  public async getOrCreateSlot(
    scheduledTime: Date,
    totalEligibleUsers: number = 0,
    customSlotKey?: string,
  ): Promise<DeliverySlotEntity> {
    const slotKey = customSlotKey ?? generateSlotKey(scheduledTime);

    const existing = await this.db.deliverySlot.findUnique({
      where: { slotKey },
    });

    if (existing) {
      return this.mapSlotToEntity(existing);
    }

    const created = await this.db.deliverySlot.create({
      data: {
        slotKey,
        scheduledTime,
        status: 'PENDING',
        totalRecipients: totalEligibleUsers,
        startedAt: new Date(),
      },
    });

    return this.mapSlotToEntity(created);
  }

  public async findSlotByKey(slotKey: string): Promise<DeliverySlotEntity | null> {
    const record = await this.db.deliverySlot.findUnique({
      where: { slotKey },
    });

    return record ? this.mapSlotToEntity(record) : null;
  }

  public async findSlotById(slotId: string): Promise<DeliverySlotEntity | null> {
    const record = await this.db.deliverySlot.findUnique({
      where: { id: slotId },
    });

    return record ? this.mapSlotToEntity(record) : null;
  }

  public async findUnfinishedSlots(): Promise<DeliverySlotEntity[]> {
    const records = await this.db.deliverySlot.findMany({
      where: {
        completedAt: null,
        status: {
          in: ['PENDING', 'FAILED'],
        },
      },
      orderBy: {
        scheduledTime: 'asc',
      },
    });

    return records.map((r) => this.mapSlotToEntity(r));
  }

  public async initializeDeliveries(
    slotId: string,
    userIds: string[],
  ): Promise<number> {
    if (!userIds || userIds.length === 0) {
      return 0;
    }

    const data = userIds.map((userId) => ({
      slotId,
      userId,
      status: 'PENDING' as DeliveryStatus,
      attempts: 0,
    }));

    const result = await this.db.digestDelivery.createMany({
      data,
      skipDuplicates: true,
    });

    return result.count;
  }

  public async getPendingDeliveries(
    slotId: string,
    limit?: number,
  ): Promise<DigestDeliveryEntity[]> {
    const records = await this.db.digestDelivery.findMany({
      where: {
        slotId,
        status: {
          in: ['PENDING', 'FAILED'],
        },
      },
      orderBy: {
        attempts: 'asc',
      },
      take: limit,
    });

    return records.map((r) => this.mapDeliveryToEntity(r));
  }

  public async getPendingDeliveriesChunk(
    slotId: string,
    limit: number = 25,
    cursorId?: string,
  ): Promise<DigestDeliveryEntity[]> {
    const records = await this.db.digestDelivery.findMany({
      where: {
        slotId,
        status: {
          in: ['PENDING', 'FAILED'],
        },
      },
      orderBy: {
        id: 'asc',
      },
      take: limit,
      skip: cursorId ? 1 : 0,
      cursor: cursorId ? { id: cursorId } : undefined,
    });

    return records.map((r) => this.mapDeliveryToEntity(r));
  }

  public async updateDeliveryStatus(
    slotId: string,
    userId: string,
    status: DeliveryStatus,
    lastError?: string | null,
  ): Promise<DigestDeliveryEntity> {
    const now = new Date();
    const isSuccess = status === 'SENT';
    const isFailure = status === 'FAILED' || status === 'BLOCKED';

    const [updatedDelivery] = await this.db.$transaction([
      this.db.digestDelivery.update({
        where: {
          slotId_userId: { slotId, userId },
        },
        data: {
          status,
          lastError: lastError ?? null,
          deliveredAt: isSuccess ? now : undefined,
          attempts: { increment: 1 },
        },
      }),
      this.db.deliverySlot.update({
        where: { id: slotId },
        data: {
          sentCount: isSuccess ? { increment: 1 } : undefined,
          failedCount: isFailure ? { increment: 1 } : undefined,
        },
      }),
    ]);

    return this.mapDeliveryToEntity(updatedDelivery);
  }

  public async updateBatchDeliveryStatus(
    slotId: string,
    updates: DeliveryStatusUpdate[],
  ): Promise<void> {
    if (!updates || updates.length === 0) {
      return;
    }

    const now = new Date();
    let sentInc = 0;
    let failedInc = 0;

    for (const update of updates) {
      if (update.status === 'SENT') sentInc++;
      else if (update.status === 'FAILED' || update.status === 'BLOCKED') failedInc++;
    }

    await this.db.$transaction(async (tx) => {
      for (const update of updates) {
        await tx.digestDelivery.update({
          where: {
            slotId_userId: {
              slotId,
              userId: update.userId,
            },
          },
          data: {
            status: update.status,
            lastError: update.lastError ?? null,
            deliveredAt: update.status === 'SENT' ? now : undefined,
            attempts: { increment: 1 },
          },
        });
      }

      await tx.deliverySlot.update({
        where: { id: slotId },
        data: {
          sentCount: sentInc > 0 ? { increment: sentInc } : undefined,
          failedCount: failedInc > 0 ? { increment: failedInc } : undefined,
        },
      });
    });
  }

  public async completeSlot(slotId: string): Promise<DeliverySlotEntity> {
    const slot = await this.db.deliverySlot.findUnique({
      where: { id: slotId },
    });

    if (!slot) {
      throw new Error(`Delivery slot not found with id: ${slotId}`);
    }

    const finalStatus: DeliveryStatus =
      slot.failedCount === 0 && slot.sentCount > 0 ? 'SENT' : slot.failedCount > 0 ? 'FAILED' : 'SENT';

    const updated = await this.db.deliverySlot.update({
      where: { id: slotId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
      },
    });

    return this.mapSlotToEntity(updated);
  }

  public async markSlotSkippedExpired(
    slotKey: string,
    scheduledTime: Date,
  ): Promise<DeliverySlotEntity> {
    const existing = await this.db.deliverySlot.findUnique({
      where: { slotKey },
    });

    if (existing) {
      if (existing.completedAt !== null || existing.status === 'SENT') {
        return this.mapSlotToEntity(existing);
      }

      // Safe conditional update requiring slot to still be unfinished
      const updateResult = await this.db.deliverySlot.updateMany({
        where: {
          id: existing.id,
          completedAt: null,
          status: { notIn: ['SENT', 'SKIPPED_EXPIRED'] },
        },
        data: {
          status: 'SKIPPED_EXPIRED',
          completedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        // Slot completed concurrently; refetch without overwriting
        const reloaded = await this.db.deliverySlot.findUnique({
          where: { id: existing.id },
        });
        return this.mapSlotToEntity(reloaded ?? existing);
      }

      const updated = await this.db.deliverySlot.findUnique({
        where: { id: existing.id },
      });
      return this.mapSlotToEntity(updated ?? existing);
    }

    const created = await this.db.deliverySlot.create({
      data: {
        slotKey,
        scheduledTime,
        status: 'SKIPPED_EXPIRED',
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        completedAt: new Date(),
      },
    });

    return this.mapSlotToEntity(created);
  }

  private mapSlotToEntity(row: PrismaDeliverySlotRecord): DeliverySlotEntity {
    return {
      id: row.id,
      slotKey: row.slotKey,
      scheduledTime: row.scheduledTime,
      status: row.status,
      totalRecipients: row.totalRecipients,
      sentCount: row.sentCount,
      failedCount: row.failedCount,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  private mapDeliveryToEntity(row: PrismaDigestDeliveryRecord): DigestDeliveryEntity {
    return {
      id: row.id,
      slotId: row.slotId,
      userId: row.userId,
      status: row.status,
      lastError: row.lastError,
      deliveredAt: row.deliveredAt,
      attempts: row.attempts,
    };
  }
}

export const deliverySlotRepository = new PrismaDeliverySlotRepository();

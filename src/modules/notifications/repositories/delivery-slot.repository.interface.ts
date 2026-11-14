import type { DeliveryStatus } from '@prisma/client';

export interface DeliverySlotEntity {
  id: string;
  slotKey: string;
  scheduledTime: Date;
  status: DeliveryStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface DigestDeliveryEntity {
  id: string;
  slotId: string;
  userId: string;
  status: DeliveryStatus;
  lastError: string | null;
  deliveredAt: Date | null;
  attempts: number;
}

export interface DeliveryStatusUpdate {
  userId: string;
  status: DeliveryStatus;
  lastError?: string | null;
}

export interface IDeliverySlotRepository {
  getOrCreateSlot(
    scheduledTime: Date,
    totalEligibleUsers?: number,
    customSlotKey?: string,
  ): Promise<DeliverySlotEntity>;

  findSlotByKey(slotKey: string): Promise<DeliverySlotEntity | null>;
  findSlotById(slotId: string): Promise<DeliverySlotEntity | null>;
  findUnfinishedSlots(): Promise<DeliverySlotEntity[]>;

  initializeDeliveries(slotId: string, userIds: string[]): Promise<number>;

  getPendingDeliveries(
    slotId: string,
    limit?: number,
  ): Promise<DigestDeliveryEntity[]>;

  getPendingDeliveriesChunk(
    slotId: string,
    limit?: number,
    cursorId?: string,
  ): Promise<DigestDeliveryEntity[]>;

  updateDeliveryStatus(
    slotId: string,
    userId: string,
    status: DeliveryStatus,
    lastError?: string | null,
  ): Promise<DigestDeliveryEntity>;

  updateBatchDeliveryStatus(
    slotId: string,
    updates: DeliveryStatusUpdate[],
  ): Promise<void>;

  completeSlot(slotId: string): Promise<DeliverySlotEntity>;
}

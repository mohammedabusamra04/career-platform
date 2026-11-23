import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaDeliverySlotRepository,
  generateSlotKey,
} from '../../../src/modules/notifications/index.js';

describe('PrismaDeliverySlotRepository - Slot-Based Delivery Tracking (TASK-24.1)', () => {
  let mockPrisma: any;
  let repository: PrismaDeliverySlotRepository;

  const sampleSlotRecord = {
    id: 'slot-uuid-1',
    slotKey: 'digest:2026-10-28:0900',
    scheduledTime: new Date('2026-10-28T09:00:00Z'),
    status: 'PENDING',
    totalRecipients: 100,
    sentCount: 0,
    failedCount: 0,
    startedAt: new Date('2026-10-28T09:00:01Z'),
    completedAt: null,
  };

  beforeEach(() => {
    mockPrisma = {
      deliverySlot: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      digestDelivery: {
        createMany: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        return Promise.all(arg);
      }),
    };
    repository = new PrismaDeliverySlotRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('generateSlotKey', () => {
    it('generates consistent slot key format digest:YYYY-MM-DD:HHMM in UTC', () => {
      const scheduled = new Date('2026-10-28T09:00:00Z');
      expect(generateSlotKey(scheduled)).toBe('digest:2026-10-28:0900');

      const evening = new Date('2026-10-28T18:30:00Z');
      expect(generateSlotKey(evening)).toBe('digest:2026-10-28:1830');
    });
  });

  describe('getOrCreateSlot', () => {
    it('creates new delivery slot when not already present', async () => {
      mockPrisma.deliverySlot.findUnique.mockResolvedValue(null);
      mockPrisma.deliverySlot.create.mockResolvedValue(sampleSlotRecord);

      const scheduled = new Date('2026-10-28T09:00:00Z');
      const slot = await repository.getOrCreateSlot(scheduled, 100);

      expect(mockPrisma.deliverySlot.findUnique).toHaveBeenCalledWith({
        where: { slotKey: 'digest:2026-10-28:0900' },
      });
      expect(mockPrisma.deliverySlot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slotKey: 'digest:2026-10-28:0900',
          totalRecipients: 100,
          status: 'PENDING',
        }),
      });
      expect(slot.slotKey).toBe('digest:2026-10-28:0900');
    });

    it('returns existing slot if already created without inserting duplicates', async () => {
      mockPrisma.deliverySlot.findUnique.mockResolvedValue(sampleSlotRecord);

      const scheduled = new Date('2026-10-28T09:00:00Z');
      const slot = await repository.getOrCreateSlot(scheduled, 100);

      expect(mockPrisma.deliverySlot.create).not.toHaveBeenCalled();
      expect(slot.id).toBe('slot-uuid-1');
    });
  });

  describe('initializeDeliveries', () => {
    it('initializes deliveries with status PENDING and skipDuplicates', async () => {
      mockPrisma.digestDelivery.createMany.mockResolvedValue({ count: 3 });

      const count = await repository.initializeDeliveries('slot-uuid-1', ['u1', 'u2', 'u3']);

      expect(mockPrisma.digestDelivery.createMany).toHaveBeenCalledWith({
        data: [
          { slotId: 'slot-uuid-1', userId: 'u1', status: 'PENDING', attempts: 0 },
          { slotId: 'slot-uuid-1', userId: 'u2', status: 'PENDING', attempts: 0 },
          { slotId: 'slot-uuid-1', userId: 'u3', status: 'PENDING', attempts: 0 },
        ],
        skipDuplicates: true,
      });
      expect(count).toBe(3);
    });

    it('returns 0 when userIds array is empty', async () => {
      const count = await repository.initializeDeliveries('slot-uuid-1', []);
      expect(count).toBe(0);
      expect(mockPrisma.digestDelivery.createMany).not.toHaveBeenCalled();
    });
  });

  describe('Crash Recovery & Resumption Simulation (Test Specification)', () => {
    it('simulates server crash after 30 deliveries out of 100 and resumes strictly remaining 70 users with 0 duplicates', async () => {
      // Simulate 100 users: u1 to u100
      const allUsers = Array.from({ length: 100 }, (_, i) => `u${i + 1}`);

      // First 30 were SENT before container crashed
      const sentUsers = allUsers.slice(0, 30);
      // Remaining 70 were PENDING
      const remainingUsers = allUsers.slice(30);

      // When recovery worker restarts and queries pending deliveries:
      mockPrisma.digestDelivery.findMany.mockImplementation(async (args: any) => {
        expect(args.where.slotId).toBe('slot-uuid-1');
        expect(args.where.status.in).toEqual(['PENDING', 'FAILED']);

        // Return only remaining 70 users whose status is PENDING
        return remainingUsers.map((uid, idx) => ({
          id: `del-${idx + 31}`,
          slotId: 'slot-uuid-1',
          userId: uid,
          status: 'PENDING',
          lastError: null,
          deliveredAt: null,
          attempts: 0,
        }));
      });

      const pendingForResume = await repository.getPendingDeliveries('slot-uuid-1');

      // Verify that exactly 70 users need delivery
      expect(pendingForResume).toHaveLength(70);

      // Verify that NONE of the first 30 users are re-sent (0 duplicates)
      const pendingUserIds = new Set(pendingForResume.map((d) => d.userId));
      for (const sentUid of sentUsers) {
        expect(pendingUserIds.has(sentUid)).toBe(false);
      }

      // Verify that all remaining 70 users are included
      for (const remUid of remainingUsers) {
        expect(pendingUserIds.has(remUid)).toBe(true);
      }
    });
  });

  describe('updateDeliveryStatus & updateBatchDeliveryStatus', () => {
    it('updates single delivery status and slot sent counter atomically', async () => {
      mockPrisma.digestDelivery.update.mockResolvedValue({
        id: 'del-1',
        slotId: 'slot-uuid-1',
        userId: 'u1',
        status: 'SENT',
        lastError: null,
        deliveredAt: new Date(),
        attempts: 1,
      });

      const result = await repository.updateDeliveryStatus('slot-uuid-1', 'u1', 'SENT');

      expect(mockPrisma.digestDelivery.update).toHaveBeenCalledWith({
        where: {
          slotId_userId: { slotId: 'slot-uuid-1', userId: 'u1' },
        },
        data: expect.objectContaining({
          status: 'SENT',
          deliveredAt: expect.any(Date),
          attempts: { increment: 1 },
        }),
      });
      expect(result.status).toBe('SENT');
    });

    it('updates batch of deliveries in transaction', async () => {
      mockPrisma.digestDelivery.update.mockResolvedValue({});
      mockPrisma.deliverySlot.update.mockResolvedValue({});

      await repository.updateBatchDeliveryStatus('slot-uuid-1', [
        { userId: 'u1', status: 'SENT' },
        { userId: 'u2', status: 'FAILED', lastError: 'Telegram 500' },
      ]);

      expect(mockPrisma.digestDelivery.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.deliverySlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-uuid-1' },
        data: {
          sentCount: { increment: 1 },
          failedCount: { increment: 1 },
        },
      });
    });
  });

  describe('completeSlot', () => {
    it('marks slot completed with SENT status when no failures occurred', async () => {
      mockPrisma.deliverySlot.findUnique.mockResolvedValue({
        ...sampleSlotRecord,
        sentCount: 100,
        failedCount: 0,
      });

      mockPrisma.deliverySlot.update.mockResolvedValue({
        ...sampleSlotRecord,
        status: 'SENT',
        completedAt: new Date(),
      });

      const completed = await repository.completeSlot('slot-uuid-1');

      expect(mockPrisma.deliverySlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-uuid-1' },
        data: expect.objectContaining({
          status: 'SENT',
          completedAt: expect.any(Date),
        }),
      });
      expect(completed.status).toBe('SENT');
    });
  });
});

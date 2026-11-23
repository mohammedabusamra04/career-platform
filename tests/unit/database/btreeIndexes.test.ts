import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('TASK-20.3: Scalability B-Tree & Composite Indexes for 10k+ Queries', () => {
  const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
  const migrationPath = path.resolve(
    process.cwd(),
    'prisma/migrations/20261024_init_v2_schema_and_indexes/migration.sql',
  );

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const migrationContent = fs.readFileSync(migrationPath, 'utf-8');

  describe('Unique B-Tree Indexes', () => {
    it('should define unique B-Tree index on User(telegramId)', () => {
      expect(schemaContent).toMatch(/telegramId\s+BigInt\s+@unique/);
      expect(migrationContent).toContain(
        'CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");',
      );
    });

    it('should define unique B-Tree index on Job(deduplicationKey)', () => {
      expect(schemaContent).toMatch(/deduplicationKey\s+String\s+@unique/);
      expect(migrationContent).toContain(
        'CREATE UNIQUE INDEX "Job_deduplicationKey_key" ON "Job"("deduplicationKey");',
      );
    });

    it('should define unique B-Tree index on DeliverySlot(slotKey)', () => {
      expect(schemaContent).toMatch(/slotKey\s+String\s+@unique/);
      expect(migrationContent).toContain(
        'CREATE UNIQUE INDEX "DeliverySlot_slotKey_key" ON "DeliverySlot"("slotKey");',
      );
    });

    it('should define unique composite index on SentJob(userId, jobId) for O(1) duplicate prevention', () => {
      expect(schemaContent).toContain('@@unique([userId, jobId])');
      expect(migrationContent).toContain(
        'CREATE UNIQUE INDEX "SentJob_userId_jobId_key" ON "SentJob"("userId", "jobId");',
      );
    });

    it('should define unique composite index on DigestDelivery(slotId, userId) for idempotency', () => {
      expect(schemaContent).toContain('@@unique([slotId, userId])');
      expect(migrationContent).toContain(
        'CREATE UNIQUE INDEX "DigestDelivery_slotId_userId_key" ON "DigestDelivery"("slotId", "userId");',
      );
    });
  });

  describe('Composite B-Tree Indexes for Query Performance', () => {
    it('should define composite index on Job(status, publishedAt DESC) for sub-second active job browsing', () => {
      expect(schemaContent).toContain('@@index([status, publishedAt(sort: Desc)])');
      expect(migrationContent).toContain(
        'CREATE INDEX "Job_status_publishedAt_idx" ON "Job"("status", "publishedAt" DESC);',
      );
    });

    it('should define composite index on Job(primarySpecialization, remoteScope, status) for candidate matching', () => {
      expect(schemaContent).toContain('@@index([primarySpecialization, remoteScope, status])');
      expect(migrationContent).toContain(
        'CREATE INDEX "Job_primarySpecialization_remoteScope_status_idx" ON "Job"("primarySpecialization", "remoteScope", "status");',
      );
    });

    it('should define composite index on DigestDelivery(slotId, status) for chunked 25/sec delivery', () => {
      expect(schemaContent).toContain('@@index([slotId, status])');
      expect(migrationContent).toContain(
        'CREATE INDEX "DigestDelivery_slotId_status_idx" ON "DigestDelivery"("slotId", "status");',
      );
    });

    it('should define composite index on SentJob(userId, sentAt DESC) for subscriber history pagination', () => {
      expect(schemaContent).toContain('@@index([userId, sentAt(sort: Desc)])');
      expect(migrationContent).toContain(
        'CREATE INDEX "SentJob_userId_sentAt_idx" ON "SentJob"("userId", "sentAt" DESC);',
      );
    });

    it('should define index on UserPreference(preferenceHash) for O(G * J) equivalence grouping', () => {
      expect(schemaContent).toContain('@@index([preferenceHash])');
      expect(migrationContent).toContain(
        'CREATE INDEX "UserPreference_preferenceHash_idx" ON "UserPreference"("preferenceHash");',
      );
    });
  });

  describe('Foreign Key Constraints and Cascades', () => {
    it('should enforce cascade deletion across user preferences and sent history', () => {
      expect(migrationContent).toContain(
        'ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE',
      );
      expect(migrationContent).toContain(
        'ALTER TABLE "SentJob" ADD CONSTRAINT "SentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE',
      );
      expect(migrationContent).toContain(
        'ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE',
      );
    });
  });
});

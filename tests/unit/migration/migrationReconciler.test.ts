import { describe, it, expect, vi } from 'vitest';
import ms from 'ms';
import {
  MigrationReconciler,
  type MigrationSubscriberRecord,
} from '../../../src/modules/migration/index.js';
import { Specialization, RegionPreference } from '../../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-48.2: MigrationReconciler Unit Tests (#135)', () => {
  const sampleRecords: MigrationSubscriberRecord[] = [
    {
      telegramId: 101n,
      status: 'ACTIVE',
      preferences: {
        specializations: [Specialization.BACKEND],
        regionPreference: RegionPreference.ARAB,
        experienceLevel: 'SENIOR',
        workType: 'FULL_TIME',
        preferenceHash: 'hash101',
      },
      taxonomyMapping: {} as any,
      isAmbiguous: false,
      needsReconfirmation: false,
      originalV1: { jobTitle: 'Backend Dev' },
    },
    {
      telegramId: 102n,
      status: 'ACTIVE',
      preferences: {
        specializations: [Specialization.FRONTEND],
        regionPreference: RegionPreference.INTERNATIONAL,
        experienceLevel: 'MID',
        workType: 'CONTRACT',
        preferenceHash: 'hash102',
      },
      taxonomyMapping: {} as any,
      isAmbiguous: false,
      needsReconfirmation: false,
      originalV1: { jobTitle: 'Frontend Dev' },
    },
    {
      telegramId: 103n,
      status: 'ACTIVE',
      preferences: {
        specializations: [Specialization.FULLSTACK],
        regionPreference: RegionPreference.BOTH,
        experienceLevel: null,
        workType: null,
        preferenceHash: 'hash103',
      },
      taxonomyMapping: {} as any,
      isAmbiguous: true,
      needsReconfirmation: true,
      originalV1: { jobTitle: 'IT Guy' },
    },
  ];

  it('generates an accurate dry-run audit report with taxonomy distribution and ms duration', () => {
    const report = MigrationReconciler.executeDryRun(sampleRecords, {
      durationMs: ms('50ms'),
    });

    expect(report.totalRedisSubscribers).toBe(3);
    expect(report.successfulMappings).toBe(2);
    expect(report.ambiguousMappings).toBe(1);
    expect(report.failedMappings).toBe(0);
    expect(report.status).toBe('PASSED');
    expect(report.durationFormatted).toBe('50ms');

    expect(report.specializationDistribution[Specialization.BACKEND]).toBe(1);
    expect(report.specializationDistribution[Specialization.FRONTEND]).toBe(1);
    expect(report.specializationDistribution[Specialization.FULLSTACK]).toBe(1);
  });

  it('renders a Markdown dry-run report table with headers and stats', () => {
    const report = MigrationReconciler.executeDryRun(sampleRecords, { durationMs: 10 });
    const markdown = MigrationReconciler.generateMarkdownDryRunReport(report);

    expect(markdown).toContain('# V1 to V2 Migration: Dry-Run Audit Report');
    expect(markdown).toContain('Total Redis Subscribers Scanned');
    expect(markdown).toContain('BACKEND');
    expect(markdown).toContain('FRONTEND');
    expect(markdown).toContain('PASSED');
  });

  it('reconciles 100% of subscribers when Postgres data matches Redis exactly', async () => {
    const mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            telegramId: 101n,
            preference: { preferenceHash: 'hash101' },
          },
          {
            telegramId: 102n,
            preference: { preferenceHash: 'hash102' },
          },
          {
            telegramId: 103n,
            preference: { preferenceHash: 'hash103' },
          },
        ]),
      },
    };

    const reconciliation = await MigrationReconciler.reconcile(sampleRecords, mockPrisma as any);

    expect(reconciliation.isReconciled).toBe(true);
    expect(reconciliation.status).toBe('PASSED');
    expect(reconciliation.matchingCount).toBe(3);
    expect(reconciliation.missingUsers).toHaveLength(0);
    expect(reconciliation.missingPreferences).toHaveLength(0);
    expect(reconciliation.hashMismatches).toHaveLength(0);
  });

  it('accurately detects missing users, missing preferences, and hash mismatches', async () => {
    const mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            telegramId: 101n, // User 101: hash mismatch
            preference: { preferenceHash: 'corrupted_hash' },
          },
          {
            telegramId: 102n, // User 102: missing preference record
            preference: null,
          },
          // User 103: missing entirely
        ]),
      },
    };

    const reconciliation = await MigrationReconciler.reconcile(sampleRecords, mockPrisma as any);

    expect(reconciliation.isReconciled).toBe(false);
    expect(reconciliation.status).toBe('FAILED');
    expect(reconciliation.missingUsers).toEqual(['103']);
    expect(reconciliation.missingPreferences).toEqual(['102']);
    expect(reconciliation.hashMismatches).toHaveLength(1);
    expect(reconciliation.hashMismatches[0]!.userId).toBe('101');
    expect(reconciliation.matchingCount).toBe(0);

    const markdown = MigrationReconciler.generateMarkdownReconciliationReport(reconciliation);
    expect(markdown).toContain('DISCREPANCIES DETECTED');
    expect(markdown).toContain('MISMATCH');
  });
});


import ms from 'ms';
import { prisma, type PrismaService } from '../../shared/database/prisma.service.js';
import redisClient, { connectRedis } from '../../config/redis.js';
import logger from '../../shared/utils/logger.js';
import env from '../../config/env.js';

export interface CheckItemResult {
  name: string;
  passed: boolean;
  durationMs: number;
  durationFormatted: string;
  details: string;
}

export interface CutoverReadinessReport {
  timestamp: string;
  allPassed: boolean;
  totalDurationMs: number;
  totalDurationFormatted: string;
  checks: CheckItemResult[];
  databaseStats?: {
    userCount: number;
    preferenceCount: number;
    poolTotal: number;
    poolActive: number;
    poolIdle: number;
  };
}

export class ProductionCutoverChecker {
  constructor(
    private readonly prismaClient: PrismaService = prisma,
    private readonly redis = redisClient,
  ) {}

  public async checkEnvironment(): Promise<CheckItemResult> {
    const start = Date.now();
    try {
      const missingVars: string[] = [];

      if (!env.databaseUrl) missingVars.push('DATABASE_URL');
      if (!env.redisUrl) missingVars.push('REDIS_URL');
      if (!env.telegramBotToken) missingVars.push('TELEGRAM_BOT_TOKEN');

      const passed = missingVars.length === 0;
      const durationMs = Math.max(1, Date.now() - start);

      return {
        name: 'Environment Configuration Validation',
        passed,
        durationMs,
        durationFormatted: ms(durationMs),
        details: passed
          ? 'All critical production environment variables are present and valid'
          : `Missing critical variables: ${missingVars.join(', ')}`,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(1, Date.now() - start);
      logger.error(`[CutoverChecker] Environment check error: ${(err as Error).message}`);
      return {
        name: 'Environment Configuration Validation',
        passed: false,
        durationMs,
        durationFormatted: ms(durationMs),
        details: `Unexpected error during env validation: ${(err as Error).message}`,
      };
    }
  }

  public async checkDatabase(): Promise<{ check: CheckItemResult; stats?: CutoverReadinessReport['databaseStats'] }> {
    const start = Date.now();
    try {
      await this.prismaClient.connect();
      const userCount = await this.prismaClient.user.count();
      const preferenceCount = await this.prismaClient.userPreference.count();
      const poolMetrics = await this.prismaClient.getPoolMetrics();

      const durationMs = Math.max(1, Date.now() - start);
      return {
        check: {
          name: 'Lakebase PostgreSQL Connectivity & Schema',
          passed: true,
          durationMs,
          durationFormatted: ms(durationMs),
          details: `Connected in ${ms(durationMs)}. Users: ${userCount}, Preferences: ${preferenceCount}, Pool: ${poolMetrics.active}/${poolMetrics.total}`,
        },
        stats: {
          userCount,
          preferenceCount,
          poolTotal: poolMetrics.total,
          poolActive: poolMetrics.active,
          poolIdle: poolMetrics.idle,
        },
      };
    } catch (err: unknown) {
      const durationMs = Math.max(1, Date.now() - start);
      logger.error(`[CutoverChecker] Database check failed: ${(err as Error).message}`);
      return {
        check: {
          name: 'Lakebase PostgreSQL Connectivity & Schema',
          passed: false,
          durationMs,
          durationFormatted: ms(durationMs),
          details: `Connection failed: ${(err as Error).message}`,
        },
      };
    }
  }

  public async checkRedis(): Promise<CheckItemResult> {
    const start = Date.now();
    try {
      if (!this.redis.isOpen) {
        await connectRedis();
      }
      const pingResponse = await this.redis.ping();
      const durationMs = Math.max(1, Date.now() - start);
      const passed = pingResponse === 'PONG';

      return {
        name: 'Redis Cache & State Store Ping',
        passed,
        durationMs,
        durationFormatted: ms(durationMs),
        details: passed
          ? `Redis ping responded with PONG in ${ms(durationMs)}`
          : `Unexpected ping response: ${pingResponse}`,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(1, Date.now() - start);
      logger.error(`[CutoverChecker] Redis ping failed: ${(err as Error).message}`);
      return {
        name: 'Redis Cache & State Store Ping',
        passed: false,
        durationMs,
        durationFormatted: ms(durationMs),
        details: `Redis connection failed: ${(err as Error).message}`,
      };
    }
  }

  public async checkTablesIntegrity(): Promise<CheckItemResult> {
    const start = Date.now();
    try {
      // Probe essential tables
      await Promise.all([
        this.prismaClient.user.findFirst({ select: { id: true } }),
        this.prismaClient.userPreference.findFirst({ select: { id: true } }),
        this.prismaClient.job.findFirst({ select: { id: true } }),
        this.prismaClient.sentJob.findFirst({ select: { id: true } }),
        this.prismaClient.deliverySlot.findFirst({ select: { id: true } }),
      ]);

      const durationMs = Math.max(1, Date.now() - start);
      return {
        name: 'PostgreSQL Relational Tables Schema Integrity',
        passed: true,
        durationMs,
        durationFormatted: ms(durationMs),
        details: `All 5 core relational tables (User, UserPreference, Job, SentJob, DeliverySlot) are accessible in ${ms(durationMs)}`,
      };
    } catch (err: unknown) {
      const durationMs = Math.max(1, Date.now() - start);
      logger.error(`[CutoverChecker] Table integrity check failed: ${(err as Error).message}`);
      return {
        name: 'PostgreSQL Relational Tables Schema Integrity',
        passed: false,
        durationMs,
        durationFormatted: ms(durationMs),
        details: `Schema integrity query failed: ${(err as Error).message}`,
      };
    }
  }

  public async executePreflight(): Promise<CutoverReadinessReport> {
    const overallStart = Date.now();
    const checks: CheckItemResult[] = [];

    // 1. Env check
    const envCheck = await this.checkEnvironment();
    checks.push(envCheck);

    // 2. DB check
    const { check: dbCheck, stats } = await this.checkDatabase();
    checks.push(dbCheck);

    // 3. Schema check
    const schemaCheck = await this.checkTablesIntegrity();
    checks.push(schemaCheck);

    // 4. Redis check
    const redisCheck = await this.checkRedis();
    checks.push(redisCheck);

    const totalDurationMs = Math.max(1, Date.now() - overallStart);
    const allPassed = checks.every((c) => c.passed);

    return {
      timestamp: new Date().toISOString(),
      allPassed,
      totalDurationMs,
      totalDurationFormatted: ms(totalDurationMs),
      checks,
      databaseStats: stats,
    };
  }

  public generateMarkdownReport(report: CutoverReadinessReport): string {
    const statusBadge = report.allPassed ? '**READY FOR ZERO-DOWNTIME CUTOVER**' : '**CUTOVER BLOCKED**';

    const rows = report.checks
      .map(
        (c) =>
          `| ${c.name} | ${c.passed ? '✅ PASS' : '❌ FAIL'} | \`${c.durationFormatted}\` | ${c.details} |`,
      )
      .join('\n');

    let dbSection = '';
    if (report.databaseStats) {
      dbSection = `
### Database Production Stats
- **Active Migrated Users:** \`${report.databaseStats.userCount}\`
- **User Preferences:** \`${report.databaseStats.preferenceCount}\`
- **Active Pool Connections:** \`${report.databaseStats.poolActive} / ${report.databaseStats.poolTotal}\`
`;
    }

    return `
# Production Deployment & Zero-Downtime Cutover Verification

- **Evaluation Timestamp:** \`${report.timestamp}\`
- **Overall Verdict:** ${statusBadge}
- **Total Duration:** \`${report.totalDurationFormatted}\`

---

### Pre-flight Diagnostic Checks
| Diagnostic Component | Outcome | Latency | Evaluation Details |
| :--- | :---: | :---: | :--- |
${rows}
${dbSection}
`;
  }
}

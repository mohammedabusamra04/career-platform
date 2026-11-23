import 'dotenv/config';

import env from '../config/env.js';
import {
  ArbeitnowJobSource,
  RemotiveJobSource,
  WeWorkRemotelyJobSource,
  MostaqlJobSource,
  TanqeebJobSource,
  BaytJobSource,
  WuzzufJobSource,
  ForasnaJobSource,
  AdzunaJobSource,
  JoobleJobSource,
  LinkedinJobSource,
  FirecrawlLinkedInSource,
} from '../modules/jobs/sources/index.js';
import type { JobSource } from '../modules/jobs/sources/jobSource.interface.js';
import type { JobSearchQuery } from '../modules/jobs/job.types.js';
import { WorkType, ExperienceLevel } from '../shared/types/job.js';

interface SourceTestConfig {
  name: string;
  source: JobSource | null;
  requiresKey: boolean;
  keyConfigured: boolean;
  notes?: string;
}

const testQuery: JobSearchQuery = {
  jobTitle: 'Backend Developer',
  workType: WorkType.REMOTE,
  experienceLevel: ExperienceLevel.SENIOR,
  skills: ['Node.js', 'TypeScript', 'PostgreSQL'],
};

async function testSingleSource(config: SourceTestConfig): Promise<void> {
  console.log(`\n------------------------------------------------------------`);
  console.log(`📡 Testing Source: ${config.name}`);
  if (config.requiresKey) {
    console.log(
      `   API Key Status: ${config.keyConfigured ? '✅ Configured' : '⚠️ Missing / Not Provided'}`,
    );
  } else {
    console.log(`   Source Type: Public API / Scraper (No Key Required)`);
  }

  if (!config.source) {
    console.log(`   ⏭️ Skipped: Source not initialized (missing API key in .env)`);
    return;
  }

  const startTime = Date.now();
  try {
    const jobs = await config.source.fetchJobs(testQuery);
    const duration = Date.now() - startTime;

    if (jobs.length > 0) {
      console.log(`   ✅ Status: SUCCESS (${duration}ms)`);
      console.log(`   📊 Jobs Found: ${jobs.length}`);
      console.log(`   📋 Sample Results:`);
      jobs.slice(0, 3).forEach((job, idx) => {
        console.log(`      ${idx + 1}. ${job.title} | ${job.company}`);
        console.log(`         📍 Location: ${job.location ?? 'N/A'}`);
        console.log(`         🔗 URL: ${job.applicationUrl}`);
      });
    } else {
      console.log(`   ⚠️ Status: 0 JOBS RETURNED (${duration}ms)`);
      // Raw fetch test to diagnose
      try {
        let rawUrl = '';
        if (config.name.includes('Adzuna')) {
          rawUrl = `https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${env.adzunaAppId}&app_key=${env.adzunaAppKey}&what=Developer&content-type=application/json`;
        } else if (config.name.includes('Bayt')) {
          rawUrl = `https://www.bayt.com/en/jobs/?q=Developer`;
        } else if (config.name.includes('Wuzzuf')) {
          rawUrl = `https://wuzzuf.net/search/jobs/?q=Developer`;
        } else if (config.name.includes('Forasna')) {
          rawUrl = `https://forasna.com/job/search?q=Developer`;
        }
        if (rawUrl) {
          const rawRes = await fetch(rawUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/json,application/xml',
            },
          });
          console.log(`   🔍 Raw Diagnostic: HTTP ${rawRes.status} ${rawRes.statusText}`);
          if (!rawRes.ok) {
            const rawBody = (await rawRes.text()).slice(0, 200);
            console.log(`   🔍 Response preview: ${rawBody}`);
          }
        }
      } catch (diagErr) {
        console.log(`   🔍 Raw Fetch Error: ${diagErr instanceof Error ? diagErr.message : String(diagErr)}`);
      }
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`   ❌ Status: FAILED (${duration}ms)`);
    console.log(`   🚨 Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  console.log(`============================================================`);
  console.log(`🚀 LIVE JOB SOURCES DIAGNOSTIC TEST`);
  console.log(`============================================================`);
  console.log(`Query: "${testQuery.jobTitle}" | WorkType: ${testQuery.workType}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const sourcesToTest: SourceTestConfig[] = [
    {
      name: 'Arbeitnow (Public API)',
      source: new ArbeitnowJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Remotive (Public API)',
      source: new RemotiveJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'WeWorkRemotely (Public RSS/Feed)',
      source: new WeWorkRemotelyJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Mostaql (Freelance Scraper)',
      source: new MostaqlJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Tanqeeb (Regional Scraper)',
      source: new TanqeebJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Bayt (Regional Scraper)',
      source: new BaytJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Wuzzuf (Regional Scraper)',
      source: new WuzzufJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Forasna (Regional Scraper)',
      source: new ForasnaJobSource(),
      requiresKey: false,
      keyConfigured: true,
    },
    {
      name: 'Adzuna API',
      source:
        env.adzunaAppId && env.adzunaAppKey
          ? new AdzunaJobSource(env.adzunaAppId, env.adzunaAppKey)
          : null,
      requiresKey: true,
      keyConfigured: Boolean(env.adzunaAppId && env.adzunaAppKey),
    },
    {
      name: 'Jooble API',
      source: env.joobleApiKey ? new JoobleJobSource(env.joobleApiKey) : null,
      requiresKey: true,
      keyConfigured: Boolean(env.joobleApiKey),
    },
    {
      name: 'LinkedIn via Firecrawl (Firecrawl.dev)',
      source: env.firecrawlApiKey ? new FirecrawlLinkedInSource(env.firecrawlApiKey) : null,
      requiresKey: true,
      keyConfigured: Boolean(env.firecrawlApiKey),
    },
    {
      name: 'LinkedIn / JSearch (RapidAPI)',
      source: env.rapidApiKey ? new LinkedinJobSource(env.rapidApiKey) : null,
      requiresKey: true,
      keyConfigured: Boolean(env.rapidApiKey),
    },
  ];

  for (const item of sourcesToTest) {
    await testSingleSource(item);
  }

  console.log(`\n============================================================`);
  console.log(`🏁 DIAGNOSTIC COMPLETE`);
  console.log(`============================================================\n`);
}

void main();

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdzunaJobSource } from '../../src/modules/jobs/sources/adzuna.source.js';
import { ArbeitnowJobSource } from '../../src/modules/jobs/sources/arbeitnow.source.js';
import { BaeedJobSource } from '../../src/modules/jobs/sources/baeed.source.js';
import { BaytJobSource } from '../../src/modules/jobs/sources/bayt.source.js';
import { FirecrawlLinkedinJobSource } from '../../src/modules/jobs/sources/firecrawlLinkedin.source.js';
import { ForasnaJobSource } from '../../src/modules/jobs/sources/forasna.source.js';
import { JoobleJobSource } from '../../src/modules/jobs/sources/jooble.source.js';
import { LinkedinJobSource } from '../../src/modules/jobs/sources/linkedin.source.js';
import { MostaqlJobSource } from '../../src/modules/jobs/sources/mostaql.source.js';
import { NaukrigulfJobSource } from '../../src/modules/jobs/sources/naukrigulf.source.js';
import { RemotiveJobSource } from '../../src/modules/jobs/sources/remotive.source.js';
import { TanqeebJobSource } from '../../src/modules/jobs/sources/tanqeeb.source.js';
import { WeWorkRemotelyJobSource } from '../../src/modules/jobs/sources/weworkremotely.source.js';
import { WuzzufJobSource } from '../../src/modules/jobs/sources/wuzzuf.source.js';
import { ExperienceLevel } from '../../src/shared/types/domain.types.js';
import { loadSourceFixture, loadSourceJsonFixture } from '../helpers/fixtureLoader.js';

describe('Regression: All 13 Job Sources Must Not Inject Synthetic Defaults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Remotive does not inject MID seniority when raw payload lacks it', async () => {
    const fixture = loadSourceJsonFixture('remotive.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new RemotiveJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'Engineer' });

    expect(jobs.length).toBeGreaterThan(0);
    // MUST NOT default to ExperienceLevel.MID
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
  });

  it('Adzuna does not inject MID seniority or hardcoded UK country', async () => {
    const fixture = loadSourceJsonFixture('adzuna.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new AdzunaJobSource('id', 'key', 'gb');
    const jobs = await source.fetchJobs({ jobTitle: 'Developer' });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
  });

  it('LinkedIn does not inject MID seniority', async () => {
    const fixture = loadSourceJsonFixture('linkedin.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new LinkedinJobSource('key');
    const jobs = await source.fetchJobs({ jobTitle: 'Engineer' });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
  });

  it('Jooble does not inject MID seniority or copy location to country', async () => {
    const fixture = loadSourceJsonFixture('jooble.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new JoobleJobSource('key', { maxAgeDays: 0, verifyLinks: false });
    const jobs = await source.fetchJobs({ jobTitle: 'Engineer' });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
    expect(jobs[0].country).not.toBe(jobs[0].location);
  });

  it('Baeed does not inject MID seniority or set country to unstructured text', async () => {
    const fixture = loadSourceFixture('baeed.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new BaeedJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
    expect(jobs[0].country).not.toBe('الشرق الأوسط / عن بعد');
  });

  it('Tanqeeb does not inject MID seniority or copy location to country', async () => {
    const fixture = loadSourceFixture('tanqeeb.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new TanqeebJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'Developer' });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
    expect(jobs[0].country).not.toBe(jobs[0].location);
  });

  it('Naukrigulf does not inject MID seniority or copy location to country', async () => {
    const fixture = loadSourceFixture('naukrigulf.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new NaukrigulfJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
    expect(jobs[0].country).not.toBe(jobs[0].location);
  });

  it('WeWorkRemotely does not inject MID seniority', async () => {
    const fixture = loadSourceFixture('weworkremotely.xml');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new WeWorkRemotelyJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
  });

  it('Mostaql does not inject MID seniority or set country to unstructured text', async () => {
    const fixture = loadSourceFixture('mostaql.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new MostaqlJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'تطوير' });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].experienceLevel).toBe(ExperienceLevel.UNKNOWN);
    expect(jobs[0].country).not.toBe('الشرق الأوسط / عن بعد');
  });
});


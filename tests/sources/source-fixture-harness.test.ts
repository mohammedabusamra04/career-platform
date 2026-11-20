import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemotiveJobSource } from '../../src/modules/jobs/sources/remotive.source.js';
import { WeWorkRemotelyJobSource } from '../../src/modules/jobs/sources/weworkremotely.source.js';
import { MostaqlJobSource } from '../../src/modules/jobs/sources/mostaql.source.js';
import { TanqeebJobSource } from '../../src/modules/jobs/sources/tanqeeb.source.js';
import { AdzunaJobSource } from '../../src/modules/jobs/sources/adzuna.source.js';
import { JoobleJobSource } from '../../src/modules/jobs/sources/jooble.source.js';
import { LinkedinJobSource } from '../../src/modules/jobs/sources/linkedin.source.js';
import { BaeedJobSource } from '../../src/modules/jobs/sources/baeed.source.js';
import { NaukrigulfJobSource } from '../../src/modules/jobs/sources/naukrigulf.source.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';
import { loadSourceFixture, loadSourceJsonFixture } from '../helpers/fixture-loader.js';

describe('Job Source Fixture Testing & Mock Harness (TASK-25.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates Remotive parser extraction and optional field fallbacks', async () => {
    const fixture = loadSourceJsonFixture('remotive.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new RemotiveJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'Engineer' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Senior Fullstack Engineer');
    expect(jobs[0].company).toBe('Stripe');
    expect(jobs[0].url).toContain('https://remotive.com');
    expect(jobs[0].publicationDate).toBeInstanceOf(Date);
    expect(jobs[0].source).toBe(JobSourceType.REMOTIVE);

    // Fallback verification
    expect(jobs[1].location).toBe('Remote (Worldwide)');
    expect(jobs[1].description).toBe('');
  });

  it('validates WeWorkRemotely RSS XML parser extraction and fallback', async () => {
    const fixture = loadSourceFixture('weworkremotely.xml');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new WeWorkRemotelyJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].title).toBe('Senior Backend Architect');
    expect(jobs[0].company).toBe('Shopify');
    expect(jobs[0].url).toContain('https://weworkremotely.com');
    expect(jobs[0].publicationDate).toBeInstanceOf(Date);
    expect(jobs[0].source).toBe(JobSourceType.WE_WORK_REMOTELY);
  });

  it('validates Mostaql HTML parser extraction and relative link resolution', async () => {
    const fixture = loadSourceFixture('mostaql.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new MostaqlJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'تطوير' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toContain('بناء منصة توظيف ذكية');
    expect(jobs[0].company).toBe('مستقل (مشروع فريلانس)');
    expect(jobs[0].applicationUrl).toMatch(/^https:\/\/mostaql\.com/);
    expect(jobs[0].source).toBe(JobSourceType.MOSTAQEL);
  });

  it('validates Tanqeeb HTML parser extraction and location/remote detection', async () => {
    const fixture = loadSourceFixture('tanqeeb.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new TanqeebJobSource();
    const jobs = await source.fetchJobs({ jobTitle: 'Developer' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toContain('Senior Frontend Engineer');
    expect(jobs[0].company).toBe('Saudi Telecom Company (STC)');
    expect(jobs[0].location).toBe('Riyadh, Saudi Arabia');
    expect(jobs[0].applicationUrl).toMatch(/^https:\/\/www\.tanqeeb\.com/);
    expect(jobs[0].source).toBe(JobSourceType.TANQEEB);

    // Remote detection
    expect(jobs[1].remote).toBe(true);
  });

  it('validates Adzuna JSON parser extraction and salary fields', async () => {
    const fixture = loadSourceJsonFixture('adzuna.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new AdzunaJobSource('id', 'key', 'gb');
    const jobs = await source.fetchJobs({ jobTitle: 'Cloud' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Principal Cloud Security Architect');
    expect(jobs[0].company).toBe('CyberDefense UK');
    expect(jobs[0].salaryMin).toBe(85000);
    expect(jobs[0].salaryMax).toBe(110000);
    expect(jobs[0].currency).toBe('GBP');
    expect(jobs[0].source).toBe(JobSourceType.ADZUNA);

    // Fallbacks
    expect(jobs[1].company).toBe('Adzuna Employer');
    expect(jobs[1].salaryMin).toBeUndefined();
  });

  it('validates Jooble JSON parser extraction and snippet handling', async () => {
    const fixture = loadSourceJsonFixture('jooble.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new JoobleJobSource('key');
    const jobs = await source.fetchJobs({ jobTitle: 'QA' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Lead Software QA Automation Engineer');
    expect(jobs[0].company).toBe('QualityFirst Tech');
    expect(jobs[0].description).toContain('Playwright');
    expect(jobs[0].source).toBe(JobSourceType.JOOBLE);

    // Fallbacks
    expect(jobs[1].company).toBe('Jooble Employer');
    expect(jobs[1].location).toBe('Remote');
  });

  it('validates LinkedIn (JSearch) JSON parser extraction and metadata', async () => {
    const fixture = loadSourceJsonFixture('linkedin.json');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    });

    const source = new LinkedinJobSource('key');
    const jobs = await source.fetchJobs({ jobTitle: 'AI' });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Staff AI Engineer (LLM & Agents)');
    expect(jobs[0].company).toBe('Anthropic Partner');
    expect(jobs[0].skills).toEqual(['Python', 'PyTorch', 'LangChain', 'Vector Databases']);
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].source).toBe(JobSourceType.LINKEDIN);

    // Fallbacks
    expect(jobs[1].location).toBe('Worldwide');
    expect(jobs[1].remote).toBe(false);
  });

  it('validates Baeed HTML parser extraction for Arabic remote jobs', async () => {
    const fixture = loadSourceFixture('baeed.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new BaeedJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toContain('مطور ويب متكامل');
    expect(jobs[0].company).toBe('شركة إبتكار للتقنية');
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].source).toBe(JobSourceType.BAEED);
    expect(jobs[0].applicationUrl).toMatch(/^https:\/\/baeed\.com/);
  });

  it('validates Naukrigulf HTML parser extraction for GCC jobs', async () => {
    const fixture = loadSourceFixture('naukrigulf.html');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixture,
    });

    const source = new NaukrigulfJobSource();
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Senior Cloud Solutions Architect');
    expect(jobs[0].company).toBe('Al-Futtaim Technologies');
    expect(jobs[0].location).toBe('Riyadh, Saudi Arabia');
    expect(jobs[0].source).toBe(JobSourceType.NARIGULF);
    expect(jobs[0].applicationUrl).toMatch(/^https:\/\/www\.naukrigulf\.com/);
  });
});


import { describe, it, expect } from 'vitest';
import ms from 'ms';
import { TaxonomyMapper } from '../../../src/modules/migration/taxonomy-mapper.js';
import {
  Specialization,
  RegionPreference,
  ExperienceLevelPreference,
  WorkTypePreference,
} from '../../../src/modules/preferences/preference.taxonomy.js';

describe('TASK-48.1: TaxonomyMapper Unit Tests (#134)', () => {
  it('maps legacy backend free-text titles and skills to Specialization.BACKEND', () => {
    const res = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'Senior Node.js & NestJS Backend Developer',
      skills: ['PostgreSQL', 'Express', 'Redis', 'Docker'],
      experienceLevel: 'senior',
      location: 'Cairo, Egypt',
      workType: 'full-time',
    });

    expect(res.specializations).toContain(Specialization.BACKEND);
    expect(res.experienceLevel).toBe(ExperienceLevelPreference.SENIOR);
    expect(res.workType).toBe(WorkTypePreference.FULL_TIME);
    expect(res.regionPreference).toBe(RegionPreference.ARAB);
    expect(res.isAmbiguous).toBe(false);
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  it('maps legacy frontend titles with React/Vue/Angular to Specialization.FRONTEND', () => {
    const res = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'React & Next.js Frontend Engineer',
      skills: ['TypeScript', 'Tailwind CSS', 'Redux'],
      experienceLevel: 'mid',
      location: 'Remote Worldwide',
      workType: 'contract',
    });

    expect(res.specializations).toContain(Specialization.FRONTEND);
    expect(res.experienceLevel).toBe(ExperienceLevelPreference.MID);
    expect(res.workType).toBe(WorkTypePreference.CONTRACT);
    expect(res.regionPreference).toBe(RegionPreference.INTERNATIONAL);
    expect(res.isAmbiguous).toBe(false);
  });

  it('maps full-stack and mobile titles accurately', () => {
    const fullstackRes = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'Fullstack MERN Engineer',
      skills: ['MongoDB', 'Express', 'React', 'Node'],
    });
    expect(fullstackRes.specializations).toContain(Specialization.FULLSTACK);

    const mobileRes = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'iOS & Flutter App Developer',
      skills: ['SwiftUI', 'Dart', 'Kotlin'],
      experienceLevel: 'junior',
    });
    expect(mobileRes.specializations).toContain(Specialization.MOBILE);
    expect(mobileRes.experienceLevel).toBe(ExperienceLevelPreference.JUNIOR);
  });

  it('maps devops, cloud, sre to Specialization.DEVOPS', () => {
    const res = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'Cloud DevOps / SRE Specialist',
      skills: ['AWS', 'Kubernetes', 'Terraform', 'CI/CD'],
    });

    expect(res.specializations).toContain(Specialization.DEVOPS);
    expect(res.isAmbiguous).toBe(false);
  });

  it('maps ui/ux, data, qa, security, and ai/ml domains accurately', () => {
    const uiux = TaxonomyMapper.mapV1PreferenceToV2({ jobTitle: 'UI/UX Product Designer', skills: ['Figma'] });
    expect(uiux.specializations).toContain(Specialization.UIUX);

    const data = TaxonomyMapper.mapV1PreferenceToV2({ jobTitle: 'Data Engineer / Analytics', skills: ['ETL', 'Spark'] });
    expect(data.specializations).toContain(Specialization.DATA);

    const qa = TaxonomyMapper.mapV1PreferenceToV2({ jobTitle: 'QA Automation Engineer', skills: ['Selenium', 'Cypress'] });
    expect(qa.specializations).toContain(Specialization.QA);

    const security = TaxonomyMapper.mapV1PreferenceToV2({ jobTitle: 'Cyber Security & Penetration Tester' });
    expect(security.specializations).toContain(Specialization.SECURITY);

    const ai = TaxonomyMapper.mapV1PreferenceToV2({ jobTitle: 'AI & LLM Prompt Engineer', skills: ['PyTorch', 'Gemini'] });
    expect(ai.specializations).toContain(Specialization.AI_ENGINEER);
  });

  it('detects ambiguous or unmapped free-text roles and flags for reconfirmation', () => {
    const ambiguous1 = TaxonomyMapper.mapV1PreferenceToV2({
      jobTitle: 'General IT Consultant / Specialist',
      skills: [],
    });

    expect(ambiguous1.isAmbiguous).toBe(true);
    expect(ambiguous1.suggestedReconfirmation).toBe(true);
    expect(ambiguous1.specializations.length).toBeGreaterThan(0); // Safe fallback provided
    expect(ambiguous1.confidence).toBeLessThan(0.7);

    const empty = TaxonomyMapper.mapV1PreferenceToV2({});
    expect(empty.isAmbiguous).toBe(true);
    expect(empty.suggestedReconfirmation).toBe(true);
  });

  it('measures taxonomy mapping duration formatted with ms', () => {
    const telemetry = TaxonomyMapper.mapWithTelemetry({
      jobTitle: 'Senior DevOps Kubernetes Engineer',
    });

    expect(telemetry.result.specializations).toContain(Specialization.DEVOPS);
    expect(telemetry.durationMs).toBeGreaterThanOrEqual(1);
    expect(telemetry.durationFormatted).toMatch(/\d+ms/);
  });
});


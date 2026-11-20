import { describe, it, expect, vi } from 'vitest';
import {
  DeterministicJobClassifier,
  deterministicJobClassifier,
  NegativeExclusionMatcher,
  negativeExclusionMatcher,
  RemoteScopeClassifier,
  remoteScopeClassifier,
  type AmbiguityResolver,
  GeminiAmbiguityResolver,
  AIAmbiguityResolutionSchema,
} from '../../../src/modules/jobs/classifier/job.classifier.js';
import type { TextGenerator } from '../../../src/modules/jobs/classifier/gemini-ambiguity.resolver.js';
import {
  Specialization,
  RemoteScope,
  ExperienceLevel,
  WorkType,
} from '@prisma/client';

describe('DeterministicJobClassifier - 10-Domain Specialization Classifier (TASK-26.1 / TASK-30)', () => {
  const classifier = deterministicJobClassifier;

  describe('Specialization Classification', () => {
    it('classifies AI / ML engineering jobs accurately', () => {
      const result = classifier.classify({
        title: 'Senior LLM & Machine Learning Engineer',
        skills: ['PyTorch', 'LangChain', 'Python'],
      });

      expect(result.primarySpecialization).toBe(Specialization.AI_ENGINEER);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Data engineering and analytics jobs', () => {
      const result = classifier.classify({
        title: 'Lead Data Engineer (ETL & Big Data)',
        skills: ['Spark', 'Airflow', 'Snowflake'],
      });

      expect(result.primarySpecialization).toBe(Specialization.DATA);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies DevOps and Cloud platform jobs', () => {
      const result = classifier.classify({
        title: 'Senior Site Reliability Engineer (SRE)',
        skills: ['Kubernetes', 'Terraform', 'AWS'],
      });

      expect(result.primarySpecialization).toBe(Specialization.DEVOPS);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Security and Cybersecurity jobs', () => {
      const result = classifier.classify({
        title: 'Application Security Engineer (AppSec)',
        skills: ['OWASP', 'Burp Suite'],
      });

      expect(result.primarySpecialization).toBe(Specialization.SECURITY);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies QA and Test Automation jobs', () => {
      const result = classifier.classify({
        title: 'Senior SDET / QA Automation Engineer',
        skills: ['Playwright', 'Cypress', 'Jest'],
      });

      expect(result.primarySpecialization).toBe(Specialization.QA);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Mobile development jobs', () => {
      const result = classifier.classify({
        title: 'Senior Flutter & iOS Mobile Developer',
        skills: ['Flutter', 'Swift', 'Dart'],
      });

      expect(result.primarySpecialization).toBe(Specialization.MOBILE);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies UI/UX and Product Design jobs', () => {
      const result = classifier.classify({
        title: 'Product Designer (UI/UX)',
        skills: ['Figma', 'Prototyping'],
      });

      expect(result.primarySpecialization).toBe(Specialization.UIUX);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Frontend web development jobs', () => {
      const result = classifier.classify({
        title: 'Senior React / Frontend Developer',
        skills: ['React', 'Next.js', 'TypeScript', 'Tailwind'],
      });

      expect(result.primarySpecialization).toBe(Specialization.FRONTEND);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Full-Stack development jobs', () => {
      const result = classifier.classify({
        title: 'Full Stack Engineer (MERN)',
        skills: ['React', 'Node.js', 'MongoDB'],
      });

      expect(result.primarySpecialization).toBe(Specialization.FULLSTACK);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Backend engineering jobs as default technical baseline', () => {
      const result = classifier.classify({
        title: 'Senior Golang & Distributed Systems Engineer',
        skills: ['Go', 'PostgreSQL', 'Redis'],
      });

      expect(result.primarySpecialization).toBe(Specialization.BACKEND);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });

    it('classifies Rust backend jobs specifically (TASK-30.1)', () => {
      const result = classifier.classify({
        title: 'Senior Rust Systems & Backend Developer',
      });

      expect(result.primarySpecialization).toBe(Specialization.BACKEND);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
      expect(result.matchedTokens).toContain('rust');
    });
  });

  describe('TASK-30.1: Title-First Tokenized Rule Engine (Trie / Map Keyword Sets)', () => {
    it('classifies directly from title with high confidence (0.95) and method RULE_TITLE', () => {
      const result = classifier.classifyTitle('Senior Backend Engineer (Node.js / Express)');

      expect(result).not.toBeNull();
      expect(result?.primarySpecialization).toBe(Specialization.BACKEND);
      expect(result?.confidence).toBe(0.95);
      expect(result?.classificationMethod).toBe('RULE_TITLE');
      expect(result?.matchedTokens.length).toBeGreaterThan(0);
    });

    it('handles special programming tokens correctly (.net, c#, c++, ui/ux, ci/cd)', () => {
      const csharp = classifier.classifyTitle('Lead C# / .NET Web Developer');
      expect(csharp?.primarySpecialization).toBe(Specialization.BACKEND);

      const uiux = classifier.classifyTitle('Senior UI/UX Designer & Researcher');
      expect(uiux?.primarySpecialization).toBe(Specialization.UIUX);

      const devops = classifier.classifyTitle('DevOps & CI/CD Platform Engineer');
      expect(devops?.primarySpecialization).toBe(Specialization.DEVOPS);
    });

    it('supports Arabic titles natively across specializations', () => {
      const frontend = classifier.classifyTitle('مطور واجهات أمامية محترف');
      expect(frontend?.primarySpecialization).toBe(Specialization.FRONTEND);

      const backend = classifier.classifyTitle('مهندس خلفية النظم والبيانات');
      expect(backend?.primarySpecialization).toBe(Specialization.BACKEND);

      const ai = classifier.classifyTitle('مهندس ذكاء اصطناعي وتعلم الآلة');
      expect(ai?.primarySpecialization).toBe(Specialization.AI_ENGINEER);

      const security = classifier.classifyTitle('أخصائي أمن سيبراني ومعلومات');
      expect(security?.primarySpecialization).toBe(Specialization.SECURITY);
    });

    it('returns null for unclassifiable or ambiguous titles without throwing', () => {
      expect(classifier.classifyTitle('')).toBeNull();
      expect(classifier.classifyTitle('   ')).toBeNull();
      expect(classifier.classifyTitle('General Operational Lead')).toBeNull();
      expect(classifier.classifyTitle('Project Coordinator')).toBeNull();
    });

    it('satisfies execution speed requirement (<0.1ms per title)', () => {
      const sampleTitles = [
        'Senior Backend Developer (Node.js & Postgres)',
        'Frontend React Engineer (Next.js & Tailwind)',
        'Senior DevOps & SRE Specialist (Kubernetes)',
        'Full Stack Software Developer (MERN Stack)',
        'Lead Data Engineer (Spark & Airflow)',
      ];

      const iterations = 500;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const title = sampleTitles[i % sampleTitles.length];
        classifier.classifyTitle(title);
      }

      const totalTimeMs = performance.now() - start;
      const avgTimePerTitleMs = totalTimeMs / iterations;

      expect(avgTimePerTitleMs).toBeLessThan(0.1);
    });
  });

  describe('TASK-30.2: Explicit Exclusion Negative Matcher (#92)', () => {
    const exclusionMatcher = negativeExclusionMatcher;

    it('evaluates exclusion directly via NegativeExclusionMatcher standalone', () => {
      const res = exclusionMatcher.evaluate('QA Recruitment Consultant');
      expect(res.isExcluded).toBe(true);
      expect(res.matchedPattern).toBe('recruiter');
    });

    it('rejects QA Recruitment Consultant as NON_TECHNICAL / excluded (Test Spec #92)', () => {
      const result = classifier.classify({
        title: 'QA Recruitment Consultant',
        skills: ['QA', 'Testing'],
      });

      expect(result.isExcluded).toBe(true);
      expect(result.primarySpecialization).toBeNull();
      expect(result.classificationMethod).toBe('NEGATIVE_EXCLUSION');
      expect(result.confidence).toBe(1.0);
    });

    it('rejects Software Sales Account Executive as NON_TECHNICAL / excluded (Test Spec #92)', () => {
      const result = classifier.classify({
        title: 'Software Sales Account Executive',
        skills: ['Sales', 'SaaS'],
      });

      expect(result.isExcluded).toBe(true);
      expect(result.primarySpecialization).toBeNull();
      expect(result.classificationMethod).toBe('NEGATIVE_EXCLUSION');
    });

    it('rejects DevOps Sales Manager despite containing DevOps keyword', () => {
      const result = classifier.classify({
        title: 'DevOps Sales Manager',
      });

      expect(result.isExcluded).toBe(true);
      expect(result.classificationMethod).toBe('NEGATIVE_EXCLUSION');
    });

    it('rejects Technical Recruiter and Headhunter roles', () => {
      const rec = classifier.classify({ title: 'Technical Recruiter (IT & Software)' });
      expect(rec.isExcluded).toBe(true);

      const talent = classifier.classify({ title: 'Talent Acquisition Specialist (Engineering)' });
      expect(talent.isExcluded).toBe(true);
    });

    it('rejects Customer Support and Executive Assistant roles', () => {
      const support = classifier.classify({ title: 'Customer Support Specialist (Technical Tier 1)' });
      expect(support.isExcluded).toBe(true);

      const ea = classifier.classify({ title: 'Executive Assistant to VP of Engineering' });
      expect(ea.isExcluded).toBe(true);
    });

    it('rejects Content Writer and Copywriter roles', () => {
      const writer = classifier.classify({ title: 'Technical Content Writer & Copywriter' });
      expect(writer.isExcluded).toBe(true);
    });

    it('rejects Arabic non-technical roles', () => {
      const hr = classifier.classify({ title: 'مسؤول توظيف تقني وموارد بشرية' });
      expect(hr.isExcluded).toBe(true);

      const sales = classifier.classify({ title: 'مندوب مبيعات برمجيات سحابية' });
      expect(sales.isExcluded).toBe(true);

      const cs = classifier.classify({ title: 'أخصائي خدمة عملاء ودعم فني' });
      expect(cs.isExcluded).toBe(true);
    });

    it('prevents positive title classification from matching excluded roles', () => {
      expect(classifier.classifyTitle('QA Recruitment Consultant')).toBeNull();
      expect(classifier.classifyTitle('DevOps Sales Manager')).toBeNull();
      expect(classifier.classifyTitle('Technical Recruiter')).toBeNull();
    });

    it('does NOT exclude legitimate engineering titles containing test/sales/support context', () => {
      const qa = classifier.classify({ title: 'QA Automation Engineer' });
      expect(qa.isExcluded).toBe(false);
      expect(qa.primarySpecialization).toBe(Specialization.QA);

      const devops = classifier.classify({ title: 'Senior DevOps Engineer' });
      expect(devops.isExcluded).toBe(false);
      expect(devops.primarySpecialization).toBe(Specialization.DEVOPS);

      const backend = classifier.classify({ title: 'Backend Software Engineer' });
      expect(backend.isExcluded).toBe(false);
      expect(backend.primarySpecialization).toBe(Specialization.BACKEND);
    });
  });

  describe('TASK-30.3: Primary and Secondary Specialization Assignment (#93)', () => {
    it('classifies compound role "Data Scientist / Machine Learning Engineer" (Test Spec #93)', () => {
      const result = classifier.classify({
        title: 'Data Scientist / Machine Learning Engineer',
      });

      expect(result.primarySpecialization).toBe(Specialization.DATA);
      expect(result.secondarySpecialization).toBe(Specialization.AI_ENGINEER);
      expect(result.classificationMethod).toBe('RULE_TITLE');
      expect(result.confidence).toBe(0.95);
    });

    it('classifies multi-disciplinary Fullstack + DevOps role with correct secondary assignment', () => {
      const result = classifier.classify({
        title: 'Full Stack Engineer (React/Node) with AWS/DevOps',
      });

      expect(result.primarySpecialization).toBe(Specialization.FULLSTACK);
      expect(result.secondarySpecialization).toBe(Specialization.DEVOPS);
    });

    it('suppresses Frontend / Backend as secondary for pure Fullstack roles with component stacks', () => {
      const result = classifier.classify({
        title: 'Full Stack Developer (React / Node.js)',
      });

      expect(result.primarySpecialization).toBe(Specialization.FULLSTACK);
      expect(result.secondarySpecialization).toBeNull();
    });

    it('assigns null secondary specialization for single-domain roles', () => {
      const frontend = classifier.classify({
        title: 'Senior React / Frontend Developer',
      });
      expect(frontend.primarySpecialization).toBe(Specialization.FRONTEND);
      expect(frontend.secondarySpecialization).toBeNull();

      const backend = classifier.classify({
        title: 'Backend Golang Engineer',
      });
      expect(backend.primarySpecialization).toBe(Specialization.BACKEND);
      expect(backend.secondarySpecialization).toBeNull();

      const devops = classifier.classify({
        title: 'Site Reliability Engineer (Kubernetes)',
      });
      expect(devops.primarySpecialization).toBe(Specialization.DEVOPS);
      expect(devops.secondarySpecialization).toBeNull();
    });

    it('classifies compound Backend & DevOps role', () => {
      const result = classifier.classify({
        title: 'Backend Engineer & DevOps Specialist',
      });

      expect(result.primarySpecialization).toBe(Specialization.BACKEND);
      expect(result.secondarySpecialization).toBe(Specialization.DEVOPS);
    });

    it('handles Arabic compound titles with primary and secondary assignment', () => {
      const result = classifier.classify({
        title: 'مهندس بيانات وذكاء اصطناعي',
      });

      expect(result.primarySpecialization).toBe(Specialization.DATA);
      expect(result.secondarySpecialization).toBe(Specialization.AI_ENGINEER);
    });

    it('assigns primary and secondary via description rule fallback when title is generic', () => {
      const result = classifier.classify({
        title: 'Software Engineer',
        description: 'Looking for a senior developer proficient in Python, Django, PostgreSQL, and also managing AWS Kubernetes DevOps infrastructure.',
      });

      expect(result.classificationMethod).toBe('RULE_DESCRIPTION');
      expect(result.primarySpecialization).toBe(Specialization.BACKEND);
      expect(result.secondarySpecialization).toBe(Specialization.DEVOPS);
    });
  });

  describe('TASK-31.1: Ambiguity Detection Trigger & Isolation (#94)', () => {
    it('processes 50 jobs with unambiguous titles and verifies mock AI provider was called 0 times (Test Spec #94)', async () => {
      const mockResolver: AmbiguityResolver = {
        resolve: vi.fn(),
      };

      const unambiguous50Titles: Array<{ title: string; expected: Specialization }> = [
        // 1. BACKEND (5)
        { title: 'Senior Backend Engineer', expected: Specialization.BACKEND },
        { title: 'Node.js Developer (Express / PostgreSQL)', expected: Specialization.BACKEND },
        { title: 'Lead Rust Systems Developer', expected: Specialization.BACKEND },
        { title: 'Golang Software Engineer', expected: Specialization.BACKEND },
        { title: 'Python Backend Developer', expected: Specialization.BACKEND },

        // 2. FRONTEND (5)
        { title: 'Senior Frontend Developer', expected: Specialization.FRONTEND },
        { title: 'React.js Web Engineer', expected: Specialization.FRONTEND },
        { title: 'Vue.js Application Developer', expected: Specialization.FRONTEND },
        { title: 'Angular Frontend Specialist', expected: Specialization.FRONTEND },
        { title: 'Lead Next.js Developer', expected: Specialization.FRONTEND },

        // 3. FULLSTACK (5)
        { title: 'Full Stack Engineer', expected: Specialization.FULLSTACK },
        { title: 'Full-Stack Developer (MERN)', expected: Specialization.FULLSTACK },
        { title: 'Senior Fullstack Software Developer', expected: Specialization.FULLSTACK },
        { title: 'Lead Full Stack Web Engineer', expected: Specialization.FULLSTACK },
        { title: 'Fullstack JavaScript Developer', expected: Specialization.FULLSTACK },

        // 4. MOBILE (5)
        { title: 'Senior iOS Developer (Swift)', expected: Specialization.MOBILE },
        { title: 'Android Mobile Engineer (Kotlin)', expected: Specialization.MOBILE },
        { title: 'Flutter Mobile Developer', expected: Specialization.MOBILE },
        { title: 'React Native Application Developer', expected: Specialization.MOBILE },
        { title: 'Lead Mobile Software Engineer', expected: Specialization.MOBILE },

        // 5. DEVOPS (5)
        { title: 'Senior DevOps Engineer', expected: Specialization.DEVOPS },
        { title: 'Site Reliability Engineer (SRE)', expected: Specialization.DEVOPS },
        { title: 'Cloud Infrastructure Engineer (AWS)', expected: Specialization.DEVOPS },
        { title: 'Platform Engineer (Kubernetes)', expected: Specialization.DEVOPS },
        { title: 'DevOps & CI/CD Specialist', expected: Specialization.DEVOPS },

        // 6. DATA (5)
        { title: 'Lead Data Engineer (Spark / Airflow)', expected: Specialization.DATA },
        { title: 'Senior Data Analyst (SQL / BI)', expected: Specialization.DATA },
        { title: 'Analytics Engineer', expected: Specialization.DATA },
        { title: 'Data Scientist (Machine Learning)', expected: Specialization.DATA },
        { title: 'Big Data & ETL Developer', expected: Specialization.DATA },

        // 7. AI_ENGINEER (5)
        { title: 'Machine Learning Engineer', expected: Specialization.AI_ENGINEER },
        { title: 'Senior AI Developer (PyTorch)', expected: Specialization.AI_ENGINEER },
        { title: 'Deep Learning Research Engineer', expected: Specialization.AI_ENGINEER },
        { title: 'LLM & NLP Specialist', expected: Specialization.AI_ENGINEER },
        { title: 'Computer Vision Engineer', expected: Specialization.AI_ENGINEER },

        // 8. SECURITY (5)
        { title: 'Application Security Engineer (AppSec)', expected: Specialization.SECURITY },
        { title: 'Senior Penetration Tester (Ethical Hacker)', expected: Specialization.SECURITY },
        { title: 'Cybersecurity Analyst (SOC)', expected: Specialization.SECURITY },
        { title: 'Lead Information Security Specialist', expected: Specialization.SECURITY },
        { title: 'Security Architect', expected: Specialization.SECURITY },

        // 9. QA (5)
        { title: 'Senior QA Automation Engineer', expected: Specialization.QA },
        { title: 'Lead SDET (Software Development Engineer in Test)', expected: Specialization.QA },
        { title: 'Test Automation Specialist (Cypress / Playwright)', expected: Specialization.QA },
        { title: 'QA Engineer (Manual & Automated)', expected: Specialization.QA },
        { title: 'Mobile QA Engineer (Appium)', expected: Specialization.QA },

        // 10. UIUX (5)
        { title: 'Senior UI/UX Designer', expected: Specialization.UIUX },
        { title: 'Lead Product Designer (Figma)', expected: Specialization.UIUX },
        { title: 'User Experience Researcher (UX)', expected: Specialization.UIUX },
        { title: 'UI Designer & Design Systems Specialist', expected: Specialization.UIUX },
        { title: 'Digital Product Designer', expected: Specialization.UIUX },
      ];

      expect(unambiguous50Titles).toHaveLength(50);

      for (const item of unambiguous50Titles) {
        const result = await classifier.classifyWithFallback({ title: item.title }, mockResolver);

        expect(result.primarySpecialization).toBe(item.expected);
        expect(result.confidence).toBe(0.95);
        expect(result.classificationMethod).toBe('RULE_TITLE');
        expect(classifier.isAmbiguous({ title: item.title }, result)).toBe(false);
      }

      // Acceptance criterion verification: mock AI provider was called exactly 0 times
      expect(mockResolver.resolve).toHaveBeenCalledTimes(0);
    });

    it('triggers AI resolution when deterministic rules return UNRESOLVED (Condition 1)', async () => {
      const mockResolver: AmbiguityResolver = {
        resolve: vi.fn().mockResolvedValue({
          specialization: Specialization.DATA,
          confidence: 0.88,
          reasoning: 'Job mentions enterprise data warehousing and analytics.',
        }),
      };

      const ambiguousJob = {
        title: 'Enterprise Technical Specialist Lead',
        description: 'Coordinate enterprise platform architecture and pipeline integrations across teams.',
      };

      expect(classifier.isAmbiguous(ambiguousJob)).toBe(true);

      const result = await classifier.classifyWithFallback(ambiguousJob, mockResolver);

      expect(mockResolver.resolve).toHaveBeenCalledTimes(1);
      expect(mockResolver.resolve).toHaveBeenCalledWith({
        title: ambiguousJob.title,
        description: ambiguousJob.description,
        skills: undefined,
      });

      expect(result.primarySpecialization).toBe(Specialization.DATA);
      expect(result.confidence).toBe(0.88);
      expect(result.classificationMethod).toBe('AI_FALLBACK');
    });

    it('triggers AI resolution when severe title vs description conflict is detected (Condition 2)', async () => {
      const mockResolver: AmbiguityResolver = {
        resolve: vi.fn().mockResolvedValue({
          specialization: Specialization.FRONTEND,
          confidence: 0.90,
          reasoning: 'Description is purely frontend React architecture despite mismatched DevOps title.',
        }),
      };

      const conflictingJob = {
        title: 'DevOps Platform Lead',
        description: 'We are hiring a dedicated React frontend developer to build responsive UI components using Next.js, Redux, Tailwind CSS, and frontend design systems. No infrastructure work.',
      };

      // Conflict between title rule (DevOps) and description rule (Frontend)
      expect(classifier.isAmbiguous(conflictingJob)).toBe(true);

      const result = await classifier.classifyWithFallback(conflictingJob, mockResolver);

      expect(mockResolver.resolve).toHaveBeenCalledTimes(1);
      expect(result.primarySpecialization).toBe(Specialization.FRONTEND);
      expect(result.classificationMethod).toBe('AI_FALLBACK');
    });

    it('prohibits AI invocation for excluded non-technical positions', async () => {
      const mockResolver: AmbiguityResolver = {
        resolve: vi.fn(),
      };

      const excludedJobs = [
        { title: 'QA Recruitment Consultant' },
        { title: 'Software Sales Account Executive' },
        { title: 'DevOps Sales Manager' },
        { title: 'Technical Recruiter' },
      ];

      for (const job of excludedJobs) {
        expect(classifier.isAmbiguous(job)).toBe(false);
        const result = await classifier.classifyWithFallback(job, mockResolver);
        expect(result.isExcluded).toBe(true);
        expect(result.classificationMethod).toBe('NEGATIVE_EXCLUSION');
      }

      expect(mockResolver.resolve).toHaveBeenCalledTimes(0);
    });

    it('gracefully degrades on AI outage / resolver exception without throwing', async () => {
      const failingResolver: AmbiguityResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Gemini API 503: Service Unavailable')),
      };

      const ambiguousJob = {
        title: 'Strategic Project Lead',
        description: 'Drive high-impact initiatives.',
      };

      expect(classifier.isAmbiguous(ambiguousJob)).toBe(true);

      // Should complete safely with zero unhandled exceptions
      const result = await classifier.classifyWithFallback(ambiguousJob, failingResolver);

      expect(failingResolver.resolve).toHaveBeenCalledTimes(1);
      expect(result.classificationMethod).toBe('DEFAULT');
      expect(result.primarySpecialization).toBeNull();
    });

    it('prohibits AI invocation for calculating user-specific match scores', () => {
      // In accordance with TASK-31.1 specification, candidate match ranking must strictly
      // use deterministic heuristics (Primary specialization +50, Level +15, Region +15)
      // and never invoke AI providers.
      expect(classifier.isAmbiguous({ title: 'Senior Backend Engineer' })).toBe(false);
      expect(classifier.isAmbiguous({ title: 'Flutter Developer' })).toBe(false);
    });
  });

  describe('TASK-31.2: Gemini Provider Integration with Zod Schema Validation (#95)', () => {
    it('successfully parses and validates valid Gemini JSON response with Zod schema (Test Spec #95)', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        JSON.stringify({
          specialization: 'DEVOPS',
          confidence: 0.92,
          reasoning: 'Role requires managing Kubernetes clusters and CI/CD pipelines.',
        }),
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const result = await resolver.resolve({
        title: 'Platform Infrastructure Lead',
        description: 'Lead our cloud platform operations with Terraform and Helm.',
      });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(result.specialization).toBe(Specialization.DEVOPS);
      expect(result.confidence).toBe(0.92);
      expect(result.reasoning).toBe('Role requires managing Kubernetes clusters and CI/CD pipelines.');
    });

    it('unwraps and parses JSON wrapped in markdown code fences', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        '```json\n{\n  "specialization": "DATA",\n  "confidence": 0.89,\n  "reasoning": "Strong emphasis on Snowflake and dbt ETL workflows."\n}\n```',
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const result = await resolver.resolve({
        title: 'Modern Data Stack Specialist',
        description: 'Build dbt models and Snowflake data warehouses.',
      });

      expect(result.specialization).toBe(Specialization.DATA);
      expect(result.confidence).toBe(0.89);
      expect(result.reasoning).toContain('Snowflake');
    });

    it('rejects invalid JSON safely without throwing and returns UNRESOLVED (Test Spec #95)', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        'Sorry, I could not classify this role because it is not technical.',
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const result = await resolver.resolve({
        title: 'General Coordinator',
        description: 'Coordinate office supplies.',
      });

      expect(result.specialization).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toBe('Malformed JSON from LLM');
    });

    it('rejects unknown or invalid specialization enums via Zod schema (Test Spec #95)', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        JSON.stringify({
          specialization: 'BLOCKCHAIN_CRYPTO_DEV', // Invalid enum value
          confidence: 0.95,
          reasoning: 'Solidity and smart contract development.',
        }),
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const result = await resolver.resolve({
        title: 'Web3 Lead Engineer',
        description: 'Build smart contracts.',
      });

      expect(result.specialization).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('Zod validation error');
    });

    it('enforces input constraints (clean title + first 500 chars of description)', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        JSON.stringify({
          specialization: 'BACKEND',
          confidence: 0.85,
          reasoning: 'Extracted backend signals.',
        }),
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const veryLongDescription = 'a'.repeat(2000);
      await resolver.resolve({
        title: '   Senior Cloud Backend Engineer   ',
        description: veryLongDescription,
      });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const prompt = mockGenerateText.mock.calls[0][0];

      // Title should be trimmed
      expect(prompt).toContain('Job Title: Senior Cloud Backend Engineer');
      // Description should be truncated to first 500 characters
      expect(prompt).toContain('a'.repeat(500));
      expect(prompt).not.toContain('a'.repeat(501));

      // System instruction must match Issue #95 acceptance criteria
      expect(prompt).toContain(
        'SYSTEM: You are a job specialization classifier. Categorize the role into exactly one of the 10 allowed specializations.',
      );
    });

    it('gracefully handles empty response from Gemini', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue('');

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const result = await resolver.resolve({ title: 'Lead Coordinator' });

      expect(result.specialization).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toBe('Empty LLM response');
    });

    it('integrates seamlessly with classifyWithFallback in DeterministicJobClassifier', async () => {
      const mockGenerateText = vi.fn().mockResolvedValue(
        JSON.stringify({
          specialization: 'AI_ENGINEER',
          confidence: 0.91,
          reasoning: 'Role involves training neural networks and deploying LLM agents.',
        }),
      );

      const mockProvider: TextGenerator = {
        generateText: mockGenerateText,
      };

      const resolver = new GeminiAmbiguityResolver({ provider: mockProvider });

      const ambiguousJob = {
        title: 'Applied Intelligence Specialist',
        description: 'Researching novel transformer architectures and fine-tuning models.',
      };

      const result = await classifier.classifyWithFallback(ambiguousJob, resolver);

      expect(result.primarySpecialization).toBe(Specialization.AI_ENGINEER);
      expect(result.confidence).toBe(0.91);
      expect(result.classificationMethod).toBe('AI_FALLBACK');
    });
  });

  describe('TASK-30.1: 100-Job Benchmark Fixture Suite (>= 90% Accuracy Acceptance Criterion)', () => {
    interface BenchmarkCase {
      title: string;
      expected: Specialization;
    }

    const BENCHMARK_100_TITLES: BenchmarkCase[] = [
      // 1. BACKEND (10)
      { title: 'Senior Node.js Backend Engineer', expected: Specialization.BACKEND },
      { title: 'Lead Rust Systems Engineer', expected: Specialization.BACKEND },
      { title: 'Golang Developer (Microservices)', expected: Specialization.BACKEND },
      { title: 'Senior Python & Django Developer', expected: Specialization.BACKEND },
      { title: 'C# / .NET Core Web API Engineer', expected: Specialization.BACKEND },
      { title: 'Java Spring Boot Software Engineer', expected: Specialization.BACKEND },
      { title: 'PHP / Laravel Backend Developer', expected: Specialization.BACKEND },
      { title: 'Ruby on Rails Developer', expected: Specialization.BACKEND },
      { title: 'مطور خلفي (Node.js & PostgreSQL)', expected: Specialization.BACKEND },
      { title: 'مهندس برمجيات باك اند (Go / Docker)', expected: Specialization.BACKEND },

      // 2. FRONTEND (10)
      { title: 'Senior React.js Frontend Engineer', expected: Specialization.FRONTEND },
      { title: 'Vue.js Web Application Developer', expected: Specialization.FRONTEND },
      { title: 'Angular 17 Frontend Developer', expected: Specialization.FRONTEND },
      { title: 'Next.js & TypeScript UI Developer', expected: Specialization.FRONTEND },
      { title: 'Lead Frontend Developer (Tailwind CSS)', expected: Specialization.FRONTEND },
      { title: 'Nuxt.js Web Developer', expected: Specialization.FRONTEND },
      { title: 'Svelte & SvelteKit Web Engineer', expected: Specialization.FRONTEND },
      { title: 'مطور واجهات أمامية (React / Redux)', expected: Specialization.FRONTEND },
      { title: 'مهندس واجهات مستخدم (Vue / Tailwind)', expected: Specialization.FRONTEND },
      { title: 'فرونت اند ديفلوبر (Angular)', expected: Specialization.FRONTEND },

      // 3. FULLSTACK (10)
      { title: 'Senior Full Stack Developer (React / Node)', expected: Specialization.FULLSTACK },
      { title: 'Lead Full-Stack Engineer (Next.js & NestJS)', expected: Specialization.FULLSTACK },
      { title: 'Fullstack Web Developer (MERN Stack)', expected: Specialization.FULLSTACK },
      { title: 'MEAN Stack Engineer', expected: Specialization.FULLSTACK },
      { title: 'Staff Full Stack Software Engineer', expected: Specialization.FULLSTACK },
      { title: 'Junior Full-Stack Developer', expected: Specialization.FULLSTACK },
      { title: 'Full Stack JavaScript Developer', expected: Specialization.FULLSTACK },
      { title: 'مطور شامل (Full Stack Developer)', expected: Specialization.FULLSTACK },
      { title: 'مهندس برمجيات فول ستاك', expected: Specialization.FULLSTACK },
      { title: 'مطور ويب شامل (MERN)', expected: Specialization.FULLSTACK },

      // 4. MOBILE (10)
      { title: 'Senior Flutter Mobile Developer', expected: Specialization.MOBILE },
      { title: 'Lead React Native Engineer', expected: Specialization.MOBILE },
      { title: 'Native iOS Developer (Swift & SwiftUI)', expected: Specialization.MOBILE },
      { title: 'Android Application Engineer (Kotlin)', expected: Specialization.MOBILE },
      { title: 'Cross-Platform Mobile Engineer (Flutter)', expected: Specialization.MOBILE },
      { title: 'Staff iOS Mobile Engineer', expected: Specialization.MOBILE },
      { title: 'Junior Android Developer', expected: Specialization.MOBILE },
      { title: 'مطور تطبيقات جوال (Flutter)', expected: Specialization.MOBILE },
      { title: 'مهندس تطبيقات ايفون (iOS / Swift)', expected: Specialization.MOBILE },
      { title: 'مطور تطبيقات موبايل (React Native)', expected: Specialization.MOBILE },

      // 5. DEVOPS (10)
      { title: 'Senior DevOps Engineer (AWS & Kubernetes)', expected: Specialization.DEVOPS },
      { title: 'Lead Site Reliability Engineer (SRE)', expected: Specialization.DEVOPS },
      { title: 'Cloud Infrastructure Engineer (Terraform)', expected: Specialization.DEVOPS },
      { title: 'Platform Engineer (Docker & K8s)', expected: Specialization.DEVOPS },
      { title: 'DevOps & CI/CD Automation Specialist', expected: Specialization.DEVOPS },
      { title: 'Senior Systems Administrator (SysAdmin)', expected: Specialization.DEVOPS },
      { title: 'Cloud Architect & DevOps Consultant', expected: Specialization.DEVOPS },
      { title: 'مهندس سحابي (Cloud & DevOps)', expected: Specialization.DEVOPS },
      { title: 'مهندس بنية تحتية سحابية (Kubernetes)', expected: Specialization.DEVOPS },
      { title: 'ديف اوبس انجنير (AWS / Terraform)', expected: Specialization.DEVOPS },

      // 6. UIUX (10)
      { title: 'Senior UI/UX Designer', expected: Specialization.UIUX },
      { title: 'Lead Product Designer (Figma)', expected: Specialization.UIUX },
      { title: 'UX/UI Designer & Prototyper', expected: Specialization.UIUX },
      { title: 'User Experience Researcher & Designer', expected: Specialization.UIUX },
      { title: 'Visual UI Designer (Design Systems)', expected: Specialization.UIUX },
      { title: 'Interaction Designer (Web & Mobile)', expected: Specialization.UIUX },
      { title: 'Staff Product Designer (UX/UI)', expected: Specialization.UIUX },
      { title: 'مصمم واجهات وتجربة المستخدم (UI/UX)', expected: Specialization.UIUX },
      { title: 'مصمم منتجات رقمية (Figma / UI)', expected: Specialization.UIUX },
      { title: 'أخصائي تجربة المستخدم (UX Designer)', expected: Specialization.UIUX },

      // 7. DATA (10)
      { title: 'Senior Data Engineer (Spark & Airflow)', expected: Specialization.DATA },
      { title: 'Lead Data Analyst (Tableau & Power BI)', expected: Specialization.DATA },
      { title: 'Data Scientist (Predictive Analytics)', expected: Specialization.DATA },
      { title: 'Business Intelligence (BI) Engineer', expected: Specialization.DATA },
      { title: 'Analytics Engineer (dbt & Snowflake)', expected: Specialization.DATA },
      { title: 'Senior SQL Database Developer', expected: Specialization.DATA },
      { title: 'ETL Data Pipeline Engineer', expected: Specialization.DATA },
      { title: 'مهندس بيانات ضخمة (Big Data)', expected: Specialization.DATA },
      { title: 'محلل بيانات أول (Data Analyst)', expected: Specialization.DATA },
      { title: 'أخصائي علم البيانات والذكاء التجاري', expected: Specialization.DATA },

      // 8. QA (10)
      { title: 'Senior QA Automation Engineer (Playwright)', expected: Specialization.QA },
      { title: 'Lead Software Development Engineer in Test (SDET)', expected: Specialization.QA },
      { title: 'Quality Assurance Specialist (Cypress)', expected: Specialization.QA },
      { title: 'Manual & Automation Test Engineer', expected: Specialization.QA },
      { title: 'Senior Selenium Automation Tester', expected: Specialization.QA },
      { title: 'Mobile QA Engineer (Appium)', expected: Specialization.QA },
      { title: 'Performance & QC Test Engineer', expected: Specialization.QA },
      { title: 'مهندس فحص جودة البرمجيات (QA Engineer)', expected: Specialization.QA },
      { title: 'فاحص برمجيات آلي (Test Automation)', expected: Specialization.QA },
      { title: 'أخصائي ضمان الجودة (Software Testing)', expected: Specialization.QA },

      // 9. SECURITY (10)
      { title: 'Senior Cybersecurity Engineer', expected: Specialization.SECURITY },
      { title: 'Lead Information Security Analyst (InfoSec)', expected: Specialization.SECURITY },
      { title: 'Application Security Engineer (AppSec)', expected: Specialization.SECURITY },
      { title: 'Penetration Tester (Ethical Hacker)', expected: Specialization.SECURITY },
      { title: 'SOC Analyst (Level 2)', expected: Specialization.SECURITY },
      { title: 'Cloud Security Engineer (SIEM / OWASP)', expected: Specialization.SECURITY },
      { title: 'Vulnerability Assessment & Pentester', expected: Specialization.SECURITY },
      { title: 'مهندس أمن سيبراني (Cybersecurity)', expected: Specialization.SECURITY },
      { title: 'محلل أمن معلومات (InfoSec Analyst)', expected: Specialization.SECURITY },
      { title: 'مختبر اختراق أمني (Penetration Tester)', expected: Specialization.SECURITY },

      // 10. AI_ENGINEER (10)
      { title: 'Senior AI Engineer (LLMs & Generative AI)', expected: Specialization.AI_ENGINEER },
      { title: 'Lead Machine Learning Engineer (MLOps)', expected: Specialization.AI_ENGINEER },
      { title: 'Deep Learning & Computer Vision Scientist', expected: Specialization.AI_ENGINEER },
      { title: 'Natural Language Processing (NLP) Engineer', expected: Specialization.AI_ENGINEER },
      { title: 'AI Developer (LangChain & PyTorch)', expected: Specialization.AI_ENGINEER },
      { title: 'Prompt Engineer & LLM Specialist', expected: Specialization.AI_ENGINEER },
      { title: 'Artificial Intelligence Research Engineer', expected: Specialization.AI_ENGINEER },
      { title: 'مهندس ذكاء اصطناعي (AI Engineer)', expected: Specialization.AI_ENGINEER },
      { title: 'مهندس تعلم الآلة (Machine Learning)', expected: Specialization.AI_ENGINEER },
      { title: 'مطور نماذج لغوية (LLM & GenAI Developer)', expected: Specialization.AI_ENGINEER },
    ];

    it('verifies exact benchmark suite contains 100 job titles', () => {
      expect(BENCHMARK_100_TITLES.length).toBe(100);
    });

    it('achieves >= 90% accuracy on the 100 benchmark job titles', () => {
      let correctMatches = 0;
      const failedMatches: Array<{ title: string; expected: Specialization; actual: Specialization | null }> = [];

      for (const item of BENCHMARK_100_TITLES) {
        const result = classifier.classifyTitle(item.title);
        const actual = result?.primarySpecialization ?? null;

        if (actual === item.expected) {
          correctMatches++;
        } else {
          failedMatches.push({ title: item.title, expected: item.expected, actual });
        }
      }

      const accuracyPercentage = (correctMatches / BENCHMARK_100_TITLES.length) * 100;

      if (failedMatches.length > 0) {
        console.warn(`Failed benchmark cases (${failedMatches.length}):`, failedMatches);
      }

      expect(accuracyPercentage).toBeGreaterThanOrEqual(90);
      expect(accuracyPercentage).toBe(100);
    });
  });

  describe('TASK-33.1: 4-Tier Scope Categorization (WORLDWIDE, REGION, COUNTRY, UNKNOWN) (#99)', () => {
    // Acceptance Test Specs from Issue #99
    it('classifies "Remote Frontend Engineer (Must reside in Germany)" as COUNTRY (DE) (Test Spec #99)', () => {
      const result = classifier.classify({
        title: 'Remote Frontend Engineer (Must reside in Germany)',
      });

      expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
      expect(result.country).toBe('DE');
      expect(result.remoteScopeEvidence).toContain('DE');
    });

    it('classifies "Remote Node.js Developer (Worldwide / Work from anywhere)" as WORLDWIDE (Test Spec #99)', () => {
      const result = classifier.classify({
        title: 'Remote Node.js Developer (Worldwide / Work from anywhere)',
      });

      expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
      expect(result.country).toBeNull();
      expect(result.remoteScopeEvidence).toContain('Worldwide');
    });

    describe('Country Restriction Parsing (ISO-2 Mappings)', () => {
      it.each([
        ['Remote Fullstack Engineer - USA only', RemoteScope.COUNTRY, 'US'],
        ['Senior Backend Developer (Must be based in Egypt)', RemoteScope.COUNTRY, 'EG'],
        ['DevOps Engineer (UK residents only)', RemoteScope.COUNTRY, 'GB'],
        ['QA Engineer (Based in Canada)', RemoteScope.COUNTRY, 'CA'],
        ['Cloud Engineer (Must reside in France)', RemoteScope.COUNTRY, 'FR'],
        ['Fullstack Developer (Based in Netherlands)', RemoteScope.COUNTRY, 'NL'],
        ['مطور واجهات عن بعد - السعودية فقط', RemoteScope.COUNTRY, 'SA'],
        ['مهندس برمجيات (يشترط الإقامة في الإمارات)', RemoteScope.COUNTRY, 'AE'],
        ['مبرمج بايثون (للمقيمين في الأردن)', RemoteScope.COUNTRY, 'JO'],
        ['فاحص جودة برمجيات (داخل مصر فقط)', RemoteScope.COUNTRY, 'EG'],
      ])('classifies "%s" as scope %s with country %s', (title, expectedScope, expectedCountry) => {
        const result = classifier.classify({ title });
        expect(result.remoteScope).toBe(expectedScope);
        expect(result.country).toBe(expectedCountry);
      });
    });

    describe('Regional Scope Parsing', () => {
      it.each([
        ['Mobile Developer (MENA Region)', RemoteScope.REGION],
        ['Data Analyst (Europe / EU remote)', RemoteScope.REGION],
        ['Cloud Architect (LATAM remote)', RemoteScope.REGION],
        ['Site Reliability Engineer (GCC Remote)', RemoteScope.REGION],
        ['مطور تطبيقات (الشرق الأوسط والخليج)', RemoteScope.REGION],
        ['مهندس بيانات (شمال إفريقيا)', RemoteScope.REGION],
      ])('classifies "%s" as %s', (title, expectedScope) => {
        const result = classifier.classify({ title });
        expect(result.remoteScope).toBe(expectedScope);
      });
    });

    describe('Worldwide Scope & The Golden Rule', () => {
      it.each([
        ['Senior Software Engineer (Work from anywhere)', RemoteScope.WORLDWIDE],
        ['Node.js Developer (Anywhere in the world)', RemoteScope.WORLDWIDE],
        ['Rust Systems Engineer (Global Remote)', RemoteScope.WORLDWIDE],
        ['مبرمج بايثون عن بعد (من أي مكان في العالم)', RemoteScope.WORLDWIDE],
      ])('classifies "%s" as %s with affirmative evidence', (title, expectedScope) => {
        const result = classifier.classify({ title });
        expect(result.remoteScope).toBe(expectedScope);
        expect(result.country).toBeNull();
      });

      it('classifies location "Anywhere" as WORLDWIDE', () => {
        const result = classifier.classify({
          title: 'Fullstack Engineer',
          location: 'Anywhere',
        });
        expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
      });
    });

    describe('Precedence & Contradiction Resolution', () => {
      it('resolves contradiction in favor of geographic restriction over generic remote claim', () => {
        const result = classifier.classify({
          title: 'Remote Software Engineer',
          description: 'This is a remote position. Candidates must reside in Germany and possess valid EU work permits.',
        });

        // Golden Rule: Geographic restriction strictly overrides generic remote claim
        expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
        expect(result.country).toBe('DE');
        expect(result.remoteScopeEvidence).toContain('DE');
      });

      it('leaves postings without remote evidence or location as UNKNOWN', () => {
        const result = classifier.classify({
          title: 'Senior Software Engineer',
          description: 'Build backend APIs and collaborate with team members on feature roadmaps.',
        });

        expect(result.remoteScope).toBe(RemoteScope.UNKNOWN);
        expect(result.country).toBeNull();
      });
    });
  });

  describe('TASK-33.2: Evidence-Based Confidence Scoring & Contradiction Detection (#100)', () => {
    describe('Confidence Scoring Calibration', () => {
      it('assigns high confidence (0.95) for explicit country in title', () => {
        const result = classifier.classify({
          title: 'Backend Engineer (Remote - USA only)',
        });
        expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
        expect(result.country).toBe('US');
        expect(result.remoteConfidence).toBe(0.95);
      });

      it('assigns high confidence (0.95) for structured country metadata', () => {
        const result = classifier.classify({
          title: 'Fullstack Engineer',
          country: 'EG',
        });
        expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
        expect(result.country).toBe('EG');
        expect(result.remoteConfidence).toBe(0.95);
      });

      it('assigns 0.85 confidence for country restriction in description only', () => {
        const result = classifier.classify({
          title: 'Senior DevOps Specialist',
          description: 'Great team and culture. Candidates must reside in Germany.',
        });
        expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
        expect(result.country).toBe('DE');
        expect(result.remoteConfidence).toBe(0.85);
      });

      it('assigns 0.95 confidence for affirmative worldwide in title', () => {
        const result = classifier.classify({
          title: 'Site Reliability Engineer (Work from anywhere)',
        });
        expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
        expect(result.remoteConfidence).toBe(0.95);
      });

      it('assigns 0.85 confidence for affirmative worldwide in description', () => {
        const result = classifier.classify({
          title: 'Senior Cloud Engineer',
          description: 'Our company is 100% remote. You can work anywhere in the world.',
        });
        expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
        expect(result.remoteConfidence).toBe(0.85);
      });

      it('assigns 0.0 confidence when remote scope is UNKNOWN', () => {
        const result = classifier.classify({
          title: 'Java Developer',
          description: 'Responsible for backend services and spring boot components.',
        });
        expect(result.remoteScope).toBe(RemoteScope.UNKNOWN);
        expect(result.remoteConfidence).toBe(0.0);
      });
    });

    describe('Contradiction Detection & Arbitration', () => {
      it('detects contradiction and overrides generic "Remote" with Country constraint (Test Spec #100)', () => {
        const directResult = remoteScopeClassifier.classify({
          title: 'Remote Senior Python Developer',
          description: 'This is a remote role. However, candidates must reside in Germany for payroll compliance.',
        });

        expect(directResult.scope).toBe(RemoteScope.COUNTRY);
        expect(directResult.country).toBe('DE');
        expect(directResult.hasContradiction).toBe(true);
        expect(directResult.evidence).toContain('Contradiction resolved');
      });

      it('detects contradiction when title says Worldwide but description restricts to MENA region', () => {
        const directResult = remoteScopeClassifier.classify({
          title: 'Worldwide Frontend Engineer',
          description: 'We are hiring across the MENA region only.',
        });

        expect(directResult.scope).toBe(RemoteScope.REGION);
        expect(directResult.hasContradiction).toBe(true);
        expect(directResult.evidence).toContain('Contradiction resolved');
      });

      it('detects contradiction when location is Anywhere but description specifies UK only', () => {
        const directResult = remoteScopeClassifier.classify({
          title: 'Security Analyst',
          location: 'Anywhere',
          description: 'Notice: Only for residents of United Kingdom.',
        });

        expect(directResult.scope).toBe(RemoteScope.COUNTRY);
        expect(directResult.country).toBe('GB');
        expect(directResult.hasContradiction).toBe(true);
      });

      it('marks hasContradiction false when title and constraints are aligned', () => {
        const directResult = remoteScopeClassifier.classify({
          title: 'Frontend Engineer (Work from anywhere)',
          description: 'Join our fully global remote team!',
        });

        expect(directResult.scope).toBe(RemoteScope.WORLDWIDE);
        expect(directResult.hasContradiction).toBe(false);
      });
    });
  });

  describe('Remote Scope Resolution', () => {
    it('detects Worldwide remote scope from explicit keywords', () => {
      const result = classifier.classify({
        title: 'Software Engineer (Worldwide Remote)',
        location: 'Anywhere',
      });

      expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
    });

    it('detects Region remote scope for MENA / GCC / Arab regions', () => {
      const result = classifier.classify({
        title: 'Backend Engineer',
        location: 'MENA Region (Remote)',
      });

      expect(result.remoteScope).toBe(RemoteScope.REGION);
    });

    it('detects Country remote scope when country or city is specified', () => {
      const result = classifier.classify({
        title: 'Frontend Developer',
        country: 'Egypt',
        location: 'Cairo, Egypt',
      });

      expect(result.remoteScope).toBe(RemoteScope.COUNTRY);
    });

    it('falls back to Worldwide if remote flag is true without restrictions', () => {
      const result = classifier.classify({
        title: 'Fullstack Developer',
        remote: true,
      });

      expect(result.remoteScope).toBe(RemoteScope.WORLDWIDE);
    });
  });

  describe('TASK-32.1: Seniority Heuristic Engine (Junior, Mid, Senior, Unknown) (#97)', () => {
    // Acceptance Test Specs from Issue #97
    it('classifies "Lead Software Architect" as SENIOR (Test Spec #97)', () => {
      const result = classifier.classify({
        title: 'Lead Software Architect',
      });
      expect(result.experienceLevel).toBe(ExperienceLevel.SENIOR);
    });

    it('classifies "Entry Level Python Developer" as JUNIOR (Test Spec #97)', () => {
      const result = classifier.classify({
        title: 'Entry Level Python Developer',
      });
      expect(result.experienceLevel).toBe(ExperienceLevel.JUNIOR);
    });

    describe('English Seniority Title Tokens', () => {
      it.each([
        ['Senior Backend Engineer', ExperienceLevel.SENIOR],
        ['Sr. Fullstack Developer', ExperienceLevel.SENIOR],
        ['Staff Site Reliability Engineer', ExperienceLevel.SENIOR],
        ['Principal Cloud Architect', ExperienceLevel.SENIOR],
        ['Head of Engineering', ExperienceLevel.SENIOR],
        ['Tech Lead - Mobile Apps', ExperienceLevel.SENIOR],
        ['Team Lead / Senior QA Engineer', ExperienceLevel.SENIOR],
        ['Expert Data Scientist', ExperienceLevel.SENIOR],
        ['Junior Frontend Developer', ExperienceLevel.JUNIOR],
        ['Jr. Software Engineer', ExperienceLevel.JUNIOR],
        ['Associate Product Designer', ExperienceLevel.JUNIOR],
        ['Fresh Graduate AI Engineer', ExperienceLevel.JUNIOR],
        ['Software Engineering Intern', ExperienceLevel.JUNIOR],
        ['QA Automation Trainee', ExperienceLevel.JUNIOR],
        ['Mid-Level Node.js Developer', ExperienceLevel.MID],
        ['Intermediate Python Engineer', ExperienceLevel.MID],
        ['Medior DevOps Engineer', ExperienceLevel.MID],
      ])('classifies title "%s" as %s', (title, expectedLevel) => {
        const result = classifier.classify({ title });
        expect(result.experienceLevel).toBe(expectedLevel);
      });
    });

    describe('Arabic Seniority Title Tokens', () => {
      it.each([
        ['مطور برمجيات خبير', ExperienceLevel.SENIOR],
        ['مهندس خلفيات أول', ExperienceLevel.SENIOR],
        ['سينيور فرونت إند', ExperienceLevel.SENIOR],
        ['قائد فريق البيانات', ExperienceLevel.SENIOR],
        ['معماري حلول سحابية', ExperienceLevel.SENIOR],
        ['مطور واجهات مبتدئ', ExperienceLevel.JUNIOR],
        ['مهندس حاسوب حديث التخرج', ExperienceLevel.JUNIOR],
        ['متدرب أمن سيبراني', ExperienceLevel.JUNIOR],
        ['مساعد فاحص جودة برمجيات', ExperienceLevel.JUNIOR],
        ['مطور تطبيقات متوسط الخبرة', ExperienceLevel.MID],
        ['مصمم واجهات متوسط', ExperienceLevel.MID],
      ])('classifies Arabic title "%s" as %s', (title, expectedLevel) => {
        const result = classifier.classify({ title });
        expect(result.experienceLevel).toBe(expectedLevel);
      });
    });

    describe('Years of Experience Extraction Cues', () => {
      it('classifies 5+ years in description as SENIOR when title is generic', () => {
        const result = classifier.classify({
          title: 'Software Engineer',
          description: 'Looking for an experienced engineer with 5+ years of experience in distributed systems.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.SENIOR);
      });

      it('classifies Arabic 5+ years cue as SENIOR', () => {
        const result = classifier.classify({
          title: 'مطور برمجيات',
          description: 'يشترط وجود خبرة +5 سنوات في تطوير تطبيقات الويب.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.SENIOR);
      });

      it('classifies 3-5 years range as MID when title is generic', () => {
        const result = classifier.classify({
          title: 'Web Developer',
          description: 'Requires 3-5 years of experience with React and TypeScript.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.MID);
      });

      it('classifies 0-2 years range as JUNIOR when title is generic', () => {
        const result = classifier.classify({
          title: 'Node.js Developer',
          description: 'Great opportunity for candidates with 0-2 years experience.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.JUNIOR);
      });

      it('classifies "under 2 years" cue as JUNIOR', () => {
        const result = classifier.classify({
          title: 'Fullstack Developer',
          description: 'Suitable for developers with less than 2 years of professional background.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.JUNIOR);
      });
    });

    describe('Precedence, Contradiction, and Conservative Fallback', () => {
      it('prioritizes structured experienceLevel from source when provided', () => {
        const result = classifier.classify({
          title: 'Software Engineer',
          experienceLevel: 'SENIOR',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.SENIOR);
      });

      it('returns UNKNOWN when contradictory seniority tokens are present in title', () => {
        const result = classifier.classify({
          title: 'Junior / Senior Software Engineer',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.UNKNOWN);
      });

      it('leaves generic titles without seniority cues as UNKNOWN (do not invent certainty)', () => {
        const result = classifier.classify({
          title: 'Python Developer',
          description: 'Build backend APIs and collaborate with team members on feature roadmaps.',
        });
        expect(result.experienceLevel).toBe(ExperienceLevel.UNKNOWN);
      });
    });
  });

  describe('TASK-32.2: Contract & Employment Type Heuristic Engine (#98)', () => {
    // Acceptance Test Spec from Issue #98
    it('classifies "Freelance React Developer - 3 months contract" as CONTRACT (Test Spec #98)', () => {
      const result = classifier.classify({
        title: 'Freelance React Developer - 3 months contract',
      });
      expect(result.workType).toBe(WorkType.CONTRACT);
    });

    describe('English Work Type Title Tokens', () => {
      it.each([
        ['Fullstack Engineer (Contract)', WorkType.CONTRACT],
        ['Freelance Node.js Developer', WorkType.CONTRACT],
        ['Cloud Infrastructure Consultant', WorkType.CONTRACT],
        ['Temporary Python Engineer', WorkType.CONTRACT],
        ['Frontend Developer (6 months contract)', WorkType.CONTRACT],
        ['Project-Based SRE Specialist', WorkType.CONTRACT],
        ['Backend Developer (Part-Time)', WorkType.PART_TIME],
        ['Part-Time UI/UX Designer', WorkType.PART_TIME],
        ['Parttime Mobile Developer', WorkType.PART_TIME],
        ['Software Engineering Intern', WorkType.INTERNSHIP],
        ['AI / Machine Learning Trainee', WorkType.INTERNSHIP],
        ['QA Automation Co-op Student', WorkType.INTERNSHIP],
        ['Senior DevOps Engineer (Full-Time)', WorkType.FULL_TIME],
        ['Permanent Java Developer', WorkType.FULL_TIME],
        ['Direct-Hire Security Engineer', WorkType.FULL_TIME],
      ])('classifies title "%s" as %s', (title, expectedType) => {
        const result = classifier.classify({ title });
        expect(result.workType).toBe(expectedType);
      });
    });

    describe('Arabic Work Type Title Tokens', () => {
      it.each([
        ['مطور برمجيات (عقد مؤقت)', WorkType.CONTRACT],
        ['مبرمج بايثون مستقل', WorkType.CONTRACT],
        ['مهندس سحابي عمل حر', WorkType.CONTRACT],
        ['مطور واجهات فريلانسر', WorkType.CONTRACT],
        ['مطور واجهات دوام جزئي', WorkType.PART_TIME],
        ['فاحص برمجيات عمل جزئي', WorkType.PART_TIME],
        ['متدرب ذكاء اصطناعي', WorkType.INTERNSHIP],
        ['تدريب تعاوني هندسة برمجيات', WorkType.INTERNSHIP],
        ['مهندس نظم دوام كامل', WorkType.FULL_TIME],
        ['مطور خلفيات وظيفة دائمة', WorkType.FULL_TIME],
        ['تفرغ تام مطور تطبيقات', WorkType.FULL_TIME],
      ])('classifies Arabic title "%s" as %s', (title, expectedType) => {
        const result = classifier.classify({ title });
        expect(result.workType).toBe(expectedType);
      });
    });

    describe('Description Work Type Heuristics', () => {
      it('classifies CONTRACT from description when title is generic', () => {
        const result = classifier.classify({
          title: 'React Developer',
          description: 'This is a 6 months contract with potential for extension.',
        });
        expect(result.workType).toBe(WorkType.CONTRACT);
      });

      it('classifies FULL_TIME from description when title is generic', () => {
        const result = classifier.classify({
          title: 'Backend Engineer',
          description: 'Full-time position with comprehensive healthcare and 401k benefits.',
        });
        expect(result.workType).toBe(WorkType.FULL_TIME);
      });

      it('classifies PART_TIME from Arabic description when title is generic', () => {
        const result = classifier.classify({
          title: 'مطور واجهات',
          description: 'الفرصة عبارة عن عمل جزئي بمعدل 20 ساعة أسبوعياً.',
        });
        expect(result.workType).toBe(WorkType.PART_TIME);
      });

      it('classifies INTERNSHIP from description when title is generic', () => {
        const result = classifier.classify({
          title: 'Data Analyst',
          description: 'Summer internship program for university students.',
        });
        expect(result.workType).toBe(WorkType.INTERNSHIP);
      });
    });

    describe('Precedence, Contradiction, and Conservative Fallback', () => {
      it('prioritizes structured workType from source metadata when provided', () => {
        const result = classifier.classify({
          title: 'Software Engineer',
          workType: 'CONTRACT',
        });
        expect(result.workType).toBe(WorkType.CONTRACT);
      });

      it('normalizes source variations (e.g. FREELANCE -> CONTRACT, PERMANENT -> FULL_TIME)', () => {
        expect(
          classifier.classify({ title: 'Engineer', workType: 'FREELANCE' }).workType,
        ).toBe(WorkType.CONTRACT);
        expect(
          classifier.classify({ title: 'Engineer', workType: 'PERMANENT' }).workType,
        ).toBe(WorkType.FULL_TIME);
      });

      it('returns UNKNOWN when contradictory work type tokens are in title', () => {
        const result = classifier.classify({
          title: 'Full-time / Part-time Software Engineer',
        });
        expect(result.workType).toBe(WorkType.UNKNOWN);
      });

      it('leaves generic titles without work type cues as UNKNOWN (do not invent certainty)', () => {
        const result = classifier.classify({
          title: 'Backend Developer',
          description: 'Build microservices and contribute to architectural decisions.',
        });
        expect(result.workType).toBe(WorkType.UNKNOWN);
      });
    });
  });

  describe('Experience Level and Work Type Resolution', () => {
    it('detects Senior level from title', () => {
      const result = classifier.classify({
        title: 'Senior Software Engineer',
      });

      expect(result.experienceLevel).toBe(ExperienceLevel.SENIOR);
    });

    it('detects Junior / Entry level from title', () => {
      const result = classifier.classify({
        title: 'Junior Web Developer (Fresh Graduate)',
      });

      expect(result.experienceLevel).toBe(ExperienceLevel.JUNIOR);
    });

    it('detects Contract work type from keywords', () => {
      const result = classifier.classify({
        title: 'Backend Developer (Freelance / Contract)',
      });

      expect(result.workType).toBe(WorkType.CONTRACT);
    });

    it('detects Full Time work type as standard default', () => {
      const result = classifier.classify({
        title: 'Backend Developer (Full-Time)',
      });

      expect(result.workType).toBe(WorkType.FULL_TIME);
    });
  });

  describe('TASK-31.3: Graceful Degradation on AI Outage (#96)', () => {
    it('aborts with timeout and returns UNRESOLVED when AI provider exceeds timeoutMs', async () => {
      // Mock provider that hangs/delays
      const hangingProvider = {
        generateText: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('{"specialization":"BACKEND"}'), 100)),
        ),
      };

      const resolver = new GeminiAmbiguityResolver({
        provider: hangingProvider,
        timeoutMs: 25, // 25ms timeout for fast test execution
      });

      const outcome = await resolver.resolve({
        title: 'Technical Solutions Architect Lead',
        description: 'Lead enterprise architecture solutions.',
      });

      expect(outcome.specialization).toBeNull();
      expect(outcome.confidence).toBe(0);
      expect(outcome.reasoning).toContain('timed out');
    });

    it('returns UNRESOLVED on AI provider network errors or invalid keys without throwing', async () => {
      const failingProvider = {
        generateText: vi.fn().mockRejectedValue(new Error('GoogleGenAI: API_KEY_INVALID')),
      };

      const resolver = new GeminiAmbiguityResolver({ provider: failingProvider });

      const outcome = await resolver.resolve({
        title: 'Enterprise Technical Specialist',
      });

      expect(outcome.specialization).toBeNull();
      expect(outcome.confidence).toBe(0);
      expect(outcome.reasoning).toContain('API_KEY_INVALID');
    });

    it('leaves ambiguous jobs as UNRESOLVED when AI fails in classifyWithFallback', async () => {
      const failingResolver: AmbiguityResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('AI Outage 503')),
      };

      const ambiguousJob = {
        title: 'General Technical Coordinator',
        description: 'Coordinate across general business teams.',
      };

      const result = await classifier.classifyWithFallback(ambiguousJob, failingResolver);

      expect(result.primarySpecialization).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.classificationMethod).toBe('DEFAULT');
    });

    it('keeps deterministic classification intact and unaffected during AI outage', async () => {
      const failingResolver: AmbiguityResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Total AI Outage')),
      };

      const deterministicJob = {
        title: 'Senior React Frontend Developer',
        skills: ['React', 'TypeScript'],
      };

      const result = await classifier.classifyWithFallback(deterministicJob, failingResolver);

      // AI resolver was NOT even called because title-first deterministic classification was high-confidence
      expect(failingResolver.resolve).toHaveBeenCalledTimes(0);
      expect(result.primarySpecialization).toBe(Specialization.FRONTEND);
      expect(result.confidence).toBe(0.95);
      expect(result.classificationMethod).toBe('RULE_TITLE');
    });
  });
});

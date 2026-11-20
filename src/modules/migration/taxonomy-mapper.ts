import ms from 'ms';
import {
  Specialization,
  RegionPreference,
  ExperienceLevelPreference,
  WorkTypePreference,
} from '../preferences/preference.taxonomy.js';

export interface V1PreferenceInput {
  jobTitle?: string | null;
  workType?: string | null;
  experienceLevel?: string | null;
  location?: string | null;
  skills?: string[] | null;
  timezone?: string | null;
  notificationTimes?: string[] | null;
}

export interface TaxonomyMappingResult {
  specializations: Specialization[];
  experienceLevel: ExperienceLevelPreference | null;
  workType: WorkTypePreference | null;
  regionPreference: RegionPreference;
  isAmbiguous: boolean;
  confidence: number;
  unmappedKeywords: string[];
  suggestedReconfirmation: boolean;
  notes?: string;
}

interface TaxonomyRule {
  specialization: Specialization;
  keywords: string[];
  weight: number;
}

const TAXONOMY_RULES: TaxonomyRule[] = [
  {
    specialization: Specialization.BACKEND,
    keywords: [
      'backend', 'back-end', 'back end', 'node', 'nodejs', 'node.js', 'express',
      'nestjs', 'nest.js', 'django', 'fastapi', 'flask', 'spring', 'springboot',
      'spring boot', 'java', 'golang', 'go developer', 'ruby', 'rails', 'ruby on rails',
      'php', 'laravel', 'c#', '.net', 'asp.net', 'dotnet', 'postgres', 'postgresql',
      'sql', 'mongodb', 'server-side', 'microservices', 'rust',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.FRONTEND,
    keywords: [
      'frontend', 'front-end', 'front end', 'react', 'reactjs', 'react.js',
      'vue', 'vuejs', 'vue.js', 'angular', 'angularjs', 'svelte', 'sveltekit',
      'nextjs', 'next.js', 'nuxtjs', 'nuxt.js', 'html', 'css', 'tailwind',
      'bootstrap', 'sass', 'redux', 'web developer', 'ui developer',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.FULLSTACK,
    keywords: [
      'fullstack', 'full-stack', 'full stack', 'mern', 'mean', 'mevn',
      'lamp', 'web engineer', 'full stack engineer',
    ],
    weight: 1.2,
  },
  {
    specialization: Specialization.MOBILE,
    keywords: [
      'mobile', 'ios', 'android', 'swift', 'swiftui', 'kotlin', 'flutter',
      'react native', 'react-native', 'dart', 'xamarin', 'mobile developer',
      'app developer',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.DEVOPS,
    keywords: [
      'devops', 'dev ops', 'sre', 'site reliability', 'cloud', 'aws', 'azure',
      'gcp', 'google cloud', 'kubernetes', 'k8s', 'docker', 'terraform',
      'ci/cd', 'cicd', 'jenkins', 'ansible', 'helm', 'infrastructure', 'sysadmin',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.UIUX,
    keywords: [
      'ui/ux', 'ui-ux', 'ui ux', 'ux', 'ui', 'ui designer', 'ux designer',
      'product designer', 'figma', 'sketch', 'adobe xd', 'wireframe',
      'prototyping', 'user experience', 'user interface',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.DATA,
    keywords: [
      'data', 'data scientist', 'data engineer', 'data analyst', 'data science',
      'database administrator', 'dba', 'bi developer', 'business intelligence',
      'etl', 'data warehouse', 'spark', 'hadoop', 'snowflake', 'bigquery',
      'tableau', 'power bi', 'analytics', 'analyst',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.QA,
    keywords: [
      'qa', 'quality assurance', 'testing', 'tester', 'test engineer',
      'automation tester', 'sdet', 'selenium', 'cypress', 'playwright',
      'jest', 'manual tester', 'qc', 'quality control',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.SECURITY,
    keywords: [
      'security', 'cyber', 'cybersecurity', 'infosec', 'penetration',
      'pen tester', 'ethical hacker', 'soc analyst', 'incident response',
      'vulnerability', 'cryptography', 'network security', 'appsec',
    ],
    weight: 1.0,
  },
  {
    specialization: Specialization.AI_ENGINEER,
    keywords: [
      'ai', 'artificial intelligence', 'ml', 'machine learning', 'deep learning',
      'nlp', 'natural language', 'computer vision', 'llm', 'generative ai',
      'genai', 'pytorch', 'tensorflow', 'scikit-learn', 'openai', 'gemini',
      'prompt engineer', 'ai engineer',
    ],
    weight: 1.0,
  },
];

export class TaxonomyMapper {
  /**
   * Maps a legacy V1 preference payload to V2 strict taxonomies.
   */
  public static mapV1PreferenceToV2(v1: V1PreferenceInput): TaxonomyMappingResult {
    const rawJobTitle = (v1.jobTitle ?? '').trim().toLowerCase();
    const skills = Array.isArray(v1.skills) ? v1.skills.map((s) => s.toLowerCase().trim()) : [];
    const combinedTokens = `${rawJobTitle} ${skills.join(' ')}`.toLowerCase();

    // 1. Calculate weighted scores across the 10 V2 specializations
    const scores = new Map<Specialization, number>();

    for (const rule of TAXONOMY_RULES) {
      let score = 0;
      for (const kw of rule.keywords) {
        if (rawJobTitle.includes(kw)) {
          score += 2 * rule.weight;
        } else if (skills.some((s) => s.includes(kw))) {
          score += 1 * rule.weight;
        }
      }
      if (score > 0) {
        scores.set(rule.specialization, score);
      }
    }

    // Sort by highest matching score
    const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

    let specializations: Specialization[] = [];
    let isAmbiguous = false;
    let confidence = 0;

    if (ranked.length === 0) {
      // Completely unmapped free-text (e.g. "consultant", "engineer", "technician")
      specializations = [Specialization.FULLSTACK];
      isAmbiguous = true;
      confidence = 0.2;
    } else {
      const topScore = ranked[0]![1];
      // Pick top matches (up to 3 specializations per V2 spec)
      specializations = ranked
        .filter((r) => r[1] >= topScore * 0.6)
        .slice(0, 3)
        .map((r) => r[0]);

      confidence = Math.min(1.0, Math.round((topScore / 3) * 100) / 100);

      // Check for ambiguity (score too low or too many broad ties)
      if (topScore < 1.5 || (ranked.length > 3 && ranked[0]![1] === ranked[3]![1])) {
        isAmbiguous = true;
      }
    }

    // 2. Map Experience Level
    const experienceLevel = this.mapExperienceLevel(v1.experienceLevel, rawJobTitle);

    // 3. Map Work Type
    const workType = this.mapWorkType(v1.workType, combinedTokens);

    // 4. Map Region Preference
    const regionPreference = this.mapRegionPreference(v1.location);

    return {
      specializations,
      experienceLevel,
      workType,
      regionPreference,
      isAmbiguous,
      confidence,
      unmappedKeywords: isAmbiguous ? [rawJobTitle] : [],
      suggestedReconfirmation: isAmbiguous,
      notes: isAmbiguous ? `Ambiguous V1 job title '${rawJobTitle}' mapped to fallback ${specializations.join(',')}` : undefined,
    };
  }

  /**
   * Maps preference with execution duration formatted with ms.
   */
  public static mapWithTelemetry(v1: V1PreferenceInput): {
    result: TaxonomyMappingResult;
    durationMs: number;
    durationFormatted: string;
  } {
    const startTime = Date.now();
    const result = this.mapV1PreferenceToV2(v1);
    const durationMs = Math.max(1, Date.now() - startTime);

    return {
      result,
      durationMs,
      durationFormatted: ms(durationMs),
    };
  }

  private static mapExperienceLevel(
    rawLevel?: string | null,
    jobTitle?: string,
  ): ExperienceLevelPreference | null {
    const text = `${rawLevel ?? ''} ${jobTitle ?? ''}`.toLowerCase();

    if (
      text.includes('senior') ||
      text.includes('lead') ||
      text.includes('staff') ||
      text.includes('principal') ||
      text.includes('architect') ||
      text.includes('5+') ||
      text.includes('expert')
    ) {
      return ExperienceLevelPreference.SENIOR;
    }

    if (
      text.includes('junior') ||
      text.includes('entry') ||
      text.includes('intern') ||
      text.includes('fresh') ||
      text.includes('trainee') ||
      text.includes('graduate') ||
      text.includes('0-2')
    ) {
      return ExperienceLevelPreference.JUNIOR;
    }

    if (
      text.includes('mid') ||
      text.includes('intermediate') ||
      text.includes('associate') ||
      text.includes('2-5') ||
      text.includes('3+')
    ) {
      return ExperienceLevelPreference.MID;
    }

    return null;
  }

  private static mapWorkType(
    rawWorkType?: string | null,
    combinedTokens?: string,
  ): WorkTypePreference | null {
    const text = `${rawWorkType ?? ''} ${combinedTokens ?? ''}`.toLowerCase();

    if (text.includes('part-time') || text.includes('parttime') || text.includes('part_time')) {
      return WorkTypePreference.PART_TIME;
    }
    if (text.includes('contract') || text.includes('freelance') || text.includes('consultant')) {
      return WorkTypePreference.CONTRACT;
    }
    if (text.includes('internship') || text.includes('intern') || text.includes('trainee')) {
      return WorkTypePreference.INTERNSHIP;
    }
    if (text.includes('full-time') || text.includes('fulltime') || text.includes('full_time')) {
      return WorkTypePreference.FULL_TIME;
    }

    return null;
  }

  private static mapRegionPreference(rawLocation?: string | null): RegionPreference {
    if (!rawLocation) {
      return RegionPreference.BOTH;
    }

    const loc = rawLocation.toLowerCase();

    const arabKeywords = [
      'arab', 'middle east', 'mena', 'gulf', 'gcc', 'palestine', 'gaza',
      'ramallah', 'egypt', 'cairo', 'saudi', 'riyadh', 'uae', 'dubai',
      'amman', 'jordan', 'lebanon', 'beirut', 'qatar', 'doha', 'kuwait',
    ];

    const intlKeywords = [
      'international', 'worldwide', 'global', 'remote worldwide', 'europe',
      'usa', 'us', 'uk', 'germany', 'canada', 'australia', 'latin america',
    ];

    const hasArab = arabKeywords.some((k) => loc.includes(k));
    const hasIntl = intlKeywords.some((k) => loc.includes(k));

    if (hasArab && !hasIntl) {
      return RegionPreference.ARAB;
    }
    if (hasIntl && !hasArab) {
      return RegionPreference.INTERNATIONAL;
    }

    return RegionPreference.BOTH;
  }
}


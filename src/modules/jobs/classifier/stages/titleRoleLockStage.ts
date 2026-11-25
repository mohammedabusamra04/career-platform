import { Specialization } from '../../../../shared/types/domain.types.js';
import type {
  IClassificationStage,
  StageContext,
  StageResult,
  TitleClassificationResult,
} from '../classificationTypes.js';
import { TAXONOMY_TOKEN_MAP } from '../specializationTaxonomy.js';

export const SHARED_ROLE_PATTERNS = [
  /\b(?:platform|infrastructure|infra|cloud)\s+(?:engineer|developer|architect|lead|specialist)\b/i,
];

export const DOMAIN_QUALIFIERS: Array<{ spec: Specialization; regex: RegExp }> = [
  {
    spec: Specialization.AI_ENGINEER,
    regex: /\b(?:ai|ml|machine learning|deep learning|nlp|llm|computer vision|artificial intelligence|ذكاء اصطناعي|تعلم الآلة)\b/i,
  },
  {
    spec: Specialization.DATA,
    regex: /\b(?:data|analytics|big data|etl|bi|database|بيانات|علم البيانات)\b/i,
  },
  {
    spec: Specialization.SECURITY,
    regex: /\b(?:security|cybersecurity|infosec|appsec|secops|أمن سيبراني|أمن معلومات)\b/i,
  },
  {
    spec: Specialization.MOBILE,
    regex: /\b(?:mobile|ios|android|flutter|react native|swift|kotlin|موبايل)\b/i,
  },
  {
    spec: Specialization.QA,
    regex: /\b(?:qa|quality assurance|testing|test|sdet|جودة|اختبار)\b/i,
  },
  {
    spec: Specialization.FRONTEND,
    regex: /\b(?:frontend|front-end|ui|web|واجهات أمامية)\b/i,
  },
  {
    spec: Specialization.BACKEND,
    regex: /\b(?:backend|back-end|api|خلفي)\b/i,
  },
  {
    spec: Specialization.UIUX,
    regex: /\b(?:ui\/ux|ux\/ui|product design|تصميم)\b/i,
  },
  {
    spec: Specialization.FULLSTACK,
    regex: /\b(?:fullstack|full stack|full-stack|شامل)\b/i,
  },
  {
    spec: Specialization.DEVOPS,
    regex: /\b(?:devops|sre|platform|infrastructure|cloud|sysadmin|سحابي|ديف اوبس)\b/i,
  },
];

export interface TitleConflictArbitrationResult {
  hasConflict: boolean;
  competingSpecialization: Specialization | null;
  sharedRoleSpecialization: Specialization | null;
}

export class TitleRoleLockStage implements IClassificationStage {
  public readonly name = 'TITLE_ROLE_LOCK';

  /**
   * Dynamically detects compound titles where a domain qualifier (Data, AI, Security, Mobile, etc.)
   * competes with a shared role (Platform, Infrastructure, Cloud).
   */
  public detectTitleConflict(title: string): TitleConflictArbitrationResult {
    if (!title || !title.trim()) {
      return { hasConflict: false, competingSpecialization: null, sharedRoleSpecialization: null };
    }

    const normalized = this.normalizeTitleForTokens(title);

    const hasSharedRole = SHARED_ROLE_PATTERNS.some((pattern) => pattern.test(normalized));
    if (!hasSharedRole) {
      return { hasConflict: false, competingSpecialization: null, sharedRoleSpecialization: null };
    }

    for (const { spec, regex } of DOMAIN_QUALIFIERS) {
      if (spec === Specialization.DEVOPS) continue;
      if (regex.test(normalized)) {
        return {
          hasConflict: true,
          competingSpecialization: spec,
          sharedRoleSpecialization: Specialization.DEVOPS,
        };
      }
    }

    return { hasConflict: false, competingSpecialization: null, sharedRoleSpecialization: null };
  }

  public execute(context: StageContext): StageResult | null {
    // If competing domains exist and description/skills are present, defer to contextual arbitration
    const conflict = this.detectTitleConflict(context.title);
    const hasDescOrSkills = Boolean(
      (context.description && context.description.trim().length > 0) ||
      (context.skills && context.skills.length > 0),
    );
    if (conflict.hasConflict && hasDescOrSkills) {
      return null;
    }

    const classification = this.classifyTitle(context.title);
    if (!classification) {
      return null;
    }

    return {
      handled: true,
      primarySpecialization: classification.primarySpecialization,
      secondarySpecialization: classification.secondarySpecialization,
      confidence: classification.confidence,
      classificationMethod: 'RULE_TITLE',
      matchedTokens: classification.matchedTokens,
      isExcluded: false,
    };
  }

  /**
   * Title-First Tokenized Rule Engine.
   * Fast O(k) evaluation over title n-grams (3-gram, 2-gram, 1-gram) with Map lookups.
   */
  public classifyTitle(title: string): TitleClassificationResult | null {
    if (!title || !title.trim()) {
      return null;
    }

    const conflict = this.detectTitleConflict(title);
    if (conflict.hasConflict && conflict.competingSpecialization) {
      return {
        primarySpecialization: conflict.competingSpecialization,
        secondarySpecialization: conflict.sharedRoleSpecialization || Specialization.DEVOPS,
        confidence: 0.95,
        classificationMethod: 'RULE_TITLE',
        matchedTokens: [title],
      };
    }

    const normalized = this.normalizeTitleForTokens(title);
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return null;
    }

    const scores = new Map<Specialization, number>();
    const directRoleMatched = new Map<Specialization, boolean>();
    const matchedTokens: string[] = [];

    let i = 0;
    let isFirstMatch = true;
    while (i < words.length) {
      // 3-gram
      if (i + 2 < words.length) {
        const triGram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        const entry = TAXONOMY_TOKEN_MAP.get(triGram);
        if (entry) {
          const positionBoost = isFirstMatch ? 60 : 0;
          scores.set(entry.spec, (scores.get(entry.spec) || 0) + entry.weight + positionBoost);
          if (entry.isDirectRole) {
            directRoleMatched.set(entry.spec, true);
          }
          matchedTokens.push(triGram);
          isFirstMatch = false;
          i += 3;
          continue;
        }
      }

      // 2-gram
      if (i + 1 < words.length) {
        const biGram = `${words[i]} ${words[i + 1]}`;
        const entry = TAXONOMY_TOKEN_MAP.get(biGram);
        if (entry) {
          const positionBoost = isFirstMatch ? 60 : 0;
          scores.set(entry.spec, (scores.get(entry.spec) || 0) + entry.weight + positionBoost);
          if (entry.isDirectRole) {
            directRoleMatched.set(entry.spec, true);
          }
          matchedTokens.push(biGram);
          isFirstMatch = false;
          i += 2;
          continue;
        }
      }

      // 1-gram
      const uniGram = words[i];
      const entry = TAXONOMY_TOKEN_MAP.get(uniGram);
      if (entry) {
        const positionBoost = isFirstMatch ? 60 : 0;
        scores.set(entry.spec, (scores.get(entry.spec) || 0) + entry.weight + positionBoost);
        if (entry.isDirectRole) {
          directRoleMatched.set(entry.spec, true);
        }
        matchedTokens.push(uniGram);
        isFirstMatch = false;
        i += 1;
        continue;
      }

      i += 1;
    }

    if (scores.size === 0) {
      return null;
    }

    // Role disambiguation: If an explicit direct engineering role is matched (e.g. Backend Developer),
    // prevent platform context (e.g. Vision AI Platform) from overriding the engineering role.
    let sortedSpecs = Array.from(scores.entries()).sort((a, b) => {
      const aDirect = directRoleMatched.get(a[0]) ? 1 : 0;
      const bDirect = directRoleMatched.get(b[0]) ? 1 : 0;
      if (aDirect !== bDirect) {
        return bDirect - aDirect;
      }
      return b[1] - a[1];
    });

    // Special disambiguation: Kotlin Backend vs Mobile Kotlin
    const hasBackend = scores.has(Specialization.BACKEND);
    const hasMobile = scores.has(Specialization.MOBILE);
    if (hasBackend && hasMobile) {
      const hasExplicitBackendToken = matchedTokens.some((t) =>
        t.includes('backend') || t.includes('back-end') || t.includes('back end') || t.includes('خلفي')
      );
      if (hasExplicitBackendToken) {
        sortedSpecs = sortedSpecs.filter(([spec]) => spec !== Specialization.MOBILE);
      }
    }

    const primarySpecialization = sortedSpecs[0][0];
    let secondarySpecialization: Specialization | null = null;

    const nonBackendPrimaries: Specialization[] = [
      Specialization.DATA,
      Specialization.AI_ENGINEER,
      Specialization.QA,
      Specialization.DEVOPS,
      Specialization.SECURITY,
      Specialization.UIUX,
    ];
    const hasExplicitBackendInTitle = /\b(?:back[- ]?end|خلفي|خلفية|server[- ]side)\b/i.test(title);

    if (sortedSpecs.length > 1) {
      const second = sortedSpecs[1];
      if (second[1] >= 60 && second[0] !== primarySpecialization) {
        if (primarySpecialization === Specialization.FULLSTACK) {
          const distinct = sortedSpecs.slice(1).find(
            ([spec, score]) =>
              spec !== Specialization.FRONTEND &&
              spec !== Specialization.BACKEND &&
              score >= 60,
          );
          secondarySpecialization = distinct ? distinct[0] : null;
        } else if (
          nonBackendPrimaries.includes(primarySpecialization) &&
          second[0] === Specialization.BACKEND &&
          !hasExplicitBackendInTitle
        ) {
          const distinct = sortedSpecs.slice(1).find(
            ([spec, score]) =>
              spec !== Specialization.BACKEND &&
              spec !== primarySpecialization &&
              score >= 60,
          );
          secondarySpecialization = distinct ? distinct[0] : null;
        } else {
          secondarySpecialization = second[0];
        }
      }
    }

    return {
      primarySpecialization,
      secondarySpecialization,
      confidence: 0.95,
      classificationMethod: 'RULE_TITLE',
      matchedTokens,
    };
  }

  /**
   * Normalizes title text preserving programming tokens (.net, c#, c++, ui/ux, ci/cd).
   */
  public normalizeTitleForTokens(title: string): string {
    let text = title.toLowerCase();

    // Preserve special tokens by substituting or safeguarding them
    text = text
      .replace(/\bc#\b/g, ' c# ')
      .replace(/\b\.net\b/g, ' .net ')
      .replace(/\bui\/ux\b/g, ' ui/ux ')
      .replace(/\bux\/ui\b/g, ' ux/ui ')
      .replace(/\bci\/cd\b/g, ' ci/cd ');

    // Replace brackets, slashes (except in protected tokens), parentheses, colons with spaces
    text = text.replace(/([^\s/]+)\/([^\s/]+)/g, (match) => {
      const lower = match.toLowerCase();
      if (lower === 'ui/ux' || lower === 'ux/ui' || lower === 'ci/cd') {
        return ` ${lower} `;
      }
      return match.replace('/', ' ');
    });

    text = text.replace(/[/\\()[\]{},:;*!|•–—~"']/g, ' ');

    // Normalize dashes surrounded by spaces
    text = text.replace(/\s+-\s+/g, ' ');

    // Normalize Arabic conjunction 'و' (waw) attached to role stems (e.g. 'وذكاء' -> 'ذكاء')
    text = text.replace(
      /(?:^|\s)و(ذكاء|بيانات|أمن|امن|تصميم|مصمم|تطوير|محلل|مهندس|سحابية|نظم|لارافيل|فلاتر|رياكت|نود|فيو|شات|تعلم)/g,
      ' $1',
    );

    // Collapse multiple whitespace
    return text.trim();
  }
}

export const titleRoleLockStage = new TitleRoleLockStage();

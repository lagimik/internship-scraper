/**
 * Role title matching. See "Roles to target" in CLAUDE.md.
 *
 * Order matters: exclusions run before inclusions, because most false positives
 * ("Sales Engineer", "Engineering Manager") also contain a matching keyword.
 */
/**
 * Mechanical and manufacturing role-title matching.
 * Exclusions run before inclusions so computing work never enters broad engineering
 * project, program, or student matches.
 */

import type { JobType, RoleCategory } from '../types.js';

const EXCLUSIONS: Array<[RegExp, string]> = [
  // Computing disciplines are explicitly out of scope.
  [/\b(software|firmware)\b|\b(swe|sde)\b/, 'software'],
  [/\bdev\s?ops\b|\bsite reliability\b|\bsre\b|\bmlops\b/, 'devops'],
  [/\b(computer|computing)\s+science\b|\binformatique\b/, 'computer-science'],
  [/\bdata\s+(science|scientist|engineering|engineer|analytics|analyst)\b/, 'data-science'],
  [/\b(machine learning|artificial intelligence|deep learning|computer vision|nlp|llm|genai)\b|\b(ai|ml)\s+(engineer|developer|scientist)\b/, 'ai-ml'],
  [/\b(front.?end|back.?end|full.?stack|web|mobile|ios|android)\s+(engineer|developer|dev)\b/, 'software'],
  [/\b(programmer|developer|cloud engineer|platform engineer|infrastructure engineer)\b/, 'software-infrastructure'],
  [/\b(cybersecurity|information technology|it|network|database)\s+(engineer|developer|analyst|specialist|manager|intern|co\s?op)\b/, 'computing'],
  [/\b(qa|quality assurance)\s+(analyst|tester|automation|developer)\b|\btest\s+automation\b/, 'software-testing'],

  // Other disciplines and common false positives.
  [/\b(vp|vice president|head of|chief)\b/, 'leadership'],
  [/\b(recruiter|sourcer|talent acquisition|human resources|people ops)\b/, 'recruiting'],
  [/\b(marketing|graphic designer|ux|user experience|content|technical writer)\b/, 'non-engineering'],
  [/\b(finance|financial|accounting|audit|tax|banking|investment|actuarial)\b/, 'finance'],
  [/\b(business|sales|revenue|people|customer)\s+operations\b/, 'business-operations'],
  [/\bproduct\s+(manager|management|marketing)\b/, 'product-management'],
];

const STUDENT_MARKER = /\b(intern(ship)?s?|co\s?op|student|placement|stagiaire|stages?|étudiant(e)?|apprenti(ce|ceship)?|undergrad(uate)?|work\s+term)\b/;
const ENGINEERING_ROLE = /\b(engineer(ing)?|designer|design|technologist|technician|specialist|scientist|coordinator|manager|management|controls?)\b/;

interface ConceptRule {
  category: RoleCategory;
  name: string;
  /** Every expression must match, but their order and distance do not matter. */
  all: RegExp[];
  /** At least one expression must match when supplied. */
  any?: RegExp[];
}

/**
 * Rules describe co-occurring concepts instead of enumerating title word orders.
 * Specific categories precede general ones so, for example, mechanical design does
 * not get consumed by the broader mechanical rule.
 */
const CONCEPT_RULES: ConceptRule[] = [
  {
    category: 'mechatronics',
    name: 'mechatronics',
    all: [/\b(mechatronic(s|al)?|electro\s?mechanical|robotics\s+(mechanical|mechatronics))\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER],
  },
  {
    category: 'design-manufacturing',
    name: 'design-for-manufacturing',
    all: [/\b(design\s+for\s+manufactur(ing|ability)|dfma?|dfa)\b/],
  },
  {
    category: 'design-manufacturing',
    name: 'product-engineering',
    all: [/\bproduct\s+engineer(ing)?\b/],
  },
  {
    category: 'design-manufacturing',
    name: 'design-engineering',
    all: [/\bdesign\s+engineer(ing)?\b/],
  },
  {
    category: 'design-manufacturing',
    name: 'mechanical-manufacturing-design',
    all: [/\b(mechanical|manufacturing|product|machine|tooling|engineering)\b/, /\b(design|designer|cad|catia|solidworks|creo|tooling)\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER],
  },
  {
    category: 'materials-engineering',
    name: 'materials-engineering',
    all: [/\b(materials?|metallurg(y|ical|ist)?|composites?|polymers?)\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER],
  },
  {
    category: 'project-management',
    name: 'engineering-project',
    all: [/\bprojects?\b/, /\b(engineering|mechanical|manufacturing|industrial|technical|design)\b/],
    any: [/\b(manager|management|coordinator|engineer|controls?|lead|assistant)\b/, STUDENT_MARKER],
  },
  {
    category: 'program-management',
    name: 'engineering-program',
    all: [/\bprogram(me)?s?\b/, /\b(engineering|mechanical|manufacturing|industrial|technical|design)\b/],
    any: [/\b(manager|management|coordinator|engineer|lead|assistant)\b/, STUDENT_MARKER],
  },
  {
    category: 'manufacturing-engineering',
    name: 'manufacturing-production',
    all: [/\b(manufacturing|industrialization|production|assembly|factory|plant)\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER, /\b(operations|automation|process|quality|maintenance|equipment|npi|new\s+product\s+introduction)\b/],
  },
  {
    category: 'manufacturing-engineering',
    name: 'quality-process-automation',
    all: [/\b(quality(\s+control|\s+engineering)?|supplier\s+quality|process(\s+improvement|\s+engineering)?|industrial\s+automation|manufacturing\s+controls?|equipment\s+engineering|npi|new\s+product\s+introduction)\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER],
  },
  {
    category: 'manufacturing-engineering',
    name: 'industrial-engineering',
    all: [/\bindustrial\b/, /\bengineer(ing)?\b/],
  },
  {
    category: 'mechanical-engineering',
    name: 'mechanical-engineering',
    all: [/\b(mechanical|mechanics|machine\s+systems?)\b/],
    any: [ENGINEERING_ROLE, STUDENT_MARKER],
  },

  // French titles common in Quebec.
  { category: 'mechatronics', name: 'fr-mechatronics', all: [/\bmécatronique\b/] },
  { category: 'design-manufacturing', name: 'fr-design', all: [/\bconception\s+(mécanique|pour\s+la\s+fabrication)\b/] },
  { category: 'materials-engineering', name: 'fr-materials', all: [/\b(matériaux|métallurgie|composites?)\b/] },
  { category: 'mechanical-engineering', name: 'fr-mechanical', all: [/\b(ingénieur(e)?\s+(en\s+)?mécanique|génie\s+mécanique)\b/] },
  { category: 'manufacturing-engineering', name: 'fr-manufacturing', all: [/\b(fabrication|manufacturier|production|procédés?|qualité|assemblage)\b/], any: [/\b(ingénieur(e)?|ingénierie|spécialiste|technicien(ne)?)\b/, STUDENT_MARKER] },
  { category: 'project-management', name: 'fr-project', all: [/\bprojets?\b/, /\b(ingénierie|mécanique|fabrication)\b/], any: [/\b(gestionnaire|coordonnateur|chargé)\b/, STUDENT_MARKER] },
  { category: 'program-management', name: 'fr-program', all: [/\bprogrammes?\b/, /\b(ingénierie|mécanique|fabrication)\b/], any: [/\b(gestionnaire|coordonnateur|chargé)\b/, STUDENT_MARKER] },
];

const INTERN = /\bintern(ship)?s?\b|\bsummer\s+20\d\d\b|\b(fall|winter|spring|summer)\s+(term|20\d\d)\b|\bstudent\b|\bplacement\b|\bstagiaire\b|\bstages?\b|\b(é|e)tudiant(e)?\b|\bapprenti(ce|ceship)?\b|\bundergrad(uate)?\b|\bwork\s+term\b/;
const COOP = /\bco\s?op\b|\balternance\b/;
const NEW_GRAD = /\bnew\s?grad(uate)?\b|\bentry.level\b|\buniversity grad|\bcampus\b|\bearly career\b|\bjeune dipl(ô|o)m(é|e)\b/;
const CONTRACT = /\bcontract(or)?\b|\bfixed.term\b|\btemporary\b|\bfreelance\b|\bcontractuel\b/;

export interface RoleMatch {
  matches: boolean;
  category: RoleCategory | null;
  type: JobType | null;
  matchedBy: string | null;
  excludedBy?: string;
}

export function normalizeTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/co[‐‑‒–—-]?op/g, 'co op')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyType(title: string): JobType | null {
  const normalized = normalizeTitle(title);
  if (INTERN.test(normalized)) return 'intern';
  if (COOP.test(normalized)) return 'co-op';
  if (NEW_GRAD.test(normalized)) return 'new-grad';
  if (CONTRACT.test(normalized)) return 'contract';
  return 'full-time';
}

export function isStudentType(type: JobType | null): boolean {
  return type === 'intern' || type === 'co-op';
}

export function matchRole(title: string): RoleMatch {
  const normalized = normalizeTitle(title);
  if (!normalized) return { matches: false, category: null, type: null, matchedBy: null };

  for (const [pattern, reason] of EXCLUSIONS) {
    if (pattern.test(normalized)) {
      return { matches: false, category: null, type: null, matchedBy: null, excludedBy: reason };
    }
  }
  for (const rule of CONCEPT_RULES) {
    const matchesAll = rule.all.every((pattern) => pattern.test(normalized));
    const matchesAny = !rule.any || rule.any.some((pattern) => pattern.test(normalized));
    if (matchesAll && matchesAny) {
      return { matches: true, category: rule.category, type: classifyType(normalized), matchedBy: rule.name };
    }
  }
  return { matches: false, category: null, type: null, matchedBy: null };
}

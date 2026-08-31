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
  [/\b(cybersecurity|information technology|\bit\b|network|database)\s+(engineer|developer|analyst|specialist|manager|intern|co.?op)\b/, 'computing'],

  // Other disciplines and common false positives.
  [/\b(sales|solutions?|customer|field service|support|application|forward.deployed)\s+engineer\b/, 'non-target-engineer'],
  [/\b(civil|structural|electrical|chemical|petroleum|mining|geotechnical|environmental|optical|rf)\s+engineer/, 'other-discipline'],
  [/\b(engineering|technical)\s+(director|lead|head)\b/, 'leadership'],
  [/\b(vp|vice president|head of|chief)\b/, 'leadership'],
  [/\b(recruiter|sourcer|talent acquisition|human resources|people ops)\b/, 'recruiting'],
  [/\b(marketing|graphic designer|ux|user experience|content|technical writer)\b/, 'non-engineering'],
  [/\b(finance|financial|accounting|audit|tax|banking|investment|actuarial)\b/, 'finance'],
];

/** [pattern, category, rule name]. Specific categories precede general ones. */
const INCLUSIONS: Array<[RegExp, RoleCategory, string]> = [
  // Mechatronics and electromechanical engineering.
  [/\bmechatronic(s|al)?\s+(engineer|engineering|designer|technologist|technician|intern|student|co.?op)\b/, 'mechatronics', 'mechatronics'],
  [/\belectro.?mechanical\s+(engineer|engineering|designer|technologist|intern|student|co.?op)\b/, 'mechatronics', 'electromechanical'],
  [/\brobotics\s+(mechanical|mechatronics)\s+(engineer|engineering|designer|intern|student|co.?op)\b/, 'mechatronics', 'robotics-mechanical'],

  // Design for manufacturing, mechanical design, and tooling design.
  [/\bdesign\s+for\s+manufactur(ing|ability)\b|\bdfma?\b/, 'design-manufacturing', 'design-for-manufacturing'],
  [/\b(manufacturing|mechanical|product|machine|tooling)\s+design\s+(engineer|engineering|designer|intern|student|co.?op)\b/, 'design-manufacturing', 'manufacturing-design'],
  [/\bdesign\s+engineer(ing)?\b|\bengineering\s+designer\b/, 'design-manufacturing', 'design-engineering'],
  [/\b(cad|catia|solidworks|creo)\s+(designer|design|engineer|technologist|intern|student|co.?op)\b/, 'design-manufacturing', 'cad-design'],
  [/\btool(ing)?\s+(design|designer|engineer|engineering)\b/, 'design-manufacturing', 'tooling-design'],

  // Materials engineering, metallurgy, composites, and polymers.
  [/\bmaterials?\s+(engineer|engineering|scientist|science|specialist|technologist|intern|student|co.?op)\b/, 'materials-engineering', 'materials-engineering'],
  [/\b(metallurgy|metallurgical|metallurgist)\b/, 'materials-engineering', 'metallurgy'],
  [/\b(composites?|polymers?)\s+(engineer|engineering|specialist|technologist|intern|student|co.?op)\b/, 'materials-engineering', 'composites-materials'],

  // Engineering project and program management.
  [/\b(engineering|mechanical|manufacturing|industrial|technical)\s+project\s+(manager|management|coordinator|engineer|intern|student|co.?op)\b/, 'project-management', 'engineering-project-management'],
  [/\bproject\s+(manager|management|coordinator|engineer|intern|student|co.?op)\b.*\b(engineering|mechanical|manufacturing|industrial|design)\b/, 'project-management', 'project-management-engineering'],
  [/\b(engineering|mechanical|manufacturing|industrial|technical)\s+program(me)?\s+(manager|management|coordinator|engineer|intern|student|co.?op)\b/, 'program-management', 'engineering-program-management'],
  [/\bprogram(me)?\s+(manager|management|coordinator|engineer|intern|student|co.?op)\b.*\b(engineering|mechanical|manufacturing|industrial|design)\b/, 'program-management', 'program-management-engineering'],

  // Core mechanical and manufacturing engineering.
  [/\bmechanical\s+(engineer|engineering|designer|technologist|intern|student|co.?op)\b/, 'mechanical-engineering', 'mechanical-engineering'],
  [/\bmanufacturing\s+(engineer|engineering|technologist|specialist|intern|student|co.?op)\b/, 'manufacturing-engineering', 'manufacturing-engineering'],
  [/\b(industrialization|production|process)\s+(engineer|engineering|technologist|intern|student|co.?op)\b/, 'manufacturing-engineering', 'production-process-engineering'],
  [/\b(industrial engineer|industrial engineering)\b/, 'manufacturing-engineering', 'industrial-engineering'],

  // Student-first title forms.
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\bmechanical\s+engineering\b/, 'mechanical-engineering', 'mechanical-student-prefix'],
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\bmechatronic(s|al)?\b/, 'mechatronics', 'mechatronics-student-prefix'],
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\b(materials?|metallurg|composite)\b/, 'materials-engineering', 'materials-student-prefix'],
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\b(manufacturing|industrialization|production engineering)\b/, 'manufacturing-engineering', 'manufacturing-student-prefix'],
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\b(engineering\s+)?project\s+management\b/, 'project-management', 'project-student-prefix'],
  [/\b(intern(ship)?|co.?op|student|placement)\b.*\b(engineering\s+)?program(me)?\s+management\b/, 'program-management', 'program-student-prefix'],

  // French titles common in Quebec.
  [/\bing(é|e)nieur(e)?\s+(en\s+)?m(é|e)canique\b|\bg(é|e)nie\s+m(é|e)canique\b/, 'mechanical-engineering', 'fr-mechanical'],
  [/\bm(é|e)catronique\b/, 'mechatronics', 'fr-mechatronics'],
  [/\bing(é|e)nieur(e)?\s+(en\s+)?(fabrication|manufacturier|production|proc(é|e)d(é|e)s?)\b/, 'manufacturing-engineering', 'fr-manufacturing'],
  [/\bconception\s+(m(é|e)canique|pour\s+la\s+fabrication)\b/, 'design-manufacturing', 'fr-design'],
  [/\b(mat(é|e)riaux|m(é|e)tallurgie|composites?)\b/, 'materials-engineering', 'fr-materials'],
  [/\b(gestionnaire|coordonnateur|charg(é|e))\s+(de\s+)?projet\b.*\b(ing(é|e)nierie|m(é|e)canique|fabrication)\b/, 'project-management', 'fr-project'],
  [/\b(gestionnaire|coordonnateur|charg(é|e))\s+(de\s+)?programme\b.*\b(ing(é|e)nierie|m(é|e)canique|fabrication)\b/, 'program-management', 'fr-program'],
];

const INTERN = /\bintern(ship)?s?\b|\bsummer\s+20\d\d\b|\b(fall|winter|spring|summer)\s+(term|20\d\d)\b|\bstudent\b|\bplacement\b|\bstagiaire\b|\bstages?\b|\b(é|e)tudiant(e)?\b|\bapprenti(ce|ceship)?\b|\bundergrad(uate)?\b|\bwork\s+term\b/;
const COOP = /\bco.?op\b|\balternance\b/;
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
    .replace(/[_/|]/g, ' ')
    .replace(/[–—]/g, '-')
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
  for (const [pattern, category, rule] of INCLUSIONS) {
    if (pattern.test(normalized)) {
      return { matches: true, category, type: classifyType(normalized), matchedBy: rule };
    }
  }
  return { matches: false, category: null, type: null, matchedBy: null };
}

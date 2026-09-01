import type { WorkTermConfidence } from '../types.js';

export interface WorkTermMatch {
  months: number | null;
  confidence: WorkTermConfidence;
  matchedBy: string | null;
}

/** Detect explicit term lengths and common four-month academic-term wording. */
export function matchWorkTerm(title: string, description: string | null): WorkTermMatch {
  const text = `${title} ${description ?? ''}`.toLowerCase();
  const month = text.match(/\b(\d{1,2})\s*[- ]?months?\b/);
  if (month) return { months: Number(month[1]), confidence: 'confirmed', matchedBy: month[0] };

  const weeks = text.match(/\b(\d{1,2})\s*[- ]?weeks?\b/);
  if (weeks) {
    const count = Number(weeks[1]);
    return { months: Math.round(count / 4), confidence: 'confirmed', matchedBy: weeks[0] };
  }

  if (/\b(may|june)\b.{0,20}\b(august|september)\b|\b(summer|fall|winter|spring)\s+20\d\d\b/.test(text)) {
    return { months: 4, confidence: 'inferred', matchedBy: 'academic-term' };
  }

  return { months: null, confidence: 'unspecified', matchedBy: null };
}

/** Unknown terms remain eligible; only explicitly incompatible terms are rejected. */
export function isFourMonthEligible(term: WorkTermMatch): boolean {
  return term.months === null || term.months === 4;
}
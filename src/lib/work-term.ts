import type { WorkTermConfidence } from '../types.js';

export interface WorkTermMatch {
  months: number | null;
  confidence: WorkTermConfidence;
  matchedBy: string | null;
  /** Whether the posting is for the currently targeted recruiting term. */
  isTargetTerm: boolean;
}

const TARGET_YEAR = 2027;
const TERM_CONTEXT = String.raw`(?:intern(?:ship)?|co[ -]?op|work\s*term|placement|term|semester|stage|stagiaire)`;
const DURATION_CONTEXT = /\b(?:intern(?:ship)?|co[ -]?op|work\s*term|placement|duration|contract|position|stage|mandat)\b/i;

function explicitDuration(text: string, requireContext = false): WorkTermMatch | null {
  const pattern = /\b(\d{1,2}|four|eight|twelve|sixteen|quatre|huit|douze|seize)\s*[- ]?(months?|weeks?|mois|semaines?)\b/g;
  const duration = [...text.matchAll(pattern)].find((match) => {
    if (!requireContext || match.index === undefined) return true;
    const nearby = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60);
    return DURATION_CONTEXT.test(nearby);
  });
  if (!duration) return null;

  const value = duration[1];
  const unit = duration[2];
  if (!value || !unit) return null;

  const words: Record<string, number> = {
    four: 4, eight: 8, twelve: 12, sixteen: 16,
    quatre: 4, huit: 8, douze: 12, seize: 16,
  };
  const count = words[value] ?? Number(value);
  const months = /^(?:weeks?|semaines?)$/.test(unit) ? Math.round(count / 4) : count;
  return { months, confidence: 'confirmed', matchedBy: duration[0], isTargetTerm: false };
}

function targetTermEvidence(text: string): string | null {
  const patterns = [
    new RegExp(String.raw`\b(?:winter|hiver)\s+${TARGET_YEAR}\b|\b${TARGET_YEAR}\s+(?:winter|hiver)\b`, 'i'),
    new RegExp(
      String.raw`\b(?:start(?:ing|s)?|begin(?:ning|s)?|commenc(?:e|es|ing|ant)|début(?:ant)?|debute?|débute?)\b` +
        String.raw`[^.\n]{0,30}\b(?:jan(?:uary)?|janv(?:ier)?)\s+${TARGET_YEAR}\b`,
      'i',
    ),
    new RegExp(
      String.raw`\b(?:jan(?:uary)?|janv(?:ier)?)\s+${TARGET_YEAR}\b[^.\n]{0,30}\b${TERM_CONTEXT}\b` +
        String.raw`|\b${TERM_CONTEXT}\b[^.\n]{0,30}\b(?:jan(?:uary)?|janv(?:ier)?)\s+${TARGET_YEAR}\b`,
      'i',
    ),
    new RegExp(
      String.raw`\b(?:jan(?:uary)?|janv(?:ier)?)\b[^\n]{0,40}\b(?:apr(?:il)?|avr(?:il)?)\b[^\n]{0,20}\b${TARGET_YEAR}\b` +
        String.raw`|\b(?:jan(?:uary)?|janv(?:ier)?)\s+${TARGET_YEAR}\b[^\n]{0,40}\b(?:apr(?:il)?|avr(?:il)?)\b`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Detect whether a posting is specifically for Winter/Hiver 2027. */
export function matchWorkTerm(title: string, description: string | null): WorkTermMatch {
  const normalizedTitle = title.toLowerCase().replace(/[–—]/g, '-');
  const normalizedDescription = (description ?? '').toLowerCase().replace(/[–—]/g, '-');

  const titleDuration = explicitDuration(normalizedTitle);
  const descriptionDuration = explicitDuration(normalizedDescription, true);
  const duration = titleDuration ?? descriptionDuration;

  const evidence = targetTermEvidence(normalizedTitle) ?? targetTermEvidence(normalizedDescription);
  if (!evidence) {
    return duration ?? {
      months: null,
      confidence: 'unspecified',
      matchedBy: null,
      isTargetTerm: false,
    };
  }

  // Winter/Hiver academic terms are four months unless explicitly stated otherwise.
  if (duration && duration.months !== 4) return duration;
  return {
    months: 4,
    confidence: duration ? 'confirmed' : 'inferred',
    matchedBy: duration ? `${evidence}; ${duration.matchedBy}` : evidence,
    isTargetTerm: true,
  };
}

/** Only Winter/Hiver 2027 postings with a compatible four-month duration are eligible. */
export function isFourMonthEligible(term: WorkTermMatch): boolean {
  return term.isTargetTerm && term.months === 4;
}
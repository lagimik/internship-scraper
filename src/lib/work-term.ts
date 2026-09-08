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
const MONTH_NUMBERS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, janv: 1,
  february: 2, feb: 2, février: 2, fevrier: 2, févr: 2, fevr: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, avr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, août: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, décembre: 12, decembre: 12, déc: 12,
};
const MONTH_NAME = Object.keys(MONTH_NUMBERS).sort((a, b) => b.length - a.length).join('|');

function calendarRangeDuration(text: string): WorkTermMatch | null {
  const pattern = new RegExp(
    String.raw`\b(${MONTH_NAME})\s*(20\d{2})?\s*(?:-|to|through|until|à|au)\s*` +
      String.raw`(${MONTH_NAME})\s*(20\d{2})\b`,
    'i',
  );
  const match = text.match(pattern);
  if (!match) return null;

  const startMonth = MONTH_NUMBERS[match[1]?.toLowerCase() ?? ''];
  const endMonth = MONTH_NUMBERS[match[3]?.toLowerCase() ?? ''];
  const endYear = Number(match[4]);
  const startYear = Number(match[2] ?? match[4]);
  if (!startMonth || !endMonth || !Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;

  const months = (endYear - startYear) * 12 + endMonth - startMonth + 1;
  if (months < 1 || months > 24) return null;
  return { months, confidence: 'confirmed', matchedBy: match[0], isTargetTerm: false };
}

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
    new RegExp(
      String.raw`\b(?:winter(?:\s*\/\s*spring)?|hiver)\s+${TARGET_YEAR}\b` +
        String.raw`|\b${TARGET_YEAR}\s+(?:winter(?:\s*\/\s*spring)?|hiver)\b`,
      'i',
    ),
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

  const titleDuration = explicitDuration(normalizedTitle) ?? calendarRangeDuration(normalizedTitle);
  const descriptionDuration = explicitDuration(normalizedDescription, true) ?? calendarRangeDuration(normalizedDescription);
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
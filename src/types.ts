/** The normalized shape every adapter must produce. See CLAUDE.md. */

export type JobType = 'intern' | 'co-op' | 'new-grad' | 'full-time' | 'contract';
export type RoleCategory =
  | 'mechanical-engineering'
  | 'mechatronics'
  | 'design-manufacturing'
  | 'manufacturing-engineering'
  | 'materials-engineering'
  | 'project-management'
  | 'program-management';
export type JobStatus = 'new' | 'applied' | 'interview' | 'rejected' | 'offer';
export type CountryCode = 'CA' | 'US';
export type LocationConfidence = 'confirmed' | 'ambiguous';
export type WorkTermConfidence = 'confirmed' | 'inferred' | 'unspecified';

export interface JobPosting {
  /** Stable hash of company+title+location, used for dedupe across sources. */
  id: string;
  title: string;
  company: string;
  location: string;
  country: CountryCode;
  /** Two-letter Canadian province or US state code, when available. */
  region: string | null;
  remote: boolean;
  url: string;
  source: string;
  /** ISO date the source says it was posted; null when the source only gives an age. */
  postedAt: string | null;
  /** ISO date we first saw it. Set by storage, not by adapters. */
  firstSeenAt: string;
  salaryRaw: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  type: JobType | null;
  roleCategory: RoleCategory | null;
  /** Which title rule matched, so the filter can be tuned against real results. */
  matchedBy: string | null;
  locationConfidence: LocationConfidence;
  /** Which location rule fired. */
  locationMatchedBy: string | null;
  /** Parsed duration for the targeted Winter/Hiver 2027 term. Unspecified terms are excluded. */
  workTermMonths: number | null;
  workTermConfidence: WorkTermConfidence;
  workTermMatchedBy: string | null;
  sponsorship: string | null;
  description: string | null;
  status: JobStatus;
}

/** What an adapter returns before storage fills in bookkeeping fields. */
export type RawJob = Omit<
  JobPosting,
  | 'id'
  | 'firstSeenAt'
  | 'status'
  | 'country'
  | 'region'
  | 'roleCategory'
  | 'matchedBy'
  | 'locationConfidence'
  | 'locationMatchedBy'
  | 'workTermMonths'
  | 'workTermConfidence'
  | 'workTermMatchedBy'
>;

export interface Adapter {
  name: string;
  fetch(): Promise<RawJob[]>;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  fetched: number;
  kept: number;
  inserted: number;
  updated: number;
  error?: string;
  ms: number;
}

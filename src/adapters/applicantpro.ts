/**
 * ApplicantPro/PrevueAPS adapter.
 *
 * Configured PrevueAPS boards expose the same public JSON endpoint used by their
 * careers page:
 *
 *   GET https://<tenant>.prevueaps.com/core/jobs/<siteId>?getParams=%7B%7D
 *
 * The endpoint returns the complete current job list without authentication or HTML
 * parsing. A real endpoint is required because tenant names and site IDs are not
 * reliably derivable from company names.
 */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface ApplicantProBoard {
  /** Public `/core/jobs/<siteId>` endpoint copied from the careers page. */
  url: string;
  name: string;
}

/** Verified live ApplicantPro/PrevueAPS boards. */
export const APPLICANTPRO_BOARDS: ApplicantProBoard[] = [
  {
    url: 'https://martinrea.prevueaps.com/core/jobs/596?getParams=%7B%7D',
    name: 'Martinrea International',
  },
];

export interface ParsedApplicantProUrl {
  origin: string;
  tenant: string;
  siteId: number;
  endpoint: string;
}

export interface ApplicantProJob {
  id?: number | string;
  title?: string;
  startDateRef?: string;
  jobLocation?: string;
  workplaceType?: string | null;
  employmentType?: string | null;
  payRate?: string | null;
  minSalary?: string | null;
  maxSalary?: string | null;
  payTypeFrame?: string | null;
  jobUrl?: string;
  iso3?: string | null;
  classification?: string | null;
  jobCategory?: string | null;
}

export interface ApplicantProResponse {
  success?: boolean;
  message?: string;
  data?: {
    jobs?: ApplicantProJob[];
    jobCount?: number;
  };
}

/** Parse and canonicalize a public jobs API URL. */
export function parseApplicantProUrl(url: string): ParsedApplicantProUrl | null {
  try {
    const parsed = new URL(url);
    const hostMatch = parsed.hostname.match(/^([a-z0-9-]+)\.prevueaps\.com$/i);
    const pathMatch = parsed.pathname.match(/^\/core\/jobs\/(\d+)\/?$/i);
    if (!hostMatch?.[1] || !pathMatch?.[1]) return null;

    const siteId = Number(pathMatch[1]);
    if (!Number.isSafeInteger(siteId) || siteId <= 0) return null;
    return {
      origin: parsed.origin,
      tenant: hostMatch[1],
      siteId,
      endpoint: `${parsed.origin}/core/jobs/${siteId}?getParams=${encodeURIComponent('{}')}`,
    };
  } catch {
    return null;
  }
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const amount = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function mapEmploymentType(value: string | null | undefined): JobType | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (/co.?op/.test(normalized)) return 'co-op';
  if (/intern|student|stagiaire|apprentice/.test(normalized)) return 'intern';
  if (/contract|temporary|fixed.?term/.test(normalized)) return 'contract';
  if (/full.?time/.test(normalized)) return 'full-time';
  return null;
}

function currencyForCountry(iso3: string | null | undefined): string | null {
  if (iso3 === 'CAN') return 'CAD';
  if (iso3 === 'USA') return 'USD';
  return null;
}

function salaryText(job: ApplicantProJob, currency: string | null): string | null {
  const payRate = job.payRate?.trim();
  if (payRate) return [payRate, currency].filter(Boolean).join(' ');

  const salaryParts = [job.minSalary?.trim(), job.maxSalary?.trim()].filter(Boolean);
  if (salaryParts.length === 0) return null;
  return [salaryParts.join(' - '), currency, job.payTypeFrame?.trim()]
    .filter(Boolean)
    .join(' ');
}

/** Map the structured public jobs response to the common adapter shape. */
export function parseApplicantProJobs(
  response: ApplicantProResponse,
  board: ApplicantProBoard,
  parsed: ParsedApplicantProUrl,
): RawJob[] {
  return (response.data?.jobs ?? []).flatMap((job): RawJob[] => {
    const id = String(job.id ?? '').trim();
    const title = job.title?.trim();
    if (!id || !title) return [];

    const location = job.jobLocation?.trim() ?? '';
    const currency = currencyForCountry(job.iso3);
    const descriptionParts = [job.classification, job.jobCategory]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return [{
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${job.workplaceType ?? ''} ${location}`),
      url: job.jobUrl || `${parsed.origin}/jobs/${id}`,
      source: 'applicantpro',
      postedAt: isoDate(job.startDateRef),
      salaryRaw: salaryText(job, currency),
      salaryMin: parseAmount(job.minSalary),
      salaryMax: parseAmount(job.maxSalary),
      salaryCurrency: currency,
      type: mapEmploymentType(job.employmentType),
      sponsorship: null,
      description: descriptionParts.length
        ? descriptionParts.map((value) => `Category: ${value}`).join('; ')
        : null,
    }];
  });
}

async function fetchApplicantProBoard(board: ApplicantProBoard): Promise<RawJob[]> {
  const parsed = parseApplicantProUrl(board.url);
  if (!parsed) throw new Error(`unparseable ApplicantPro/PrevueAPS URL: ${board.url}`);
  const response = await fetchJson<ApplicantProResponse>(parsed.endpoint);
  if (response.success === false) {
    throw new Error(response.message || 'ApplicantPro/PrevueAPS API reported failure');
  }
  return parseApplicantProJobs(response, board, parsed);
}

/** Fetch boards with bounded concurrency; one unavailable employer is skipped. */
async function fetchBoards(boards: ApplicantProBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchApplicantProBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function applicantProAdapter(
  boards: ApplicantProBoard[] = APPLICANTPRO_BOARDS,
): Adapter {
  return {
    name: 'applicantpro',
    fetch: () => fetchBoards(boards),
  };
}

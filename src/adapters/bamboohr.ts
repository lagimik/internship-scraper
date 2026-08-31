/**
 * BambooHR adapter.
 *
 * Public BambooHR careers pages expose a small JSON API:
 *
 *   GET https://<tenant>.bamboohr.com/careers/list
 *   GET https://<tenant>.bamboohr.com/careers/<id>/detail
 *
 * The list supplies every open posting and the detail endpoint adds the posting date,
 * full description, compensation and canonical share URL. Neither endpoint requires
 * authentication, cookies or browser rendering.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface BambooHrBoard {
  /** A public careers URL, e.g. https://avidbots.bamboohr.com/careers. */
  url: string;
  name: string;
}

export const BAMBOOHR_BOARDS: BambooHrBoard[] = [
  { url: 'https://acerta.bamboohr.com/careers', name: 'Acerta' },
  { url: 'https://avidbots.bamboohr.com/careers', name: 'Avidbots' },
];

export interface ParsedBambooHrUrl {
  origin: string;
  tenant: string;
}

interface BambooHrLocation {
  country?: string | null;
  state?: string | null;
  province?: string | null;
  city?: string | null;
  addressCountry?: string | null;
}

export interface BambooHrListPosting {
  id?: string;
  jobOpeningName?: string;
  employmentStatusLabel?: string | null;
  employmentType?: string | null;
  location?: BambooHrLocation | null;
  atsLocation?: BambooHrLocation | null;
  isRemote?: boolean | null;
  locationType?: string | null;
}

interface BambooHrListResponse {
  meta?: { totalCount?: number };
  result?: BambooHrListPosting[];
}

export interface BambooHrDetailPosting extends BambooHrListPosting {
  jobOpeningShareUrl?: string;
  jobOpeningStatus?: string;
  description?: string | null;
  compensation?: string | { displayText?: string; currency?: string } | null;
  datePosted?: string | null;
}

interface BambooHrDetailResponse {
  result?: { jobOpening?: BambooHrDetailPosting };
}

const DETAIL_CONCURRENCY = 5;

/** Accept a board or deep job URL and recover the tenant's API origin. */
export function parseBambooHrUrl(url: string): ParsedBambooHrUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.hostname.match(/^([a-z0-9-]+)\.bamboohr\.(com|co\.uk)$/i);
  const tenant = match?.[1];
  if (!tenant || parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() !== 'careers') return null;
  return { origin: parsed.origin, tenant };
}

function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const $ = load(`<div>${html}</div>`);
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4').each((_, element) => {
    $(element).append('\n');
  });
  const text = $('div').first().text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function formatLocation(posting: BambooHrDetailPosting): string {
  const preferred = posting.atsLocation && Object.values(posting.atsLocation).some(Boolean)
    ? posting.atsLocation
    : posting.location;
  if (!preferred) return posting.isRemote ? 'Remote' : '';

  const parts = [
    preferred.city,
    preferred.province ?? preferred.state,
    preferred.country ?? preferred.addressCountry,
  ].map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return [...new Set(parts)].join(', ') || (posting.isRemote ? 'Remote' : '');
}

function mapType(posting: BambooHrDetailPosting): JobType | null {
  const value = [posting.jobOpeningName, posting.employmentType, posting.employmentStatusLabel].join(' ');
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b/i.test(value)) return 'intern';
  if (/\bcontract|temporary|fixed[- ]term\b/i.test(value)) return 'contract';
  if (/\bfull[- ]?time\b/i.test(value)) return 'full-time';
  return null;
}

function compensationText(value: BambooHrDetailPosting['compensation']): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return value?.displayText?.trim() || null;
}

/** Map a merged list/detail record to the shared adapter shape. */
export function parseBambooHrPosting(
  posting: BambooHrDetailPosting,
  board: BambooHrBoard,
  parsed: ParsedBambooHrUrl,
): RawJob | null {
  const id = String(posting.id ?? '').trim();
  const title = posting.jobOpeningName?.trim();
  if (!id || !title || (posting.jobOpeningStatus && posting.jobOpeningStatus !== 'Open')) return null;

  const location = formatLocation(posting);
  const remote = Boolean(posting.isRemote)
    || /\bremote\b/i.test(`${location} ${posting.locationType ?? ''}`);
  const postedAt = posting.datePosted && /^\d{4}-\d{2}-\d{2}$/.test(posting.datePosted)
    ? `${posting.datePosted}T00:00:00.000Z`
    : posting.datePosted ?? null;

  return {
    title,
    company: board.name,
    location,
    remote,
    url: posting.jobOpeningShareUrl ?? `${parsed.origin}/careers/${id}`,
    source: 'bamboohr',
    postedAt,
    salaryRaw: compensationText(posting.compensation),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: typeof posting.compensation === 'object'
      ? posting.compensation?.currency ?? null
      : null,
    type: mapType(posting),
    sponsorship: null,
    description: htmlToText(posting.description),
  };
}

async function fetchBambooHrBoard(board: BambooHrBoard): Promise<RawJob[]> {
  const parsed = parseBambooHrUrl(board.url);
  if (!parsed) throw new Error(`unparseable BambooHR URL: ${board.url}`);
  const api = parsed;

  const listing = await fetchJson<BambooHrListResponse>(`${api.origin}/careers/list`);
  const postings = listing.result ?? [];
  const out: RawJob[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < postings.length) {
      const summary = postings[cursor++];
      if (!summary?.id) continue;
      try {
        const response = await fetchJson<BambooHrDetailResponse>(
          `${api.origin}/careers/${summary.id}/detail`,
        );
        const detail = response.result?.jobOpening;
        const job = parseBambooHrPosting({ ...summary, ...detail, id: summary.id }, board, api);
        if (job) out.push(job);
      } catch {
        // A transient detail failure should not hide a posting whose list data is valid.
        const job = parseBambooHrPosting(summary, board, api);
        if (job) out.push(job);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, postings.length) },
    () => worker(),
  ));
  return out;
}

/** Fetch boards concurrently; fail only when every configured board fails. */
async function fetchBoards(boards: BambooHrBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBambooHrBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const successes = settled.filter((result) => result.status === 'fulfilled').length;
  if (successes === 0 && boards.length > 0) {
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    throw new Error(failures.join('; '));
  }
  return jobs;
}

export function bambooHrAdapter(boards: BambooHrBoard[] = BAMBOOHR_BOARDS): Adapter {
  return {
    name: 'bamboohr',
    fetch: () => fetchBoards(boards),
  };
}
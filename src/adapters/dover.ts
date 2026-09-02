/**
 * Dover adapter.
 *
 * Dover careers pages expose unauthenticated JSON endpoints used by their own SPA:
 *
 *   GET https://app.dover.com/api/v1/careers-page/<clientId>/jobs?limit=300&offset=0
 *   GET https://app.dover.com/api/v1/inbound/application-portal-job/<jobId>
 *
 * The careers endpoint discovers published jobs, while the detail endpoint supplies
 * descriptions, employment type, compensation, sponsorship, and creation dates.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface DoverBoard {
  /** A public Dover careers URL containing the company slug and client ID. */
  url: string;
  name: string;
}

/** Verified public Dover careers pages. */
export const DOVER_BOARDS: DoverBoard[] = [
  {
    url: 'https://app.dover.com/Fabri/careers/4330a65c-241b-44e3-9524-1f8bb2f514d7',
    name: 'Fabri',
  },
];

export interface ParsedDoverUrl {
  origin: string;
  slug: string;
  clientId: string;
}

interface DoverLocation {
  name?: string | null;
  location_option?: {
    display_name?: string | null;
  } | null;
}

interface DoverListing {
  id?: string;
  title?: string;
  locations?: DoverLocation[];
  workplace_type?: string | null;
  is_published?: boolean;
  is_sample?: boolean;
}

interface DoverJobsResponse {
  count?: number;
  next?: string | null;
  results?: DoverListing[];
}

interface DoverCompensation {
  lower_bound?: number | null;
  upper_bound?: number | null;
  currency_code?: string | null;
  salary_range_type?: string | null;
  employment_type?: string | null;
}

export interface DoverJobDetail {
  id?: string;
  client_name?: string;
  title?: string;
  user_provided_description?: string | null;
  locations?: DoverLocation[];
  workplace_type?: string | null;
  compensation?: DoverCompensation | null;
  visa_support?: boolean | null;
  created?: string | null;
  active?: boolean;
  is_private?: boolean;
}

/** Parse a public careers URL into the identifiers required by Dover's API. */
export function parseDoverUrl(url: string): ParsedDoverUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'app.dover.com') return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/careers\/([0-9a-f-]+)\/?$/i);
    if (!match?.[1] || !match[2]) return null;
    return {
      origin: parsed.origin,
      slug: decodeURIComponent(match[1]),
      clientId: match[2],
    };
  } catch {
    return null;
  }
}

function cleanHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = load(value).text().replace(/\s+/g, ' ').trim();
  return text || null;
}

function collectLocations(locations: DoverLocation[] | undefined): string {
  const names = (locations ?? [])
    .map((location) => location.name?.trim() || location.location_option?.display_name?.trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)].join('; ');
}

function mapEmploymentType(value: string | null | undefined): JobType | null {
  const normalized = value?.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!normalized) return null;
  if (/co ?op/.test(normalized)) return 'co-op';
  if (/intern/.test(normalized)) return 'intern';
  if (/contract|temporary/.test(normalized)) return 'contract';
  if (/full time/.test(normalized)) return 'full-time';
  return null;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function salaryText(compensation: DoverCompensation | null | undefined): string | null {
  if (!compensation) return null;
  const { lower_bound: lower, upper_bound: upper, currency_code: currency } = compensation;
  if (lower == null && upper == null) return null;
  const range = lower != null && upper != null
    ? `${lower} - ${upper}`
    : String(lower ?? upper);
  const cadence = compensation.salary_range_type?.replace(/_/g, ' ').toLowerCase();
  return [range, currency, cadence].filter(Boolean).join(' ');
}

/** Map a Dover detail response to the common adapter shape. */
export function parseDoverJob(
  detail: DoverJobDetail,
  board: DoverBoard,
  parsed: ParsedDoverUrl,
): RawJob | null {
  const id = detail.id?.trim();
  const title = detail.title?.trim();
  if (!id || !title || detail.active === false || detail.is_private === true) return null;

  const location = collectLocations(detail.locations);
  const workplace = detail.workplace_type ?? '';
  const compensation = detail.compensation;
  return {
    title,
    company: detail.client_name?.trim() || board.name,
    location,
    remote: /remote/i.test(`${workplace} ${location}`),
    url: `${parsed.origin}/apply/${encodeURIComponent(parsed.slug)}/${id}/`,
    source: 'dover',
    postedAt: isoDate(detail.created),
    salaryRaw: salaryText(compensation),
    salaryMin: compensation?.lower_bound ?? null,
    salaryMax: compensation?.upper_bound ?? null,
    salaryCurrency: compensation?.currency_code ?? null,
    type: mapEmploymentType(compensation?.employment_type),
    sponsorship: detail.visa_support == null
      ? null
      : detail.visa_support ? 'Visa sponsorship available' : 'No visa sponsorship',
    description: cleanHtml(detail.user_provided_description),
  };
}

const PAGE_SIZE = 300;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 5;

async function fetchListings(parsed: ParsedDoverUrl): Promise<DoverListing[]> {
  const listings: DoverListing[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const endpoint = `${parsed.origin}/api/v1/careers-page/${parsed.clientId}/jobs`;
    const data = await fetchJson<DoverJobsResponse>(
      `${endpoint}?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    const results = data.results ?? [];
    listings.push(...results);
    if (!data.next || results.length === 0 || listings.length >= (data.count ?? Infinity)) break;
  }
  return listings.filter((job) => job.is_published !== false && job.is_sample !== true && job.id);
}

async function fetchDoverBoard(board: DoverBoard): Promise<RawJob[]> {
  const parsed = parseDoverUrl(board.url);
  if (!parsed) throw new Error(`unparseable Dover careers URL: ${board.url}`);
  const boardUrl = parsed;

  const listings = await fetchListings(boardUrl);
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < listings.length) {
      const listing = listings[cursor++];
      if (!listing?.id) continue;
      try {
        const endpoint = `${boardUrl.origin}/api/v1/inbound/application-portal-job/${listing.id}`;
        const detail = await fetchJson<DoverJobDetail>(endpoint);
        const job = parseDoverJob(detail, board, boardUrl);
        if (job) jobs.push(job);
      } catch (error) {
        failures.push(`${listing.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, listings.length) },
    worker,
  ));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

/** Fetch configured Dover boards concurrently; one unavailable employer is skipped. */
async function fetchBoards(boards: DoverBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchDoverBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function doverAdapter(boards: DoverBoard[] = DOVER_BOARDS): Adapter {
  return {
    name: 'dover',
    fetch: () => fetchBoards(boards),
  };
}

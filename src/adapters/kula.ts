/**
 * Kula careers pages expose the public JSON endpoint used by their own frontend:
 *
 *   GET /api/internal/ats_job_posts?accountName=<slug>&page=<n>&type=ats_job_post.index
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface KulaBoard {
  /** Public Kula careers URL containing the exact account name. */
  url: string;
  name: string;
}

export const KULA_BOARDS: KulaBoard[] = [
  {
    url: 'https://careers.kula.ai/sanctuary-ai',
    name: 'Sanctuary AI',
  },
];

export interface ParsedKulaUrl {
  origin: string;
  accountName: string;
}

interface KulaOffice {
  location?: string | null;
  remote?: boolean;
  workplace?: string | null;
}

interface KulaAtsJob {
  job_description?: string | null;
  workplace?: string | null;
  employment_type?: string | null;
  offices?: KulaOffice[];
}

export interface KulaJobPost {
  id?: number;
  title?: string;
  listed?: boolean;
  is_confidential?: boolean;
  launch_at?: string | null;
  ats_job?: KulaAtsJob | null;
}

export interface KulaResponse {
  data?: KulaJobPost[];
  meta?: {
    count?: number;
    page?: number;
    pages?: number;
  };
  errors?: unknown[];
}

/** Parse a Kula board or posting URL without deriving the account from its company name. */
export function parseKulaUrl(value: string): ParsedKulaUrl | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'careers.kula.ai') return null;
    const match = url.pathname.match(/^\/([^/]+)(?:\/\d+)?\/?$/);
    if (!match?.[1]) return null;
    return { origin: url.origin, accountName: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

function cleanHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = load(value).text().replace(/\s+/g, ' ').trim();
  return text || null;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function mapEmploymentType(value: string | null | undefined): JobType | null {
  const normalized = value?.replace(/[_-]+/g, ' ').trim().toLowerCase() ?? '';
  if (/co ?op/.test(normalized)) return 'co-op';
  if (/intern|student|apprentice/.test(normalized)) return 'intern';
  if (/contract|temporary|fixed term/.test(normalized)) return 'contract';
  if (/full time/.test(normalized)) return 'full-time';
  return null;
}

function collectLocations(offices: KulaOffice[] | undefined): string {
  const locations = (offices ?? [])
    .map((office) => office.location?.trim())
    .filter((location): location is string => Boolean(location));
  return [...new Set(locations)].join('; ');
}

/** Map Kula's structured listing payload to the common adapter shape. */
export function mapKulaResponse(
  response: KulaResponse,
  board: KulaBoard,
  parsed: ParsedKulaUrl,
): RawJob[] {
  return (response.data ?? []).flatMap((post): RawJob[] => {
    const title = post.title?.trim();
    const atsJob = post.ats_job;
    if (!post.id || !title || !atsJob || post.listed === false || post.is_confidential === true) {
      return [];
    }

    const location = collectLocations(atsJob.offices);
    const workplace = [atsJob.workplace, ...(atsJob.offices ?? []).map((office) => (
      `${office.workplace ?? ''} ${office.remote ? 'remote' : ''}`
    ))].join(' ');
    return [{
      title,
      company: board.name,
      location,
      remote: /remote/i.test(`${workplace} ${location}`),
      url: `${parsed.origin}/${encodeURIComponent(parsed.accountName)}/${post.id}/`,
      source: 'kula',
      postedAt: isoDate(post.launch_at),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapEmploymentType(atsJob.employment_type),
      sponsorship: null,
      description: cleanHtml(atsJob.job_description),
    }];
  });
}

const PAGE_SIZE = 99;
const MAX_PAGES = 20;

async function fetchKulaBoard(board: KulaBoard): Promise<RawJob[]> {
  const parsed = parseKulaUrl(board.url);
  if (!parsed) throw new Error(`unparseable Kula careers URL: ${board.url}`);

  const jobs: RawJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const endpoint = new URL('/api/internal/ats_job_posts', parsed.origin);
    endpoint.search = new URLSearchParams({
      accountName: parsed.accountName,
      page: String(page),
      type: 'ats_job_post.index',
      items: String(PAGE_SIZE),
    }).toString();
    const response = await fetchJson<KulaResponse>(endpoint.toString());
    jobs.push(...mapKulaResponse(response, board, parsed));
    const pages = response.meta?.pages;
    if ((response.data?.length ?? 0) === 0 || (pages != null && page >= pages)) break;
  }
  return jobs;
}

async function fetchBoards(boards: KulaBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchKulaBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function kulaAdapter(boards: KulaBoard[] = KULA_BOARDS): Adapter {
  return {
    name: 'kula',
    fetch: () => fetchBoards(boards),
  };
}
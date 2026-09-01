/**
 * Eightfold.ai adapter.
 *
 * Eightfold career sites expose the same public JSON endpoint used by their SPA:
 *
 *   GET https://<tenant>.eightfold.ai/api/pcsx/search
 *       ?domain=<company-domain>&query=intern&location=Canada&start=0
 *
 * The company domain is required by the API and is not reliably derivable from the
 * tenant, so boards keep the real careers URL and domain together. Verify a board by
 * opening its careers URL and checking that `/api/pcsx/search` returns HTTP 200.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface EightfoldBoard {
  /** A real Eightfold careers URL, optionally including an existing search. */
  url: string;
  /** Employer domain required by the PCS search API. */
  domain: string;
  name: string;
}

/** Verified against each tenant's unauthenticated PCS search API. */
export const EIGHTFOLD_BOARDS: EightfoldBoard[] = [
  {
    url: 'https://bostonscientific.eightfold.ai/careers',
    domain: 'bostonscientific.com',
    name: 'Boston Scientific',
  },
  {
    url: 'https://lockheedmartin.eightfold.ai/careers',
    domain: 'lockheedmartin.com',
    name: 'Lockheed Martin',
  },
];

interface EightfoldPosition {
  id?: string | number;
  name?: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  workLocationOption?: string;
  locationFlexibility?: string;
  positionUrl?: string;
  department?: string;
  efcustomTextCustpayrange?: string;
  efcustomTextCustpreferredsalaryV2?: string;
}

interface EightfoldResponse {
  status?: number;
  error?: { message?: string; body?: string };
  data?: {
    positions?: EightfoldPosition[];
    count?: number;
  };
}

export interface ParsedEightfoldUrl {
  origin: string;
  tenant: string;
}

/** Parse only public Eightfold tenant career URLs. */
export function parseEightfoldUrl(url: string): ParsedEightfoldUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.hostname.match(/^([a-z0-9-]+)\.eightfold\.ai$/i);
  if (!match?.[1] || !parsed.pathname.startsWith('/careers')) return null;
  return { origin: parsed.origin, tenant: match[1] };
}

/** Eightfold timestamps are Unix seconds, unlike JavaScript's millisecond timestamps. */
export function parseEightfoldTimestamp(timestamp: number | undefined): string | null {
  if (!Number.isFinite(timestamp) || timestamp === undefined || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanLocations(position: EightfoldPosition): string {
  // `locations` includes the country, while standardizedLocations often abbreviates
  // Canada as "CA" (which can be mistaken for California). Remove only the internal
  // ATS path after `|` and retain the human-facing country text.
  const locations = (position.locations ?? [])
    .map((location) => location.split('|')[0]?.trim() ?? '')
    .filter(Boolean);
  if (locations.length === 0) locations.push(...(position.standardizedLocations ?? []));
  return [...new Set(locations)].join('; ');
}

/** Map one API page into the shared adapter shape. Exported for fixture tests. */
export function parseEightfoldResponse(
  response: EightfoldResponse,
  board: EightfoldBoard,
  parsed: ParsedEightfoldUrl,
): RawJob[] {
  return (response.data?.positions ?? []).flatMap((position) => {
    const id = position.id == null ? '' : String(position.id);
    const title = position.name?.trim() ?? '';
    if (!id || !title) return [];

    const location = cleanLocations(position);
    const workMode = [position.workLocationOption, position.locationFlexibility]
      .filter(Boolean)
      .join(' ');
    const salaryRaw = position.efcustomTextCustpayrange
      ?? position.efcustomTextCustpreferredsalaryV2
      ?? null;

    return [{
      title,
      company: board.name,
      location,
      remote: /remote/i.test(`${location} ${workMode}`),
      url: new URL(position.positionUrl ?? `/careers/job/${id}`, parsed.origin).href,
      source: 'eightfold',
      postedAt: parseEightfoldTimestamp(position.postedTs),
      salaryRaw,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: /(?:C\$|CAD\b)/i.test(salaryRaw ?? '') ? 'CAD' : null,
      type: null,
      sponsorship: null,
      description: position.department ? `Department: ${position.department}` : null,
    } satisfies RawJob];
  });
}

const SEARCH_TERMS = (process.env.JT_EIGHTFOLD_TERMS
  ?? 'intern,co-op,student,stagiaire,mechanical engineering,manufacturing engineering,mechatronics,design engineering,product engineering,materials engineering')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);

const PAGE_SIZE = 10;
const MAX_STUDENT_PAGES = 5;
const MAX_ROLE_PAGES = 2;
const STUDENT_TERMS = new Set(['intern', 'co-op', 'student', 'stagiaire']);

async function fetchEightfoldBoard(board: EightfoldBoard): Promise<RawJob[]> {
  const parsed = parseEightfoldUrl(board.url);
  if (!parsed) throw new Error(`unparseable Eightfold URL: ${board.url}`);

  const endpoint = `${parsed.origin}/api/pcsx/search`;
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (const term of SEARCH_TERMS) {
    const maxPages = STUDENT_TERMS.has(term.toLowerCase()) ? MAX_STUDENT_PAGES : MAX_ROLE_PAGES;
    let pagesForTerm = maxPages;

    for (let page = 0; page < pagesForTerm; page++) {
      const params = new URLSearchParams({
        domain: board.domain,
        query: term,
        location: 'Canada',
        start: String(page * PAGE_SIZE),
        sort_by: 'relevance',
        filter_include_remote: '1',
        filter_include_relocation: '0',
      });
      const response = await fetchJson<EightfoldResponse>(`${endpoint}?${params}`);
      if (response.status && response.status !== 200) {
        throw new Error(response.error?.message || `API status ${response.status}`);
      }

      const positions = response.data?.positions ?? [];
      if (page === 0 && typeof response.data?.count === 'number') {
        pagesForTerm = Math.min(maxPages, Math.max(1, Math.ceil(response.data.count / PAGE_SIZE)));
      }

      for (const job of parseEightfoldResponse(response, board, parsed)) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }
      if (positions.length < PAGE_SIZE) break;
    }
  }

  return out;
}

/** Fetch boards concurrently; one unavailable tenant does not discard the others. */
async function fetchBoards(boards: EightfoldBoard[], concurrency = 2): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...await fetchEightfoldBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function eightfoldAdapter(boards: EightfoldBoard[] = EIGHTFOLD_BOARDS): Adapter {
  return {
    name: 'eightfold',
    fetch: () => fetchBoards(boards),
  };
}
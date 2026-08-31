/**
 * Dayforce HCM adapter.
 *
 * Dayforce's public careers SPA obtains a CSRF token, then calls a structured search
 * endpoint. Board URLs contain all tenant-specific values needed by that endpoint:
 *
 *   https://jobs.dayforcehcm.com/en-CA/eclipse/CANDIDATEPORTAL
 *   POST /api/geo/eclipse/jobposting/search
 *
 * Search results include full descriptions, exact posting timestamps and structured
 * locations, so no per-job detail requests or HTML scraping are required.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface DayforceBoard {
  /** A real public Dayforce job-board URL. */
  url: string;
  name: string;
}

export const DAYFORCE_BOARDS: DayforceBoard[] = [
  { url: 'https://jobs.dayforcehcm.com/en-CA/eclipse/CANDIDATEPORTAL', name: 'Eclipse Automation' },
];

export interface ParsedDayforceUrl {
  origin: string;
  cultureCode: string;
  clientNamespace: string;
  jobBoardCode: string;
}

interface DayforceLocation {
  formattedAddress?: string;
}

interface DayforcePosting {
  jobPostingId?: number;
  jobTitle?: string;
  jobDescription?: string;
  hasVirtualLocation?: boolean;
  postingStartTimestampUTC?: string;
  postingLocations?: DayforceLocation[];
}

interface DayforceResponse {
  jobPostings?: DayforcePosting[];
  maxCount?: number;
  count?: number;
}

interface CsrfSession {
  token: string;
  cookie: string;
}

const PAGE_SIZE = 25;
const MAX_PAGES = 20;
const USER_AGENT = 'job-tracker/0.1 (personal job search aggregator)';

/** Decompose a Dayforce board or deep job URL into its public API identifiers. */
export function parseDayforceUrl(url: string): ParsedDayforceUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'jobs.dayforcehcm.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const [cultureCode, clientNamespace, jobBoardCode] = segments;
  if (!cultureCode || !clientNamespace || !jobBoardCode) return null;
  if (!/^[a-z]{2}-[a-z]{2}$/i.test(cultureCode)) return null;

  return {
    origin: parsed.origin,
    cultureCode,
    clientNamespace,
    jobBoardCode,
  };
}

/** Convert the description's small amount of HTML/entity encoding to readable text. */
function descriptionText(value: string | undefined): string | null {
  if (!value) return null;
  const $ = load(`<div>${value.replaceAll('\n', '<br>')}</div>`);
  $('br').replaceWith('\n');
  const text = $('div').first().text().replace(/\u00a0/g, ' ').trim();
  return text || null;
}

function extractLabel(description: string | null, label: string): string | null {
  if (!description) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return description.match(new RegExp(`^${escaped}:?\\s*(.+)$`, 'im'))?.[1]?.trim() || null;
}

function mapType(title: string, description: string | null): JobType | null {
  const stated = extractLabel(description, 'Job Type') ?? '';
  const value = `${title} ${stated}`;
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b/i.test(value)) return 'intern';
  if (/\bcontract|temporary|fixed[- ]term\b/i.test(stated)) return 'contract';
  if (/\bfull[- ]?time\b/i.test(stated)) return 'full-time';
  return null;
}

/** Map one API page to the shared adapter shape. Exported for fixture tests. */
export function parseDayforceResponse(
  data: DayforceResponse,
  board: DayforceBoard,
  parsed: ParsedDayforceUrl,
): RawJob[] {
  return (data.jobPostings ?? []).flatMap((posting) => {
    const title = posting.jobTitle?.trim();
    if (!title || !posting.jobPostingId) return [];

    const description = descriptionText(posting.jobDescription);
    const locations = (posting.postingLocations ?? [])
      .map((location) => location.formattedAddress?.trim())
      .filter((location): location is string => Boolean(location));
    const location = locations.length > 0
      ? [...new Set(locations)].join('; ')
      : posting.hasVirtualLocation ? 'Remote' : '';

    return [{
      title,
      company: board.name,
      location,
      remote: Boolean(posting.hasVirtualLocation) || /\bremote\b/i.test(`${title} ${location}`),
      url: `${parsed.origin}/${parsed.cultureCode}/${parsed.clientNamespace}/${parsed.jobBoardCode}/jobs/${posting.jobPostingId}`,
      source: 'dayforce',
      postedAt: posting.postingStartTimestampUTC ?? null,
      salaryRaw: extractLabel(description, 'Compensation'),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(title, description),
      sponsorship: null,
      description,
    }];
  });
}

/** Dayforce requires both halves of NextAuth's double-submit CSRF token. */
async function fetchCsrfSession(origin: string): Promise<CsrfSession> {
  const response = await fetch(`${origin}/api/auth/csrf`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Dayforce CSRF request returned HTTP ${response.status}`);

  const data = await response.json() as { csrfToken?: string };
  if (!data.csrfToken) throw new Error('Dayforce CSRF response did not include a token');
  const cookie = response.headers.getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('Dayforce CSRF response did not include a cookie');
  return { token: data.csrfToken, cookie };
}

async function fetchDayforceBoard(board: DayforceBoard): Promise<RawJob[]> {
  const parsed = parseDayforceUrl(board.url);
  if (!parsed) throw new Error(`unparseable Dayforce URL: ${board.url}`);

  const session = await fetchCsrfSession(parsed.origin);
  const endpoint = `${parsed.origin}/api/geo/${parsed.clientNamespace}/jobposting/search`;
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const paginationStart = page * PAGE_SIZE;
    const body = JSON.stringify({
      clientNamespace: parsed.clientNamespace,
      jobBoardCode: parsed.jobBoardCode,
      cultureCode: parsed.cultureCode,
      distanceUnit: 1,
      paginationStart,
    });
    const text = await fetchText(`${endpoint}#${parsed.jobBoardCode}@${paginationStart}`, {
      method: 'POST',
      body,
      realUrl: endpoint,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: session.cookie,
        referer: board.url,
        'x-csrf-token': session.token,
      },
    });
    const data = JSON.parse(text) as DayforceResponse;
    const jobs = parseDayforceResponse(data, board, parsed);
    for (const job of jobs) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      out.push(job);
    }

    const count = data.count ?? data.jobPostings?.length ?? 0;
    if (count < PAGE_SIZE || paginationStart + count >= (data.maxCount ?? 0)) break;
  }
  return out;
}

/** Fetch boards concurrently; one broken tenant does not hide results from the rest. */
async function fetchBoards(boards: DayforceBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchDayforceBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (jobs.length === 0) {
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    if (failures.length > 0) throw new Error(failures.join('; '));
  }
  return jobs;
}

export function dayforceAdapter(boards: DayforceBoard[] = DAYFORCE_BOARDS): Adapter {
  return {
    name: 'dayforce',
    fetch: () => fetchBoards(boards),
  };
}
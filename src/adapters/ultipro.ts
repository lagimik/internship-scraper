/**
 * UKG Pro Recruiting (formerly UltiPro) adapter.
 *
 * UKG job boards load structured opportunities after establishing an anonymous
 * ASP.NET session. A board-page GET supplies an antiforgery cookie and hidden token;
 * both are sent to the JSON search endpoint used by the public page.
 */

import type { Adapter, RawJob } from '../types.js';
import { load } from 'cheerio';

export interface UltiProBoard {
  /** Public URL ending in `/JobBoard/<board UUID>/`. */
  url: string;
  name: string;
  /** Blank for a dedicated student board; set terms for large general boards. */
  searchTerms?: string[];
}

/** Dedicated MDA co-op/internship board, verified against its public search endpoint. */
export const ULTIPRO_BOARDS: UltiProBoard[] = [
  {
    url: 'https://recruiting.ultipro.ca/MAC5000MCDW/JobBoard/7667adcc-47ae-477a-9183-0d8ef8bc0748/?q=&o=postedDateDesc',
    name: 'MDA Space',
    searchTerms: [''],
  },

  {
    url: 'https://recruiting.ultipro.ca/HER5001HERO/JobBoard/e5ac0ff2-938c-46f6-8143-8edb3cf5527b/?q=&o=postedDateDesc&w=&wc=&we=&wpst=',
    name: 'Heroux-Devtek Inc',
    searchTerms: [''],
  }
];

export interface ParsedUltiProUrl {
  origin: string;
  boardPath: string;
  boardUrl: string;
  searchUrl: string;
}

/** Parse a UKG board URL while preserving tenant and board identifiers. */
export function parseUltiProUrl(url: string): ParsedUltiProUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/^(recruiting\.)?(ultipro|ukg)\./i.test(parsed.hostname)) {
      return null;
    }
    const match = parsed.pathname.match(/^\/(.+?\/JobBoard\/[0-9a-f-]+)\/?$/i);
    if (!match?.[1]) return null;
    const boardPath = `/${match[1]}`;
    return {
      origin: parsed.origin,
      boardPath,
      boardUrl: `${parsed.origin}${boardPath}/`,
      searchUrl: `${parsed.origin}${boardPath}/JobBoardView/LoadSearchResults`,
    };
  } catch {
    return null;
  }
}

interface UltiProCountry {
  Code?: string;
  Name?: string;
}

interface UltiProState {
  Code?: string;
  Name?: string;
}

interface UltiProLocation {
  LocalizedName?: string | null;
  LocalizedDescription?: string | null;
  Address?: {
    City?: string | null;
    PostalCode?: string | null;
    State?: UltiProState | null;
    Country?: UltiProCountry | null;
  } | null;
}

export interface UltiProOpportunity {
  Id?: string;
  Title?: string;
  RequisitionNumber?: string;
  FullTime?: boolean;
  JobCategoryName?: string;
  Locations?: UltiProLocation[];
  PostedDate?: string;
  BriefDescription?: string;
  JobLocationType?: string | number | null;
  OpportunityType?: string | number | null;
}

export interface UltiProResponse {
  opportunities?: UltiProOpportunity[];
  totalCount?: number;
}

function formatLocation(location: UltiProLocation): string | null {
  const address = location.Address;
  const parts = [
    address?.City,
    address?.State?.Code ?? address?.State?.Name,
    address?.PostalCode,
    address?.Country?.Code ?? address?.Country?.Name,
  ].filter((part): part is string => Boolean(part));
  return parts.length
    ? parts.join(', ')
    : location.LocalizedName ?? location.LocalizedDescription ?? null;
}

/** Map a UKG response page to the shared adapter shape. */
export function parseUltiProResponse(
  response: UltiProResponse,
  board: UltiProBoard,
  parsed = parseUltiProUrl(board.url),
): RawJob[] {
  if (!parsed) return [];
  const jobs: RawJob[] = [];

  for (const opportunity of response.opportunities ?? []) {
    const id = opportunity.Id?.trim();
    const title = opportunity.Title?.trim();
    if (!id || !title) continue;

    const location = [...new Set(
      (opportunity.Locations ?? [])
        .map(formatLocation)
        .filter((value): value is string => Boolean(value)),
    )].join('; ');
    const postedAt = opportunity.PostedDate && !Number.isNaN(Date.parse(opportunity.PostedDate))
      ? new Date(opportunity.PostedDate).toISOString()
      : null;
    const locationType = String(opportunity.JobLocationType ?? '');

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(locationType)
        || /remote|home.?based/i.test(location)
        || /remote/i.test(title),
      url: `${parsed.boardUrl}OpportunityDetail?opportunityId=${encodeURIComponent(id)}`,
      source: 'ultipro',
      postedAt,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: opportunity.BriefDescription?.trim() || null,
    });
  }
  return jobs;
}

const USER_AGENT = 'job-tracker/0.1 (personal job search aggregator)';
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

function cookieHeader(headers: Headers): string {
  return headers.getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function createSession(parsed: ParsedUltiProUrl): Promise<{
  cookie: string;
  token: string;
}> {
  const response = await fetch(parsed.boardUrl, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${parsed.boardUrl}`);

  const html = await response.text();
  // Current UKG pages inject this input from an inline script, so Cheerio cannot see
  // it as a DOM node. Keep the DOM path for older templates and parse the generated
  // input markup as a fallback.
  const token = load(html)('input[name="__RequestVerificationToken"]').attr('value')
    ?? /<input\s+name=["']__RequestVerificationToken["'][^>]*\bvalue=["']([^"']+)["']/i.exec(html)?.[1];
  const cookie = cookieHeader(response.headers);
  if (!token || !cookie) throw new Error('UKG anonymous session did not provide antiforgery credentials');
  return { cookie, token };
}

function searchBody(query: string, skip: number): string {
  return JSON.stringify({
    opportunitySearch: {
      Top: PAGE_SIZE,
      Skip: skip,
      QueryString: query,
      OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }],
      Filters: [4, 5, 6, 37].map((fieldName) => ({
        t: 'TermsSearchFilterDto', fieldName, extra: null, values: [],
      })),
    },
    matchCriteria: {
      PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [],
      hasNoLicenses: false, SkippedSkills: [],
    },
  });
}

async function fetchPage(
  parsed: ParsedUltiProUrl,
  session: { cookie: string; token: string },
  query: string,
  skip: number,
): Promise<UltiProResponse> {
  const response = await fetch(parsed.searchUrl, {
    method: 'POST',
    body: searchBody(query, skip),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
      'content-type': 'application/json; charset=UTF-8',
      cookie: session.cookie,
      referer: parsed.boardUrl,
      'x-requested-with': 'XMLHttpRequest',
      'x-requestverificationtoken': session.token,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${parsed.searchUrl}`);
  return await response.json() as UltiProResponse;
}

async function fetchBoard(board: UltiProBoard): Promise<RawJob[]> {
  const parsed = parseUltiProUrl(board.url);
  if (!parsed) throw new Error(`unparseable UKG Pro URL: ${board.url}`);
  const session = await createSession(parsed);
  const configured = process.env.JT_ULTIPRO_TERMS;
  const terms = configured === undefined
    ? board.searchTerms ?? ['intern', 'co-op', 'student', 'stagiaire']
    : configured.split(',').map((term) => term.trim());
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await fetchPage(parsed, session, term, page * PAGE_SIZE);
      const pageJobs = parseUltiProResponse(response, board, parsed);
      for (const job of pageJobs) {
        if (!seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }
      const total = response.totalCount ?? pageJobs.length;
      if (pageJobs.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) break;
    }
  }
  return jobs;
}

/** Fetch boards concurrently; one unavailable UKG tenant does not block the rest. */
async function fetchBoards(boards: UltiProBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function ultiProAdapter(boards: UltiProBoard[] = ULTIPRO_BOARDS): Adapter {
  return {
    name: 'ultipro',
    fetch: () => fetchBoards(boards),
  };
}
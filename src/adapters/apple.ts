/**
 * Apple Jobs adapter.
 *
 * jobs.apple.com uses a public JSON endpoint behind its search page. The endpoint
 * requires a short-lived CSRF token and its accompanying session cookies, but no
 * account or authentication. Like Workday, this adapter runs focused searches,
 * pages the summaries, dedupes detail URLs, and leaves the final country, role,
 * student, age, and four-month checks to normalize().
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

const ORIGIN = 'https://jobs.apple.com';
const CSRF_URL = `${ORIGIN}/api/v1/CSRFToken`;
const SEARCH_URL = `${ORIGIN}/api/v1/search`;
const PAGE_SIZE = 20;
const MAX_PAGES_PER_SEARCH = 10;

interface AppleLocation {
  postLocationId?: string;
  city?: string;
  stateProvince?: string;
  countryName?: string;
  name?: string;
}

interface AppleSearchResult {
  id?: string;
  positionId?: string;
  postingTitle?: string;
  transformedPostingTitle?: string;
  postingDate?: string;
  postDateInGMT?: string;
  jobSummary?: string;
  locations?: AppleLocation[];
  team?: { teamName?: string; teamCode?: string };
  homeOffice?: boolean;
  managedPipelineRole?: boolean;
}

export interface AppleSearchResponse {
  res?: {
    searchResults?: AppleSearchResult[];
    totalRecords?: number;
  };
}

interface AppleSearch {
  query: string;
  location: 'postLocation-CANC' | 'postLocation-USA';
  locale: 'en-ca' | 'en-us';
}

const SEARCHES: AppleSearch[] = [
  // Apple's Canadian board is small enough to cover completely. This also catches
  // student postings whose titles use an uncommon campus-program label.
  { query: '', location: 'postLocation-CANC', locale: 'en-ca' },
  // The US board has thousands of roles, so search only explicit student markers.
  { query: 'intern', location: 'postLocation-USA', locale: 'en-us' },
  { query: 'co-op', location: 'postLocation-USA', locale: 'en-us' },
  { query: 'student', location: 'postLocation-USA', locale: 'en-us' },
];

function clean(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function locationText(location: AppleLocation): string {
  const detailed = [clean(location.city), clean(location.stateProvince), clean(location.countryName)]
    .filter(Boolean);
  if (detailed.length > 0) return [...new Set(detailed)].join(', ');
  return clean(location.name) || clean(location.countryName);
}

function detailUrl(job: AppleSearchResult, locale: string): string | null {
  const positionId = clean(job.positionId);
  const slug = clean(job.transformedPostingTitle);
  if (!positionId || !slug) return null;

  const locationId = clean(job.locations?.[0]?.postLocationId).replace(/^postLocation-/, '');
  const detailId = job.managedPipelineRole || !locationId || /^(CANC|USA)$/.test(locationId)
    ? positionId
    : `${positionId}-${locationId}`;
  const url = new URL(`/${locale}/details/${detailId}/${slug}`, ORIGIN);
  const team = clean(job.team?.teamCode);
  if (team) url.searchParams.set('team', team);
  return url.toString();
}

/** Map Apple's structured search response to the shared adapter shape. */
export function parseAppleSearchResponse(
  response: AppleSearchResponse,
  locale: 'en-ca' | 'en-us',
): RawJob[] {
  return (response.res?.searchResults ?? []).flatMap((job): RawJob[] => {
    const title = clean(job.postingTitle);
    const url = detailUrl(job, locale);
    const locations = (job.locations ?? []).map(locationText).filter(Boolean);
    if (!title || !url || locations.length === 0) return [];

    const location = [...new Set(locations)].join('; ');
    const summary = clean(job.jobSummary);
    const team = clean(job.team?.teamName);
    const description = [team ? `Team: ${team}` : '', summary].filter(Boolean).join('\n\n') || null;

    return [{
      title,
      company: 'Apple',
      location,
      remote: Boolean(job.homeOffice) || /\b(remote|home.?based)\b/i.test(`${title} ${location}`),
      url,
      source: 'apple',
      postedAt: isoDate(job.postDateInGMT) ?? isoDate(job.postingDate),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description,
    }];
  });
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie))
    .join('; ');
}

async function createSession(): Promise<{ token: string; cookie: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(CSRF_URL, {
        headers: {
          accept: '*/*',
          origin: ORIGIN,
          referer: `${ORIGIN}/en-ca/search?location=canada-CANC`,
          'user-agent': 'job-tracker/0.1 (personal job search aggregator)',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${CSRF_URL}`);
      const token = response.headers.get('x-apple-csrf-token') ?? '';
      const cookie = cookieHeader(response);
      if (!token || !cookie) throw new Error('Apple CSRF response omitted token or session cookies');
      return { token, cookie };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error('Unable to start Apple Jobs session');
}

async function fetchSearchPage(
  search: AppleSearch,
  page: number,
  session: { token: string; cookie: string },
): Promise<AppleSearchResponse> {
  const body = JSON.stringify({
    query: search.query,
    filters: { locations: [search.location] },
    page,
    locale: search.locale,
    sort: '',
    format: { longDate: 'MMMM D, YYYY', mediumDate: 'MMM D, YYYY' },
  });
  const cacheKey = `${SEARCH_URL}#${search.locale}:${search.query || 'all'}@${page}`;
  return fetchJson<AppleSearchResponse>(cacheKey, {
    realUrl: SEARCH_URL,
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-apple-csrf-token': session.token,
      cookie: session.cookie,
      browserlocale: search.locale,
      locale: 'en_US',
      origin: ORIGIN,
      referer: `${ORIGIN}/${search.locale}/search`,
    },
  });
}

async function fetchAppleJobs(): Promise<RawJob[]> {
  const session = await createSession();
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const search of SEARCHES) {
    try {
      const first = await fetchSearchPage(search, 1, session);
      const total = first.res?.totalRecords ?? 0;
      const pages = Math.min(MAX_PAGES_PER_SEARCH, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      const responses = [first];
      for (let page = 2; page <= pages; page++) {
        responses.push(await fetchSearchPage(search, page, session));
      }
      for (const response of responses) {
        for (const job of parseAppleSearchResponse(response, search.locale)) {
          if (seen.has(job.url)) continue;
          seen.add(job.url);
          jobs.push(job);
        }
      }
    } catch (error) {
      errors.push(`${search.locale}/${search.query || 'all'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (jobs.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
  return jobs;
}

export function appleAdapter(): Adapter {
  return { name: 'apple', fetch: fetchAppleJobs };
}
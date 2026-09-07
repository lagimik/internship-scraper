/** Radancy Career Website Services public jobs API adapter. */

import { load } from 'cheerio';
import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface CwsBoard {
  url: string;
  name: string;
  apiUrl: string;
  companyName: string;
  customAttributeFilter?: string;
}

export const CWS_BOARDS: CwsBoard[] = [{
  url: 'https://jobs.riotinto.com/',
  name: 'Rio Tinto',
  apiUrl: 'https://jobsapi-google.m-cloud.io/api/job/search',
  companyName: 'companies/de826bcc-d0cf-4689-9fc1-c1d9b100d59c',
  customAttributeFilter: 'ats_portalid="Workday" AND is_internal="RioTinto_Careers"',
}];

export interface ParsedCwsUrl {
  origin: string;
}

export interface CwsJob {
  id?: number;
  title?: string;
  primary_city?: string;
  primary_state?: string;
  primary_country?: string;
  location_type?: string;
  open_date?: string;
  job_type?: string;
  employment_type?: string;
  description?: string;
}

export interface CwsSearchResponse {
  totalHits?: number;
  nextPageToken?: string;
  searchResults?: Array<{ job?: CwsJob }>;
}

export function parseCwsUrl(url: string): ParsedCwsUrl | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? { origin: parsed.origin } : null;
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function cleanHtml(value: string | undefined): string | null {
  if (!value) return null;
  return load(value).text().replace(/\s+/g, ' ').trim() || null;
}

export function mapCwsJob(job: CwsJob, board: CwsBoard): RawJob | null {
  const parsed = parseCwsUrl(board.url);
  const title = job.title?.trim();
  if (!parsed || !job.id || !title) return null;

  const location = [job.primary_city, job.primary_state, job.primary_country]
    .filter(Boolean)
    .join(', ');
  const employment = `${job.job_type ?? ''} ${job.employment_type ?? ''}`;

  return {
    title,
    company: board.name,
    location,
    remote: /remote|home.?based/i.test(`${title} ${location} ${job.location_type ?? ''}`),
    url: `${parsed.origin}/job/${job.id}/${slugify(title)}/`,
    source: 'cws',
    postedAt: parseDate(job.open_date),
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: /co[\s-]?op/i.test(title)
      ? 'co-op'
      : /intern|student|stagiaire/i.test(`${title} ${employment}`) ? 'intern' : null,
    sponsorship: null,
    description: cleanHtml(job.description),
  };
}

const SEARCH_TERMS = ['co-op', 'intern', 'student', 'stagiaire'];
const PAGE_SIZE = 25;
const MAX_PAGES = 10;

async function fetchBoard(board: CwsBoard): Promise<RawJob[]> {
  if (!parseCwsUrl(board.url)) throw new Error(`unparseable CWS URL: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(board.apiUrl);
      url.searchParams.set('pageSize', String(PAGE_SIZE));
      url.searchParams.set('companyName', board.companyName);
      url.searchParams.set('query', term);
      url.searchParams.set('orderBy', 'posting_publish_time desc');
      if (board.customAttributeFilter) {
        url.searchParams.set('customAttributeFilter', board.customAttributeFilter);
      }
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await fetchJson<CwsSearchResponse>(url.toString());
      for (const result of response.searchResults ?? []) {
        if (!result.job) continue;
        const job = mapCwsJob(result.job, board);
        if (job && !seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      if (!response.nextPageToken || (response.searchResults?.length ?? 0) === 0) break;
      pageToken = response.nextPageToken;
    }
  }
  return jobs;
}

async function fetchBoards(boards: CwsBoard[], concurrency = 3): Promise<RawJob[]> {
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

export function cwsAdapter(boards: CwsBoard[] = CWS_BOARDS): Adapter {
  return {
    name: 'cws',
    fetch: () => fetchBoards(boards),
  };
}
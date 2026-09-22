/** DirectEmployers JobSyndication public search API adapter. */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface JobsynBoard {
  url: string;
  name: string;
  apiUrl: string;
  location: string;
}

export const JOBSYN_BOARDS: JobsynBoard[] = [{
  url: 'https://aecom.jobs/jobs/?q=intern&r=25',
  name: 'AECOM',
  apiUrl: 'https://prod-search-api.jobsyn.org/api/v1/solr/search',
  location: 'can',
}];

export interface ParsedJobsynUrl {
  origin: string;
  hostname: string;
}

export interface JobsynJob {
  city_exact?: string;
  country_exact?: string;
  date_new?: string;
  description?: string;
  guid?: string;
  job_type?: string;
  location_exact?: string;
  state_short?: string;
  title_exact?: string;
  title_slug?: string;
}

export interface JobsynSearchResponse {
  jobs?: JobsynJob[];
  pagination?: {
    has_more_pages?: boolean;
  };
}

export function parseJobsynUrl(value: string): ParsedJobsynUrl | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? { origin: url.origin, hostname: url.hostname } : null;
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

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function mapJobsynJob(job: JobsynJob, board: JobsynBoard): RawJob | null {
  const parsed = parseJobsynUrl(board.url);
  const title = job.title_exact?.trim();
  const location = job.location_exact?.trim();
  if (!parsed || !title || !location || !job.guid) return null;

  const locationSlug = slugify([job.city_exact, job.state_short].filter(Boolean).join('-'));
  const titleSlug = job.title_slug?.trim() || slugify(title);
  if (!locationSlug || !titleSlug) return null;

  return {
    title,
    company: board.name,
    location: [location, job.country_exact].filter(Boolean).join(', '),
    remote: /remote|home.?based/i.test(`${title} ${location} ${job.job_type ?? ''}`),
    url: `${parsed.origin}/${locationSlug}/${titleSlug}/${job.guid}/job/`,
    source: 'jobsyn',
    postedAt: isoDate(job.date_new),
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: /co[\s-]?op/i.test(title)
      ? 'co-op'
      : /intern|student|stagiaire/i.test(title) ? 'intern' : null,
    sponsorship: null,
    description: job.description?.trim() || null,
  };
}

const SEARCH_TERMS = ['co-op', 'intern', 'student', 'stagiaire'];
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

async function fetchBoard(board: JobsynBoard): Promise<RawJob[]> {
  const parsed = parseJobsynUrl(board.url);
  if (!parsed) throw new Error(`unparseable JobSyndication URL: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(board.apiUrl);
      url.searchParams.set('q', term);
      url.searchParams.set('page', String(page));
      url.searchParams.set('location', board.location);
      url.searchParams.set('num_items', String(PAGE_SIZE));
      const requestUrl = url.toString();
      const response = await fetchJson<JobsynSearchResponse>(
        `${requestUrl}#origin=${parsed.hostname}`,
        {
          realUrl: requestUrl,
        headers: { origin: parsed.origin, 'x-origin': parsed.hostname },
        },
      );

      for (const result of response.jobs ?? []) {
        const job = mapJobsynJob(result, board);
        if (job && !seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      if (!response.pagination?.has_more_pages) break;
    }
  }
  return jobs;
}

async function fetchBoards(boards: JobsynBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function jobsynAdapter(boards: JobsynBoard[] = JOBSYN_BOARDS): Adapter {
  return { name: 'jobsyn', fetch: () => fetchBoards(boards) };
}
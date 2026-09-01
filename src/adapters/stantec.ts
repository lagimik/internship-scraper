/**
 * Stantec's public internship/co-op campaign adapter.
 *
 * stantec.jobs is a Recruit Rooster/NLX site. Its initial HTML is only a Nuxt shell;
 * the page loads jobs from this public JSON search endpoint. Like the Workday adapter,
 * this maps paginated summaries to RawJob and leaves role, country, student type, and
 * term validation to normalize().
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export const STANTEC_JOBS_URL =
  'https://stantec.jobs/campaigns/internship-co-op-student/jobs/';
const STANTEC_SEARCH_URL = 'https://prod-search-api.jobsyn.org/api/v1/solr/search';
const PAGE_SIZE = 50;

interface StantecJob {
  company_exact?: string;
  title_exact?: string;
  title_slug?: string;
  location_exact?: string;
  city_exact?: string;
  state_short_exact?: string;
  country_exact?: string;
  date_new?: string;
  description?: string;
  guid?: string;
}

export interface StantecResponse {
  jobs?: StantecJob[];
  pagination?: {
    page?: number;
    total_pages?: number;
    has_more_pages?: boolean;
  };
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Map the same structured response consumed by the Stantec jobs page. */
export function parseStantecResponse(response: StantecResponse): RawJob[] {
  return (response.jobs ?? []).flatMap((job): RawJob[] => {
    const title = job.title_exact?.trim();
    const guid = job.guid?.trim();
    const titleSlug = job.title_slug?.trim() || (title ? slug(title) : '');
    const rawLocation = job.location_exact?.trim();
    if (!title || !guid || !titleSlug || !rawLocation) return [];

    const country = job.country_exact?.trim();
    const location = country && !rawLocation.toLowerCase().includes(country.toLowerCase())
      ? `${rawLocation}, ${country}`
      : rawLocation;
    const place = [job.city_exact, job.state_short_exact].filter(Boolean).join('-') || rawLocation;
    const description = job.description?.replace(/\s+/g, ' ').trim() || null;

    return [{
      title,
      company: job.company_exact?.trim() || 'Stantec',
      location,
      remote: /\b(remote|home.?based|flexible working)\b/i.test(
        `${title} ${location} ${description ?? ''}`,
      ),
      url: new URL(`/${slug(place)}/${titleSlug}/${guid}/job/`, STANTEC_JOBS_URL).toString(),
      source: 'stantec',
      postedAt: isoDate(job.date_new),
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

async function fetchPage(page: number): Promise<StantecResponse> {
  const url = new URL(STANTEC_SEARCH_URL);
  url.searchParams.set('page', String(page));
  url.searchParams.set('campaigns', 'internship-co-op-student');
  url.searchParams.set('num_items', String(PAGE_SIZE));
  return fetchJson<StantecResponse>(url.toString(), {
    // The API checks these public site identifiers, mirroring the browser request.
    headers: {
      origin: 'https://stantec.jobs',
      referer: 'https://stantec.jobs/',
      'x-origin': 'stantec.jobs',
    },
  });
}

async function fetchStantecJobs(): Promise<RawJob[]> {
  const first = await fetchPage(1);
  const jobs = parseStantecResponse(first);
  const totalPages = Math.max(1, first.pagination?.total_pages ?? 1);

  for (let page = 2; page <= totalPages; page++) {
    jobs.push(...parseStantecResponse(await fetchPage(page)));
  }
  return jobs;
}

export function stantecAdapter(): Adapter {
  return { name: 'stantec', fetch: fetchStantecJobs };
}

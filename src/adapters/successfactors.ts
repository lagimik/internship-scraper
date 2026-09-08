/**
 * SAP SuccessFactors Recruiting Marketing adapter.
 *
 * Career Site Builder exposes server-rendered search pages at `/search/`. The same
 * title links and location/date fields shown to a browser are parsed here, avoiding
 * private APIs and one detail-page request per posting.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson, fetchText } from '../lib/fetch.js';
import { load } from 'cheerio';

export interface SuccessFactorsBoard {
  /** Any public page on the employer's SuccessFactors career-site host. */
  url: string;
  name: string;
  /** Newer RMK sites load search results from the public recruiting service. */
  apiBrand?: string;
  apiLocale?: string;
  apiLocation?: string;
  apiDefaultLocation?: string;
  apiDateOrder?: 'mdy' | 'dmy';
  apiJobPathBrand?: boolean;
  apiTerms?: string[];
}

/** Career sites verified to expose server-rendered `/search/` results. */
export const SUCCESSFACTORS_BOARDS: SuccessFactorsBoard[] = [
  {
    url: 'https://jobs.hatch.com/search/?createNewAlert=false&q=engineer&locationsearch=',
    name: 'Hatch',
  },
  {
    url: 'https://jobs.atsautomation.com/search/?createNewAlert=false&q=&locationsearch=canada',
    name: 'ATS Automation',
  },
  {
    url: 'https://careers.kinectrics.com/search/?createNewAlert=false&q=&locationsearch=',
    name: 'Kinectrics',
  },
  {
    url: 'https://jobs.bombardier.com/search/?q=',
    name: 'Bombardier',
  },

  {
    url: 'https://careers.brp.com/global/en/job/36297/Manufacturing-Engineer',
    name: 'BRP',
  },
  {
    url: 'https://jobs.aecon.com/go/Aecon-Engineering/2609417/',
    name: 'Aecon',
  },
  {
    url: 'https://jobs.opg.com/search/?searchby=location&createNewAlert=false&q=&locationsearch=&geolocation=&searchResultView=LIST',
    name: 'OPG',
  },
  {
    url: 'https://careers.magellan.aero/search/?createNewAlert=false&q=&locationsearch=&optionsFacetsDD_department=',
    name: 'Magellan Aerospace',
  },
  {
    url: 'https://careers.celestica.com/search/?createNewAlert=false&q=&locationsearch=',
    name: 'Celestica',
  },
  {
    url: 'https://jobsearch.alstom.com/search/',
    name: 'Alstom',
  },
  {
    url: 'https://jobs.nutrien.com/North-America/go/search-result-na/2701217/',
    name: 'Nutrien',
    apiBrand: 'North-America',
  },
  {
    url: 'https://emploi.hydroquebec.com/search/?q=etudiant',
    name: 'Hydro-Québec',
    apiBrand: 'Hydro-Québec',
    apiLocale: 'fr_FR',
    apiLocation: '',
    apiDefaultLocation: 'Québec, Canada',
    apiDateOrder: 'dmy',
    apiJobPathBrand: false,
    apiTerms: ['etudiant'],
  },
];

export interface ParsedSuccessFactorsUrl {
  origin: string;
  searchUrl: string;
}

/** Resolve any career-site page to the host's conventional search endpoint. */
export function parseSuccessFactorsUrl(url: string): ParsedSuccessFactorsUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { origin: parsed.origin, searchUrl: `${parsed.origin}/search/` };
  } catch {
    return null;
  }
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^date\s*/i, '').trim();
  const parts = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})$/i.exec(cleaned);
  if (!parts?.[1] || !parts[2] || !parts[3]) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(parts[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(parts[3]), month, Number(parts[2])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface SuccessFactorsApiJob {
  jobLocationShort?: string[];
  remoteElig?: string[];
  filter3?: string[];
  brandUrl?: string;
  unifiedUrlTitle?: string;
  unifiedStandardStart?: string;
  id?: string;
  unifiedStandardTitle?: string;
}

interface SuccessFactorsApiResponse {
  jobSearchResult?: Array<{ response?: SuccessFactorsApiJob }>;
  totalJobs?: number;
}

function parseApiDate(value: string | undefined, order: 'mdy' | 'dmy' = 'mdy'): string | null {
  if (!value) return null;
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!parts?.[1] || !parts[2] || !parts[3]) return null;
  const year = Number(parts[3]) < 100 ? 2000 + Number(parts[3]) : Number(parts[3]);
  const month = Number(order === 'dmy' ? parts[2] : parts[1]);
  const day = Number(order === 'dmy' ? parts[1] : parts[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/** Map a job returned by the newer Recruiting Marketing search service. */
export function mapSuccessFactorsApiJob(
  posting: SuccessFactorsApiJob,
  board: SuccessFactorsBoard,
): RawJob | null {
  const parsed = parseSuccessFactorsUrl(board.url);
  const title = posting.unifiedStandardTitle?.trim();
  const slug = posting.unifiedUrlTitle;
  const brand = posting.brandUrl ?? board.apiBrand;
  if (!parsed || !title || !slug || !brand || !posting.id) return null;

  const location = (posting.jobLocationShort ?? [])
    .map((value) => value.replace(/<br\s*\/?>/gi, '').trim())
    .filter(Boolean)
    .join('; ') || board.apiDefaultLocation || '';
  const employmentType = posting.filter3?.join(' ') ?? '';
  const jobPath = board.apiJobPathBrand === false ? '' : `/${brand}`;

  return {
    title,
    company: board.name,
    location,
    remote: /remote|home.?based/i.test(`${posting.remoteElig?.join(' ') ?? ''} ${location} ${title}`),
    url: `${parsed.origin}${jobPath}/job/${slug}/${posting.id}-${board.apiLocale ?? 'en_US'}`,
    source: 'successfactors',
    postedAt: parseApiDate(posting.unifiedStandardStart, board.apiDateOrder),
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: /co-?op/i.test(title) ? 'co-op' : /intern|student|stage|étudiant/i.test(`${title} ${employmentType}`) ? 'intern' : null,
    sponsorship: null,
    description: null,
  };
}

/** Parse both the classic table layout and the newer responsive tile layout. */
export function parseSuccessFactorsHtml(
  html: string,
  board: SuccessFactorsBoard,
): RawJob[] {
  const parsed = parseSuccessFactorsUrl(board.url);
  if (!parsed) return [];

  const $ = load(html);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  $('a.jobTitle-link[href*="/job/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!href || !title || seen.has(href)) return;
    seen.add(href);

    // Both layouts repeat title links for desktop/tablet/phone. Their enclosing result
    // row is the stable boundary and, unlike link-to-link slicing, also handles ATS's
    // template where metadata appears before the title.
    const container = anchor.closest('.job-row, tr.data-row, tr');
    const primaryLocation = container.find('.jobLocation').first().text().trim()
      || container.find('.section-field.location').first().text().replace(/^\s*location\s*/i, '').trim();
    const otherLocations = container.find('.section-field.multilocation').first().text()
      .replace(/^\s*other locations?\s*/i, '').trim();
    const location = [...new Set([primaryLocation, otherLocations].filter(Boolean))].join('; ');
    const date = container.find('.jobDate').first().text().trim()
      || container.find('.section-field.date').first().text().trim();
    const url = new URL(href, parsed.origin).toString();

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(location) || /remote/i.test(title),
      url,
      source: 'successfactors',
      postedAt: parseDate(date),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: null,
    });
  });

  return jobs;
}

/** Return the next server-rendered result offset advertised by the page. */
export function nextSuccessFactorsOffset(html: string, current: number): number | null {
  const offsets = [...html.matchAll(/[?&](?:amp;)?startrow=(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((offset) => offset > current);
  return offsets.length ? Math.min(...offsets) : null;
}

const SEARCH_TERMS = (process.env.JT_SF_TERMS ?? 'intern,co-op,student,stagiaire')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const MAX_PAGES = 6;
const MAX_API_PAGES = 10;

async function fetchApiBoard(board: SuccessFactorsBoard, parsed: ParsedSuccessFactorsUrl): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  const endpoint = `${parsed.origin}/services/recruiting/v1/jobs`;

  for (const term of board.apiTerms ?? SEARCH_TERMS) {
    let fetched = 0;
    for (let pageNumber = 0; pageNumber < MAX_API_PAGES; pageNumber++) {
      const body = JSON.stringify({
        locale: board.apiLocale ?? 'en_US',
        pageNumber,
        sortBy: '',
        keywords: term,
        location: board.apiLocation ?? 'Canada',
        facetFilters: {},
        brand: board.apiBrand,
        skills: [],
        categoryId: 0,
        alertId: '',
        rcmCandidateId: '',
      });
      const response = await fetchJson<SuccessFactorsApiResponse>(`${endpoint}?${body}`, {
        realUrl: endpoint,
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });
      const postings = response.jobSearchResult ?? [];
      fetched += postings.length;
      for (const entry of postings) {
        if (!entry.response) continue;
        const job = mapSuccessFactorsApiJob(entry.response, board);
        if (job && !seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      if (postings.length === 0 || fetched >= (response.totalJobs ?? Infinity)) break;
    }
  }

  return jobs;
}

async function fetchBoard(board: SuccessFactorsBoard): Promise<RawJob[]> {
  const parsed = parseSuccessFactorsUrl(board.url);
  if (!parsed) throw new Error(`unparseable SuccessFactors URL: ${board.url}`);
  if (board.apiBrand) return fetchApiBoard(board, parsed);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(parsed.searchUrl);
      url.searchParams.set('createNewAlert', 'false');
      url.searchParams.set('q', term);
      url.searchParams.set('locationsearch', 'Canada');
      if (offset > 0) url.searchParams.set('startrow', String(offset));

      const html = await fetchText(url.toString(), {
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      const pageJobs = parseSuccessFactorsHtml(html, board);
      for (const job of pageJobs) {
        if (!seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      const next = nextSuccessFactorsOffset(html, offset);
      if (next === null || next <= offset) break;
      offset = next;
    }
  }
  return jobs;
}

/** Fetch boards concurrently; an unavailable employer site does not block the rest. */
async function fetchBoards(boards: SuccessFactorsBoard[], concurrency = 3): Promise<RawJob[]> {
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

export function successFactorsAdapter(
  boards: SuccessFactorsBoard[] = SUCCESSFACTORS_BOARDS,
): Adapter {
  return {
    name: 'successfactors',
    fetch: () => fetchBoards(boards),
  };
}
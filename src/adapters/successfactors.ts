/**
 * SAP SuccessFactors Recruiting Marketing adapter.
 *
 * Career Site Builder exposes server-rendered search pages at `/search/`. The same
 * title links and location/date fields shown to a browser are parsed here, avoiding
 * private APIs and one detail-page request per posting.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson, fetchText } from '../lib/fetch.js';
import { randomUUID } from 'node:crypto';
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
  /** Legacy hosted RCM sites identify the employer and locale in query parameters. */
  legacyCompany?: string;
  legacyLocale?: string;
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
    url: 'https://jobs.bunge.com/search/',
    name: 'Bunge',
  },
  {
    url: 'https://jobs.babcockinternational.com/go/View-all-Jobs/4819301/',
    name: 'Babcock International',
  },
  {
    url: 'https://recruitment-recrutement.nrc-cnrc.gc.ca/go/all-jobs/2320717/',
    name: 'National Research Council Canada',
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
    url: 'https://jobs.exxonmobil.com/search/?createNewAlert=false&q=&locationsearch=&optionsFacetsDD_department=&optionsFacetsDD_shifttype=&optionsFacetsDD_country=',
    name: 'ExxonMobil',
  },
  {
    url: 'https://jobs.gerdau.com/job/Cambridge-ENGINEERING-INTERN-Onta-N1T-1R9/1335729662/',
    name: 'Gerdau',
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
  {
    url: 'https://career17.sapsf.com/career?career_ns=job_listing&company=C0000173697P&navBarLevel=JOB_SEARCH&rcm_site_locale=fr_CA&career_job_req_id=12045',
    name: 'Aéroports de Montréal (ADM)',
    legacyCompany: 'C0000173697P',
    legacyLocale: 'fr_CA',
  },
  {
    url: 'https://career4.successfactors.com/careers?company=Cascades',
    name: 'Cascades',
    legacyCompany: 'Cascades',
    legacyLocale: 'en_US',
  },
  {
    url: 'https://career4.successfactors.com/careers?company=leggettplatt&company=leggettplatt',
    name: 'Leggett & Platt',
    legacyCompany: 'leggettplatt',
    legacyLocale: 'en_US',
  },
];

export interface ParsedSuccessFactorsUrl {
  origin: string;
  searchUrl: string;
  legacyCompany?: string;
  legacyLocale?: string;
}

/** Resolve any career-site page to the host's conventional search endpoint. */
export function parseSuccessFactorsUrl(url: string): ParsedSuccessFactorsUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const legacyCompany = parsed.searchParams.get('company')
      ?? parsed.searchParams.get('career_company');
    const legacyHost = /^career\d+\.(?:sapsf|successfactors)\.com$/i.test(parsed.hostname);
    if (legacyHost && /^\/careers?$/.test(parsed.pathname)) {
      if (!legacyCompany) return null;
      const legacyLocale = parsed.searchParams.get('rcm_site_locale')
        ?? parsed.searchParams.get('lang') ?? 'en_US';
      const searchUrl = new URL(parsed.pathname, parsed.origin);
      if (parsed.pathname === '/careers') {
        searchUrl.searchParams.set('company', legacyCompany);
        searchUrl.searchParams.set('lang', legacyLocale);
      } else {
        searchUrl.searchParams.set('career_ns', 'job_listing_summary');
        searchUrl.searchParams.set('company', legacyCompany);
        searchUrl.searchParams.set('navBarLevel', 'JOB_SEARCH');
        searchUrl.searchParams.set('rcm_site_locale', legacyLocale);
      }
      return { origin: parsed.origin, searchUrl: searchUrl.toString(), legacyCompany, legacyLocale };
    }
    return { origin: parsed.origin, searchUrl: `${parsed.origin}/search/` };
  } catch {
    return null;
  }
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^date\s*/i, '').trim();
  const monthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const monthFirst = new RegExp(`^${monthPattern}\\s+(\\d{1,2}),\\s*(\\d{4})$`, 'i').exec(cleaned);
  const dayFirst = new RegExp(`^(\\d{1,2})\\s+${monthPattern}\\s+(\\d{4})$`, 'i').exec(cleaned);
  const monthName = monthFirst?.[1] ?? dayFirst?.[2];
  const day = monthFirst?.[2] ?? dayFirst?.[1];
  const year = monthFirst?.[3] ?? dayFirst?.[3];
  if (!monthName || !day || !year) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(monthName.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(year), month, Number(day)));
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
    const container = anchor.closest('.job-row, .job-tile, tr.data-row, tr');
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

export interface SuccessFactorsLegacyPosting {
  id: string;
  title: string;
  postedAt: string | null;
}

function decodeDwrString(value: string): string {
  return JSON.parse(`"${value.replace(/\\'/g, "'")}"`) as string;
}

/** Parse the structured posting records returned by legacy RCM's public DWR service. */
export function parseSuccessFactorsLegacyDwr(body: string): SuccessFactorsLegacyPosting[] {
  const postings: SuccessFactorsLegacyPosting[] = [];
  const pattern = /\b(s\d+)\.corporatePosting=.*?\1\.id=(\d+);.*?\1\.postingDate="((?:\\.|[^"])*)";.*?\1\.title="((?:\\.|[^"])*)";/g;
  for (const match of body.matchAll(pattern)) {
    const [, , id, postingDate, title] = match;
    if (!id || postingDate === undefined || title === undefined) continue;
    postings.push({
      id,
      title: decodeDwrString(title),
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(postingDate)
        ? new Date(`${postingDate}T00:00:00.000Z`).toISOString()
        : parseApiDate(postingDate.replace(/\\\//g, '/')),
    });
  }
  return postings;
}

function legacyDetailUrl(parsed: ParsedSuccessFactorsUrl, id: string): string {
  const searchUrl = new URL(parsed.searchUrl);
  const url = new URL(searchUrl.pathname, parsed.origin);
  url.searchParams.set('career_ns', 'job_listing');
  url.searchParams.set('company', parsed.legacyCompany ?? '');
  if (searchUrl.pathname === '/careers') {
    url.searchParams.set('lang', parsed.legacyLocale ?? 'en_US');
  } else {
    url.searchParams.set('navBarLevel', 'JOB_SEARCH');
    url.searchParams.set('rcm_site_locale', parsed.legacyLocale ?? 'en_US');
  }
  url.searchParams.set('career_job_req_id', id);
  return url.toString();
}

/** Add detail-only fields to a legacy RCM search record. */
export function mapSuccessFactorsLegacyDetail(
  html: string,
  posting: SuccessFactorsLegacyPosting,
  board: SuccessFactorsBoard,
): RawJob | null {
  const parsed = parseSuccessFactorsUrl(board.url);
  if (!parsed?.legacyCompany) return null;
  const $ = load(html);
  const descriptionRoot = $('.joqReqDescription').first();
  const paragraphs = descriptionRoot.find('p').map((_, element) => (
    $(element).text().replace(/\s+/g, ' ').trim()
  )).get();
  const locationLine = paragraphs.find((line) => /^(?:lieu de travail|location)\s*:/i.test(line));
  const metadata = $('.pagetitle').next('div').find('b').map((_, element) => (
    $(element).text().replace(/\s+/g, ' ').trim()
  )).get();
  const metadataLocation = metadata[0] === posting.id
    ? metadata.slice(2, -1).filter(Boolean).join(', ')
    : '';
  const location = locationLine?.replace(/^(?:lieu de travail|location)\s*:\s*/i, '').trim()
    || metadataLocation;
  const description = descriptionRoot.text().replace(/\s+/g, ' ').trim() || null;

  return {
    title: posting.title,
    company: board.name,
    location,
    remote: /remote|télétravail|travail à distance/i.test(`${posting.title} ${location} ${description ?? ''}`),
    url: legacyDetailUrl(parsed, posting.id),
    source: 'successfactors',
    postedAt: posting.postedAt,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: /co-?op/i.test(posting.title) ? 'co-op' : /intern|student|stage|stagiaire|étudiant/i.test(posting.title) ? 'intern' : null,
    sponsorship: null,
    description,
  };
}

const SEARCH_TERMS = (process.env.JT_SF_TERMS ?? 'intern,co-op,student,stagiaire')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const MAX_PAGES = 6;
const MAX_API_PAGES = 10;
const MAX_LEGACY_PAGES = 4;

function dwrSessionId(): string {
  return `${randomUUID().replace(/-/g, '')}${String(Date.now()).slice(-3)}`;
}

async function postLegacyDwr(
  endpoint: string,
  page: string,
  cookie: string,
  token: string,
  eventId: string,
  company: string,
  scriptSessionId: string,
  method: 'getInitialJobSearchData' | 'search',
  batchId: number,
  pagination?: { currentPage: number; pageSize: number; totalCount: number },
): Promise<string> {
  const common = `callCount=1\npage=${page}\nhttpSessionId=\nscriptSessionId=${scriptSessionId}\n`
    + `c0-scriptName=careerJobSearchControllerProxy\nc0-methodName=${method}\nc0-id=0\n`;
  const body = pagination
    ? common
      + `c0-e2=number:${pagination.currentPage}\nc0-e3=number:${pagination.currentPage * pagination.pageSize}\n`
      + `c0-e4=boolean:false\nc0-e5=string:${pagination.pageSize}\n`
      + `c0-e6=number:${(pagination.currentPage - 1) * pagination.pageSize + 1}\n`
      + `c0-e7=number:${pagination.totalCount}\n`
      + 'c0-e1=Object_Object:{currentPage:reference:c0-e2, endRow:reference:c0-e3, increaseCandSummaryPagination:reference:c0-e4, pageSize:reference:c0-e5, startRow:reference:c0-e6, totalCount:reference:c0-e7}\n'
      + 'c0-e8=string:JOB_POSTING_DATE\nc0-e9=string:DESC\n'
      + 'c0-param0=Object_Object:{pagination:reference:c0-e1, sortByColumn:reference:c0-e8, sortOrder:reference:c0-e9}\n'
      + `batchId=${batchId}\n`
    : common
      + 'c0-e1=string:\nc0-e2=string:\nc0-e3=string:\nc0-e4=string:America%2FNew_York\n'
      + 'c0-param0=Object_Object:{filterOnly:reference:c0-e1, jobAlertId:reference:c0-e2, returnToList:reference:c0-e3, browserTimeZone:reference:c0-e4}\n'
      + `batchId=${batchId}\n`;
  const response = await fetch(`${endpoint}.${method}.dwr`, {
    method: 'POST',
    body,
    headers: {
      accept: '*/*',
      'content-type': 'text/plain',
      cookie,
      origin: new URL(endpoint).origin,
      referer: `${new URL(endpoint).origin}${page}`,
      'user-agent': 'job-tracker/0.1 (personal job search aggregator)',
      viewid: '/ui/rcmcareer/pages/careersite/career.jsp.xhtml',
      'x-ajax-token': token,
      'x-csrf-token': token,
      'x-event-id': eventId,
      'x-sap-page-info': `companyId=${company}`,
      'x-subaction': '0',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
  const text = await response.text();
  if (/<!DOCTYPE html/i.test(text)) throw new Error(`unexpected HTML response from ${response.url}`);
  return text;
}

async function fetchLegacyBoard(
  board: SuccessFactorsBoard,
  parsed: ParsedSuccessFactorsUrl,
): Promise<RawJob[]> {
  const company = parsed.legacyCompany;
  if (!company) throw new Error(`missing legacy company for ${board.url}`);
  const sessionResponse = await fetch(parsed.searchUrl, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'job-tracker/0.1 (personal job search aggregator)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!sessionResponse.ok) throw new Error(`HTTP ${sessionResponse.status} for ${parsed.searchUrl}`);
  const sessionHtml = await sessionResponse.text();
  const token = /var ajaxSecKey="([^"]+)"/.exec(sessionHtml)?.[1];
  const eventId = sessionResponse.headers.get('x-event-id');
  if (!token || !eventId) throw new Error(`missing legacy session context for ${parsed.searchUrl}`);
  const cookies = new Map(sessionResponse.headers.getSetCookie().map((value) => {
    const pair = value.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const page = `${new URL(parsed.searchUrl).pathname}${new URL(parsed.searchUrl).search}`;
  const endpoint = `${parsed.origin}/xi/ajax/remoting/call/plaincall/careerJobSearchControllerProxy`;
  const scriptSessionId = dwrSessionId();
  const initial = await postLegacyDwr(
    endpoint, page, cookie, token, eventId, company, scriptSessionId,
    'getInitialJobSearchData', 0,
  );
  const totalCount = Number(/\.postingCount="?(\d+)"?;/.exec(initial)?.[1] ?? 0);
  const pageSize = 50;
  const responses = totalCount > 10 ? [] : [initial];
  for (let currentPage = 1; currentPage <= Math.min(MAX_LEGACY_PAGES, Math.ceil(totalCount / pageSize)); currentPage++) {
    responses.push(await postLegacyDwr(
      endpoint, page, cookie, token, eventId, company, scriptSessionId,
      'search', currentPage, { currentPage, pageSize, totalCount },
    ));
  }

  const postings = responses.flatMap(parseSuccessFactorsLegacyDwr);
  const candidates = [...new Map(postings.map((posting) => [posting.id, posting])).values()]
    .filter(({ title }) => /intern|co-?op|student|stage|stagiaire|étudiant/i.test(title));
  const jobs: RawJob[] = [];
  for (const posting of candidates) {
    const html = await fetchText(legacyDetailUrl(parsed, posting.id), {
      headers: { accept: 'text/html,application/xhtml+xml', cookie },
    });
    const job = mapSuccessFactorsLegacyDetail(html, posting, board);
    if (job) jobs.push(job);
  }
  return jobs;
}

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
  if (parsed.legacyCompany) return fetchLegacyBoard(board, parsed);
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
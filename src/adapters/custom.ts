/**
 * Custom job-board adapter for sites without a reusable ATS integration.
 *
 * This intentionally supports a small set of declarative strategies rather than a
 * universal scraper. Add a board configuration and parser for each stable public
 * listing format; failures remain isolated to that board.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson, fetchText } from '../lib/fetch.js';

type CustomBoard = CyberRecruiterBoard | GcJobsBoard | HtmlBoard | Jp2gBoard | MelitronBoard
  | WpJobManagerBoard | AmazonUniversityBoard | KinovaBoard | GlencoreBoard;

interface BoardBase {
  name: string;
  url: string;
}

export interface CyberRecruiterBoard extends BoardBase {
  kind: 'cyber-recruiter';
}

export interface MelitronBoard extends BoardBase {
  kind: 'melitron';
}

export interface Jp2gBoard extends BoardBase {
  kind: 'jp2g';
}

export interface GcJobsBoard extends BoardBase {
  kind: 'gc-jobs';
}

export interface WpJobManagerBoard extends BoardBase {
  kind: 'wp-job-manager';
}

export interface AmazonUniversityBoard extends BoardBase {
  kind: 'amazon-university';
  maxPages?: number;
}

export interface KinovaBoard extends BoardBase {
  kind: 'kinova';
}

export interface GlencoreBoard extends BoardBase {
  kind: 'glencore';
  locale: string;
}

export interface HtmlSelectors {
  card: string;
  titleLink: string;
  title?: string;
  location: string;
  postedDate?: string;
  description?: string;
  nextPage?: string;
}

export interface HtmlBoard extends BoardBase {
  kind: 'html';
  selectors: HtmlSelectors;
  maxPages?: number;
}

export const CUSTOM_BOARDS: CustomBoard[] = [
  {
    kind: 'glencore',
    name: 'Glencore',
    url: 'https://www.glencore.com/en/careers/jobs',
    locale: 'en',
  },
  {
    kind: 'kinova',
    name: 'Kinova Robotics',
    url: 'https://www.kinovarobotics.com/career',
  },
  {
    kind: 'wp-job-manager',
    name: 'Canadensys Aerospace',
    url: 'https://www.canadensys.com/jobs/',
  },
  {
    kind: 'amazon-university',
    name: 'Amazon',
    url: 'https://www.amazon.jobs/content/en/career-programs/university?keyword%5B%5D=intern&team%5B%5D=studentprograms.team-internships-for-students',
    maxPages: 20,
  },
  {
    kind: 'jp2g',
    name: 'JP2G Consultants Inc.',
    url: 'https://www.jp2g.com/careers/',
  },
  {
    kind: 'gc-jobs',
    name: 'Government of Canada',
    url: 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page2440?tab=1&title=student&locationsFilter=&departments=&officialLanguage=&referenceNumber=&selectionProcessNumber=&search=Search%20jobs&log=false',
  },
  {
    kind: 'melitron',
    name: 'Melitron',
    url: 'https://www.melitron.com/careers/',
  },
  {
    kind: 'cyber-recruiter',
    name: 'Brock Solutions',
    url: 'https://careers.brocksolutions.com/Careers.aspx?type=CAREERSMAIN',
  },
  {
    kind: 'html',
    name: 'General Dynamics Land Systems Canada',
    url: 'https://generaldynamics-ca-careers.ttcportals.com/search/jobs/in/country/canada',
    selectors: {
      card: '.jobs-section__item',
      titleLink: 'h2 a[href*="/jobs/"]',
      location: '.large-4.columns',
      postedDate: 'time[datetime]',
      nextPage: 'a[rel="next"]',
    },
    maxPages: 5,
  },
  {
    kind: 'html',
    name: 'Haply Robotics',
    url: 'https://haply.odoo.com/en_CA/jobs',
    selectors: {
      card: '#jobs_grid > .row > .col-lg > .card',
      titleLink: 'a[href*="/jobs/"]',
      title: 'h3',
      location: '[itemprop="address"]',
      description: '.card-body > .oe_empty.text-muted',
      nextPage: 'li.page-item:last-child:not(.disabled) a.page-link',
    },
    maxPages: 3,
  },
];

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function emptyFields(): Pick<RawJob,
  'salaryRaw' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'sponsorship'> {
  return {
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    sponsorship: null,
  };
}

export interface ParsedGlencoreUrl {
  origin: string;
  locale: string;
  endpoint: string;
}

export function parseGlencoreUrl(value: string): ParsedGlencoreUrl | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([a-z]{2})\/careers\/jobs\/?$/i);
    if (url.protocol !== 'https:' || url.hostname !== 'www.glencore.com' || !match?.[1]) return null;
    return {
      origin: url.origin,
      locale: match[1].toLowerCase(),
      endpoint: `${url.origin}/.rest/api/v2/careers/`,
    };
  } catch {
    return null;
  }
}

export interface GlencoreJob {
  id?: number;
  jobId?: string;
  title?: string;
  city?: string;
  region?: string;
  country?: string;
  description?: string;
  url?: string;
  applicationLink?: string;
  startDate?: number;
}

export interface GlencoreResponse {
  totalResults?: number;
  data?: GlencoreJob[];
}

function mapGlencoreType(title: string): JobType | null {
  if (/\bco[\s-]?op\b/i.test(title)) return 'co-op';
  if (/\bintern(?:ship)?\b|\bstudent\b|\bstagiaire\b/i.test(title)) return 'intern';
  return null;
}

/** Map Glencore's public Magnolia careers API response. */
export function parseGlencoreJobs(
  response: GlencoreResponse,
  board: GlencoreBoard,
): RawJob[] {
  return (response.data ?? []).flatMap((posting): RawJob[] => {
    const title = posting.title?.trim();
    const url = posting.applicationLink?.trim() || posting.url?.trim();
    if (!title || !url) return [];

    const location = [posting.city, posting.region, posting.country]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(', ');
    const description = posting.description
      ? load(posting.description).text().replace(/\s+/g, ' ').trim()
      : null;
    return [{
      title,
      company: board.name,
      location,
      remote: /\bremote\b|home.?based/i.test(`${title} ${location} ${description ?? ''}`),
      url,
      source: 'custom',
      postedAt: posting.startDate && Number.isFinite(posting.startDate)
        ? new Date(posting.startDate).toISOString()
        : null,
      ...emptyFields(),
      type: mapGlencoreType(title),
      description,
    }];
  });
}

async function fetchGlencore(board: GlencoreBoard): Promise<RawJob[]> {
  const parsed = parseGlencoreUrl(board.url);
  if (!parsed) throw new Error(`Unsupported Glencore careers URL: ${board.url}`);

  const pageSize = 100;
  const jobs: RawJob[] = [];
  for (let offset = 0; offset < 1_000; offset += pageSize) {
    const requestUrl = new URL(parsed.endpoint);
    requestUrl.searchParams.set('locale', board.locale);
    requestUrl.searchParams.set('sortBy', 'startDate-desc');
    requestUrl.searchParams.set('offset', String(offset));
    requestUrl.searchParams.set('limit', String(pageSize));
    requestUrl.searchParams.set('searchCriteria', JSON.stringify({ commodity: ['!KCC'] }));
    requestUrl.searchParams.set('keyword', '');
    const response = await fetchJson<GlencoreResponse>(requestUrl.toString());
    jobs.push(...parseGlencoreJobs(response, board));
    if ((response.data?.length ?? 0) < pageSize) break;
  }
  return jobs;
}

export interface KinovaJob {
  title?: string;
  url?: string;
  postDate?: string;
  job?: Array<{
    type?: string;
    location?: string;
  }>;
}

export interface KinovaResponse {
  data?: {
    jobs?: KinovaJob[];
  };
}

const KINOVA_JOBS_QUERY = `{
  jobs: entries(section: "job", orderBy: "postDate DESC") {
    title
    url
    postDate
    ... on job_Entry {
      job {
        ... on jobBlock_Entry {
          type: type_
          location
        }
      }
    }
  }
}`;

/** Map Kinova's public Craft CMS careers response. */
export function parseKinovaJobs(response: KinovaResponse, board: KinovaBoard): RawJob[] {
  return (response.data?.jobs ?? []).flatMap((posting): RawJob[] => {
    const title = posting.title?.trim();
    const url = posting.url?.trim();
    if (!title || !url) return [];

    const details = posting.job?.[0];
    const location = details?.location?.trim() ?? '';
    const employmentType = details?.type?.trim() ?? '';
    const type: JobType | null = /\bco[\s-]?op\b/i.test(`${title} ${employmentType}`) ? 'co-op'
      : /\bintern(ship)?\b|\bstudent\b/i.test(`${title} ${employmentType}`) ? 'intern'
        : /permanent|full[\s-]?time/i.test(employmentType) ? 'full-time' : null;
    return [{
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location} ${employmentType}`),
      url,
      source: 'custom',
      postedAt: isoDate(posting.postDate),
      ...emptyFields(),
      type,
      description: null,
    }];
  });
}

async function fetchKinova(board: KinovaBoard): Promise<RawJob[]> {
  const endpoint = new URL('/api', board.url).toString();
  const body = JSON.stringify({ query: KINOVA_JOBS_QUERY });
  const response = await fetchJson<KinovaResponse>(`${endpoint}?query=${encodeURIComponent(KINOVA_JOBS_QUERY)}`, {
    realUrl: endpoint,
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  return parseKinovaJobs(response, board);
}

const AMAZON_TEAM = 'studentprograms.team-internships-for-students';

export interface AmazonUniversityConfig {
  origin: string;
  keyword: string;
  labels: string[];
}

export function parseAmazonUniversityUrl(value: string): AmazonUniversityConfig | null {
  try {
    const url = new URL(value);
    const keyword = url.searchParams.get('keyword[]');
    const team = url.searchParams.get('team[]');
    if (!/(^|\.)amazon\.jobs$/i.test(url.hostname)
      || url.pathname !== '/content/en/career-programs/university'
      || keyword !== 'intern'
      || team !== AMAZON_TEAM) return null;
    return { origin: url.origin, keyword, labels: ['studentprograms', team] };
  } catch {
    return null;
  }
}

interface AmazonSearchHit {
  fields?: Record<string, string[] | undefined>;
}

export interface AmazonSearchResponse {
  found?: number;
  start?: number;
  searchHits?: AmazonSearchHit[];
}

function firstAmazonField(
  fields: Record<string, string[] | undefined>,
  name: string,
): string | undefined {
  return fields[name]?.[0];
}

function amazonTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Number(value) * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Map Amazon's nested search fields without depending on its presentation markup. */
export function mapAmazonSearchResponse(
  response: AmazonSearchResponse,
  board: AmazonUniversityBoard,
): RawJob[] {
  const origin = new URL(board.url).origin;
  return (response.searchHits ?? []).flatMap((hit) => {
    const fields = hit.fields ?? {};
    const title = firstAmazonField(fields, 'title');
    const id = firstAmazonField(fields, 'icimsJobId');
    if (!title || !id) return [];
    const location = firstAmazonField(fields, 'location')
      ?? firstAmazonField(fields, 'normalizedLocation')
      ?? '';
    const locations = fields.locations?.join(' ') ?? '';
    const descriptionHtml = [
      firstAmazonField(fields, 'description'),
      firstAmazonField(fields, 'basicQualifications'),
      firstAmazonField(fields, 'preferredQualifications'),
    ].filter(Boolean).join('<br>');
    const description = descriptionHtml
      ? load(`<div>${descriptionHtml}</div>`).text().replace(/\s+/g, ' ').trim()
      : null;
    return [{
      title,
      company: board.name,
      location,
      remote: /remote|home.?based|"type":"REMOTE"/i.test(`${title} ${location} ${locations}`),
      url: `${origin}/jobs/${encodeURIComponent(id)}`,
      source: 'custom',
      postedAt: amazonTimestamp(firstAmazonField(fields, 'updatedDate')
        ?? firstAmazonField(fields, 'createdDate')),
      ...emptyFields(),
      type: 'intern',
      description,
    }];
  });
}

function amazonSearchKey(html: string): string | null {
  const value = load(html)('script#jobs-cms-next-data, script#__NEXT_DATA__').first().text();
  if (!value) return null;
  try {
    const data = JSON.parse(value) as {
      props?: { searchKey?: unknown; pageProps?: { searchKey?: unknown } };
    };
    const searchKey = data.props?.searchKey ?? data.props?.pageProps?.searchKey;
    return typeof searchKey === 'string' ? searchKey : null;
  } catch {
    return null;
  }
}

function amazonSearchBody(config: AmazonUniversityConfig, start: number, size: number): string {
  return JSON.stringify({
    accessLevel: 'EXTERNAL',
    contentFilterFacets: [{
      name: 'primarySearchLabel',
      requestedFacetCount: 9999,
      values: config.labels.map((name) => ({ name })),
    }],
    excludeFacets: [
      { name: 'isConfidential', values: [{ name: '1' }] },
      { name: 'businessCategory', values: [{ name: 'a-confidential-job' }] },
    ],
    filterFacets: [],
    includeFacets: [],
    jobTypeFacets: [],
    locationFacets: [[
      { name: 'country', requestedFacetCount: 9999 },
      { name: 'normalizedStateName', requestedFacetCount: 9999 },
      { name: 'normalizedCityName', requestedFacetCount: 9999 },
    ]],
    query: config.keyword,
    size,
    start,
    treatment: 'OM',
    sort: { sortOrder: 'DESCENDING', sortType: 'SCORE' },
  });
}

async function fetchAmazonUniversity(board: AmazonUniversityBoard): Promise<RawJob[]> {
  const config = parseAmazonUniversityUrl(board.url);
  if (!config) throw new Error(`Unsupported Amazon University URL: ${board.url}`);
  const html = await fetchText(board.url, { headers: { accept: 'text/html' } });
  const apiKey = amazonSearchKey(html);
  if (!apiKey) throw new Error('Amazon University page did not expose its public search key');

  const endpoint = `${config.origin}/api/jobs/search?is_als=true`;
  const pageSize = 100;
  const jobs: RawJob[] = [];
  for (let page = 0; page < (board.maxPages ?? 20); page++) {
    const start = page * pageSize;
    const body = amazonSearchBody(config, start, pageSize);
    const response = await fetchJson<AmazonSearchResponse>(`${endpoint}&start=${start}`, {
      realUrl: endpoint,
      method: 'POST',
      body,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        referer: board.url,
        'x-api-key': apiKey,
      },
    });
    const pageJobs = mapAmazonSearchResponse(response, board);
    jobs.push(...pageJobs);
    if ((response.searchHits?.length ?? 0) === 0 || jobs.length >= (response.found ?? 0)) break;
  }
  return jobs;
}

/** Parse a conventional card-based HTML board using only configured selectors. */
export function parseConfiguredHtml(html: string, board: HtmlBoard, pageUrl = board.url): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $(board.selectors.card).each((_, element) => {
    const card = $(element);
    const anchor = card.find(board.selectors.titleLink).first();
    const titleElement = board.selectors.title ? anchor.find(board.selectors.title).first() : anchor;
    const title = titleElement.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;
    const location = card.find(board.selectors.location).first().text()
      .replace(/\s+/g, ' ')
      .replace(/^Location:\s*/i, '')
      .trim();
    const dateElement = board.selectors.postedDate
      ? card.find(board.selectors.postedDate).first()
      : null;
    const dateValue = dateElement?.attr('datetime') ?? dateElement?.text().trim();
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: isoDate(dateValue),
      ...emptyFields(),
      type: null,
      description: board.selectors.description
        ? card.find(board.selectors.description).first().text().replace(/\s+/g, ' ').trim() || null
        : null,
    });
  });
  return jobs;
}

/** Parse the stable listing fragment returned by WP Job Manager's public AJAX route. */
export function parseWpJobManagerJobs(
  html: string,
  board: WpJobManagerBoard,
  pageUrl = board.url,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('li.job_listing').each((_, element) => {
    const card = $(element);
    const anchor = card.children('a[href]').first();
    const title = card.find('.position h3').first().text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    const location = card.find('.location').first().text().replace(/\s+/g, ' ').trim();
    const jobType = card.find('.job-type').first().text().replace(/\s+/g, ' ').trim();
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: isoDate(card.find('time[datetime]').first().attr('datetime')),
      ...emptyFields(),
      type: /\bintern(ship)?\b/i.test(jobType) ? 'intern'
        : /\bco[\s-]?op\b/i.test(jobType) ? 'co-op' : null,
      description: null,
    });
  });
  return jobs;
}

/** Parse Melitron's custom WordPress `our-job` rows. */
export function parseMelitronJobs(
  html: string,
  board: MelitronBoard,
  pageUrl = board.url,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('a.jobID[href*="/our-job/"]').each((_, element) => {
    const anchor = $(element);
    const title = anchor.find('strong').first().text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    const rowText = anchor.closest('p').text().replace(/\s+/g, ' ').trim();
    const location = rowText.match(/Location:\s*(.+?)\s+Schedule:/i)?.[1]?.trim() ?? '';
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: null,
      ...emptyFields(),
      type: null,
      description: null,
    });
  });
  return jobs;
}

/** Parse JP2G's office-scoped static job links. */
export function parseJp2gJobs(
  html: string,
  board: Jp2gBoard,
  pageUrl = board.url,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('a[href*="/careers/"][href$=".html"]').each((_, element) => {
    const anchor = $(element);
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    const url = new URL(href, pageUrl);
    const office = url.pathname.match(/^\/careers\/([^/]+)-office\/[^/]+\.html$/i)?.[1];
    if (!office) return;
    const city = office.split('-').map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ');
    jobs.push({
      title,
      company: board.name,
      location: `${city}, Ontario, Canada`,
      remote: /remote|home.?based/i.test(title),
      url: url.toString(),
      source: 'custom',
      postedAt: null,
      ...emptyFields(),
      type: /\bintern(ship)?\b/i.test(title) ? 'intern' : /\bco[\s-]?op\b/i.test(title) ? 'co-op' : null,
      description: null,
    });
  });
  return jobs;
}

function gcJobsLines($: ReturnType<typeof load>, element: Parameters<ReturnType<typeof load>>[0]): string[] {
  const copy = $(element).clone();
  copy.find('br').replaceWith('\n');
  return copy.text().split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function gcJobsType(title: string, program: string): JobType | null {
  const value = `${title} ${program}`;
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bstudent\b|\bintern(ship)?\b|research affiliate|student work experience/i.test(value)) {
    return 'intern';
  }
  return null;
}

function gcJobsSalary(value: string | undefined): Pick<RawJob,
  'salaryRaw' | 'salaryMin' | 'salaryMax' | 'salaryCurrency'> {
  const salaryRaw = value?.match(/\$[\d,.]+(?:\s+(?:to|-)\s+\$[\d,.]+)?.*/i)?.[0] ?? null;
  const amounts = salaryRaw?.match(/\$([\d,.]+)(?:\s+(?:to|-)\s+\$([\d,.]+))?/i);
  const parseAmount = (amount: string | undefined): number | null => {
    if (!amount) return null;
    const parsed = Number(amount.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    salaryRaw,
    salaryMin: parseAmount(amounts?.[1]),
    salaryMax: parseAmount(amounts?.[2]),
    salaryCurrency: salaryRaw ? 'CAD' : null,
  };
}

/** Parse the PSC-owned GC Jobs search-result fragment. */
export function parseGcJobs(
  html: string,
  board: GcJobsBoard,
  pageUrl = board.url,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('li.searchResult').each((_, element) => {
    const result = $(element);
    const anchor = result.find('a[href]').filter((_, link) => {
      const href = $(link).attr('href') ?? '';
      return href.includes('page1800?poster=') || href.includes('/srs-sre/page01.html?poster=');
    }).first();
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    const program = result.children('div').children('strong').eq(1).text().replace(/\s+/g, ' ').trim();
    const cells = result.find('.tableCell');
    const details = gcJobsLines($, cells.eq(0));
    const closingIndex = details.findIndex((line) => /^Closing date:/i.test(line));
    const companyIndex = closingIndex >= 0 ? closingIndex + 1 : 0;
    const company = details[companyIndex] ?? board.name;
    const locationParts = details.slice(companyIndex + 1).filter((line) => !line.startsWith('-'));
    let location = locationParts.join(' ').trim();
    if (location && !/\bcanada\b|international|france/i.test(location)) location += ', Canada';
    const secondary = gcJobsLines($, cells.eq(1));

    jobs.push({
      title,
      company,
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: null,
      ...gcJobsSalary(secondary.find((line) => line.includes('$'))),
      type: gcJobsType(title, program),
      sponsorship: null,
      description: program || null,
    });
  });
  return jobs;
}

const CANADIAN_GROUP = /[?&]groupvalue=(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)-/i;

/** Find Canadian location pages from a Cyber Recruiter location index. */
export function discoverCyberRecruiterPages(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const pages = $('a.JobLink[href*="groupvalue="]').toArray()
    .map((anchor) => $(anchor).attr('href'))
    .filter((href): href is string => typeof href === 'string' && CANADIAN_GROUP.test(href))
    .map((href) => new URL(href, baseUrl).toString());
  return [...new Set(pages)];
}

/** Parse Cyber Recruiter's row-oriented result layout, which has no job-card wrapper. */
export function parseCyberRecruiterJobs(
  html: string,
  board: CyberRecruiterBoard,
  pageUrl: string,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('a.JobLink[href*="type=JOBDESCR"]').each((_, element) => {
    const anchor = $(element);
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    let row = anchor.closest('tr').next();
    let location = '';
    let description: string | null = null;
    while (row.length && row.find('a.JobLink[href*="type=JOBDESCR"]').length === 0) {
      const cells = row.find('td');
      const label = cells.first().text().replace(/\s+/g, ' ').trim();
      if (/^location:/i.test(label) && !location) {
        location = cells.eq(1).text().replace(/\s+/g, ' ').trim();
      } else if (cells.length === 1 && !row.find('hr').length) {
        const text = cells.text().replace(/\s+/g, ' ').trim();
        if (text.length > 30) description = text;
      }
      row = row.next();
    }
    if (location && !/\bcanada\b/i.test(location)) location += ', Canada';
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: null,
      ...emptyFields(),
      type: null,
      description,
    });
  });
  return jobs;
}

async function fetchCyberRecruiter(board: CyberRecruiterBoard): Promise<RawJob[]> {
  const index = await fetchText(board.url, { headers: { accept: 'text/html' } });
  const pages = discoverCyberRecruiterPages(index, board.url);
  const jobs: RawJob[] = [];
  for (const page of pages) {
    jobs.push(...parseCyberRecruiterJobs(
      await fetchText(page, { headers: { accept: 'text/html' } }),
      board,
      page,
    ));
  }
  return jobs;
}

async function fetchHtml(board: HtmlBoard): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let pageUrl: string | null = board.url;
  const visited = new Set<string>();
  for (let page = 0; page < (board.maxPages ?? 3) && pageUrl; page++) {
    if (visited.has(pageUrl)) break;
    visited.add(pageUrl);
    const html = await fetchText(pageUrl, { headers: { accept: 'text/html' } });
    jobs.push(...parseConfiguredHtml(html, board, pageUrl));
    const $ = load(html);
    const next = board.selectors.nextPage
      ? $(board.selectors.nextPage).first().attr('href')
      : null;
    pageUrl = next ? new URL(next, pageUrl).toString() : null;
  }
  return jobs;
}

interface WpJobManagerResponse {
  found_jobs: boolean;
  max_num_pages: number;
  html: string;
}

async function fetchWpJobManager(board: WpJobManagerBoard): Promise<RawJob[]> {
  const endpoint = new URL('/jm-ajax/get_listings/', board.url).toString();
  const jobs: RawJob[] = [];
  let maxPages = 1;
  for (let page = 1; page <= Math.min(maxPages, 10); page++) {
    const body = new URLSearchParams({
      lang: '',
      search_keywords: '',
      search_location: '',
      per_page: '10',
      orderby: 'featured',
      order: 'DESC',
      page: String(page),
      show_pagination: 'false',
    }).toString();
    const response = JSON.parse(await fetchText(`${endpoint}?page=${page}`, {
      realUrl: endpoint,
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        referer: board.url,
        'x-requested-with': 'XMLHttpRequest',
      },
    })) as WpJobManagerResponse;
    if (!response.found_jobs) break;
    jobs.push(...parseWpJobManagerJobs(response.html, board));
    maxPages = Number.isFinite(response.max_num_pages) ? response.max_num_pages : 1;
  }
  return jobs;
}

async function fetchGcJobs(board: GcJobsBoard): Promise<RawJob[]> {
  const initial = await fetch(board.url, {
    headers: { accept: 'text/html', 'user-agent': 'job-tracker/0.1 (personal job search aggregator)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!initial.ok) throw new Error(`HTTP ${initial.status} for ${board.url}`);
  await initial.arrayBuffer();
  const sessionCookie = initial.headers.getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .find((cookie) => cookie?.startsWith('JSESSIONID='));
  if (!sessionCookie) throw new Error('GC Jobs did not provide a public session cookie');

  const fragmentUrl = new URL(board.url);
  fragmentUrl.searchParams.set('isSecondPartOfPage', '1');
  fragmentUrl.searchParams.set('isInitialNetworkCheck', '1');
  const html = await fetchText(`${fragmentUrl}#initialized`, {
    realUrl: fragmentUrl.toString(),
    headers: {
      accept: 'text/html',
      cookie: sessionCookie,
      referer: board.url,
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  return parseGcJobs(html, board, board.url);
}

async function fetchBoard(board: CustomBoard): Promise<RawJob[]> {
  if (board.kind === 'amazon-university') return fetchAmazonUniversity(board);
  if (board.kind === 'glencore') return fetchGlencore(board);
  if (board.kind === 'kinova') return fetchKinova(board);
  if (board.kind === 'cyber-recruiter') return fetchCyberRecruiter(board);
  if (board.kind === 'gc-jobs') return fetchGcJobs(board);
  if (board.kind === 'wp-job-manager') return fetchWpJobManager(board);
  if (board.kind === 'jp2g') {
    const html = await fetchText(board.url, { headers: { accept: 'text/html' } });
    return parseJp2gJobs(html, board);
  }
  if (board.kind === 'melitron') {
    const html = await fetchText(board.url, { headers: { accept: 'text/html' } });
    return parseMelitronJobs(html, board);
  }
  return fetchHtml(board);
}

/** Fetch configured boards concurrently; one unusual or blocked site cannot stop others. */
async function fetchBoards(boards: CustomBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function customAdapter(boards: CustomBoard[] = CUSTOM_BOARDS): Adapter {
  return { name: 'custom', fetch: () => fetchBoards(boards) };
}
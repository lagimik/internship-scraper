/** Oracle Taleo Career Section adapter using the page's public JSON search endpoint. */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';
import { load } from 'cheerio';

export interface TaleoBoard {
  /** A verified Taleo job detail or search URL. */
  url: string;
  name: string;
  /** Portal ID observed in the career section's public search request. */
  portal: string;
}

export const TALEO_BOARDS: TaleoBoard[] = [
  {
    url: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en&src=SNS-10025',
    name: 'HDR',
    portal: '101430233',
  },
];

export interface ParsedTaleoUrl {
  origin: string;
  section: string;
  language: string;
  jobId: string | null;
  searchUrl: string;
}

interface TaleoRequisition {
  contestNo?: string;
  column?: string[];
  linkedColumn?: number;
  locationsColumns?: number[];
}

interface TaleoSearchResponse {
  requisitionList?: TaleoRequisition[];
  pagingData?: {
    pageSize?: number;
    totalCount?: number;
  };
}

export interface TaleoDetail {
  location: string;
  postedAt: string | null;
  salaryRaw: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Parse the tenant, career section and locale from a Taleo Career Section URL. */
export function parseTaleoUrl(url: string): ParsedTaleoUrl | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.taleo.net')) return null;
    const match = /^\/careersection\/([^/]+)\/(?:jobdetail|jobsearch)\.ftl$/i.exec(parsed.pathname);
    if (!match?.[1]) return null;

    const language = parsed.searchParams.get('lang') || 'en';
    return {
      origin: parsed.origin,
      section: match[1],
      language,
      jobId: parsed.searchParams.get('job'),
      searchUrl: `${parsed.origin}/careersection/rest/jobboard/searchjobs?lang=${encodeURIComponent(language)}`,
    };
  } catch {
    return null;
  }
}

function parseLocation(value: string | undefined): string {
  if (!value) return '';
  try {
    const locations = JSON.parse(value) as unknown;
    if (Array.isArray(locations)) {
      return locations.filter((item): item is string => typeof item === 'string')
        .map(cleanText).filter(Boolean).join('; ');
    }
  } catch {
    // Some Taleo tenants return plain text instead of a JSON-encoded location list.
  }
  return cleanText(value);
}

function parsePostedDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})$/i.exec(cleanText(value));
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(match[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferType(title: string): JobType | null {
  if (/\bco[ -]?op\b/i.test(title)) return 'co-op';
  if (/\b(?:intern|internship|stagiaire)\b/i.test(title)) return 'intern';
  return null;
}

/** Parse Taleo's public, keyword-filtered RSS feed. */
export function parseTaleoRss(
  xml: string,
  board: TaleoBoard,
  parsed: ParsedTaleoUrl,
): RawJob[] {
  const $ = load(xml, { xmlMode: true });
  const jobs: RawJob[] = [];
  $('item').each((_, item) => {
    const title = cleanText($(item).find('title').first().text());
    const href = cleanText($(item).find('link').first().text());
    if (!title || !href) return;

    let jobId: string | null = null;
    try {
      jobId = new URL(href).searchParams.get('job');
    } catch {
      return;
    }
    if (!jobId) return;

    const published = cleanText($(item).find('pubDate').first().text());
    const timestamp = Date.parse(published);
    const description = cleanText($(item).find('description').first().text());
    jobs.push({
      title,
      company: board.name,
      location: '',
      remote: /remote|work from home/i.test(title),
      url: `${parsed.origin}/careersection/${parsed.section}/jobdetail.ftl?job=${encodeURIComponent(jobId)}&lang=${encodeURIComponent(parsed.language)}`,
      source: 'taleo',
      postedAt: Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: inferType(title),
      sponsorship: null,
      description: description || null,
    });
  });
  return jobs;
}

/** Parse stable labeled fields from a public Taleo detail page. */
export function parseTaleoDetailHtml(html: string): TaleoDetail {
  const $ = load(html);
  const fields = new Map<string, string>();
  $('.contentlinepanel').each((_, row) => {
    const label = cleanText($(row).find('.subtitle').first().text()).toLowerCase();
    const value = cleanText($(row).find('.text').first().text());
    if (label && value) fields.set(label, value);
  });

  // Taleo's raw response leaves field spans empty and hydrates them in the browser
  // from this standard requisition-state sequence. Each displayed value is repeated.
  const state = html.split('!|!');
  const requisitionIndex = state.indexOf('descRequisition');
  const serializedLocation = requisitionIndex >= 0 ? state[requisitionIndex + 16] : undefined;
  const serializedDate = requisitionIndex >= 0 ? state[requisitionIndex + 36] : undefined;
  const location = fields.get('primary location') ?? cleanText(serializedLocation ?? '');
  const postedAt = parsePostedDate(fields.get('job posting') ?? serializedDate);
  const encodedDescription = requisitionIndex >= 0
    ? state.slice(requisitionIndex + 12, requisitionIndex + 16).join(' ')
    : '';
  let decodedDescription = encodedDescription;
  try {
    decodedDescription = decodeURIComponent(encodedDescription.replace(/!\*!/g, ''));
  } catch {
    // Keep the raw text when a tenant includes a malformed percent escape.
  }
  const pageText = cleanText(`${$.root().text()} ${load(decodedDescription).root().text()}`);
  const salaryMatch = /hourly pay range[^:]*:\s*\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)/i.exec(pageText);
  const salaryMin = salaryMatch?.[1] ? Number(salaryMatch[1].replace(/,/g, '')) : null;
  const salaryMax = salaryMatch?.[2] ? Number(salaryMatch[2].replace(/,/g, '')) : null;
  return {
    location,
    postedAt,
    salaryRaw: salaryMatch ? `$${salaryMatch[1]} - $${salaryMatch[2]} per hour` : null,
    salaryMin: Number.isFinite(salaryMin) ? salaryMin : null,
    salaryMax: Number.isFinite(salaryMax) ? salaryMax : null,
    salaryCurrency: salaryMatch && /\bcanada\b/i.test(location) ? 'CAD' : null,
  };
}

/** Map one public Taleo search response to the shared job shape. */
export function parseTaleoSearchResponse(
  response: TaleoSearchResponse,
  board: TaleoBoard,
  parsed: ParsedTaleoUrl,
): RawJob[] {
  const jobs: RawJob[] = [];
  for (const requisition of response.requisitionList ?? []) {
    const columns = requisition.column ?? [];
    const titleIndex = requisition.linkedColumn ?? 0;
    const locationIndex = requisition.locationsColumns?.[0] ?? 1;
    const title = cleanText(columns[titleIndex] ?? '');
    const contestNo = cleanText(requisition.contestNo ?? '');
    if (!title || !contestNo) continue;

    const location = parseLocation(columns[locationIndex]);
    const dateIndex = columns.findIndex((value, index) => index !== titleIndex
      && index !== locationIndex && parsePostedDate(value) !== null);
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|work from home/i.test(`${title} ${location}`),
      url: `${parsed.origin}/careersection/${parsed.section}/jobdetail.ftl?job=${encodeURIComponent(contestNo)}&lang=${encodeURIComponent(parsed.language)}`,
      source: 'taleo',
      postedAt: dateIndex >= 0 ? parsePostedDate(columns[dateIndex]) : null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: inferType(title),
      sponsorship: null,
      description: null,
    });
  }
  return jobs;
}

const SEARCH_TERMS = ['intern', 'co-op', 'student', 'stagiaire'];
const MAX_DETAIL_LOOKUPS = 40;

async function fetchBoard(board: TaleoBoard): Promise<RawJob[]> {
  const parsed = parseTaleoUrl(board.url);
  if (!parsed || !/^\d+$/.test(board.portal)) throw new Error(`unparseable Taleo board: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    const feedUrl = new URL(`${parsed.origin}/careersection/feed/joblist.rss`);
    feedUrl.searchParams.set('lang', parsed.language);
    feedUrl.searchParams.set('portal', board.portal);
    feedUrl.searchParams.set('searchtype', '3');
    feedUrl.searchParams.set('f', 'null');
    feedUrl.searchParams.set('KEYWORD', term);
    feedUrl.searchParams.set('s', '1|D');
    feedUrl.searchParams.set('a', 'null');
    feedUrl.searchParams.set('multiline', 'false');
    const feedJobs = parseTaleoRss(await fetchText(feedUrl.href), board, parsed);
    for (const job of feedJobs) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
  }

  let cursor = 0;
  async function enrichWorker(): Promise<void> {
    while (cursor < Math.min(jobs.length, MAX_DETAIL_LOOKUPS)) {
      const job = jobs[cursor++];
      if (!job) return;
      const detail = parseTaleoDetailHtml(await fetchText(job.url));
      job.location = detail.location;
      job.remote = job.remote || /remote|work from home/i.test(detail.location);
      job.postedAt = detail.postedAt ?? job.postedAt;
      job.salaryRaw = detail.salaryRaw;
      job.salaryMin = detail.salaryMin;
      job.salaryMax = detail.salaryMax;
      job.salaryCurrency = detail.salaryCurrency;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, enrichWorker));
  return jobs;
}

async function fetchBoards(boards: TaleoBoard[], concurrency = 3): Promise<RawJob[]> {
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

export function taleoAdapter(boards: TaleoBoard[] = TALEO_BOARDS): Adapter {
  return { name: 'taleo', fetch: () => fetchBoards(boards) };
}
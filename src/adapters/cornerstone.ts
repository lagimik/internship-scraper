/**
 * Cornerstone (CSOD) adapter.
 *
 * Public career pages embed an anonymous API token and regional API origin in
 * `csod.context`. Their SPA uses those values to call the structured job search API.
 */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface CornerstoneBoard {
  /** A real CSOD career-site or requisition URL. */
  url: string;
  name: string;
  /** Value observed in the career site's public search request. */
  careerSitePageId?: number;
}

/** Verified public Cornerstone career sites. */
export const CORNERSTONE_BOARDS: CornerstoneBoard[] = [
  {
    url: 'https://trench.csod.com/ux/ats/careersite/1/home/requisition/1558?c=trench&source=LinkedIn',
    name: 'Trench Group',
  },
  {
    url: 'https://bba.csod.com/ux/ats/careersite/5/home?c=bba&lang=en-US',
    name: 'BBA',
    careerSitePageId: 5,
  },
];

export interface ParsedCornerstoneUrl {
  origin: string;
  tenant: string;
  careerSiteId: number;
}

interface CornerstoneContext {
  token: string;
  cultureId: number;
  cultureName: string;
  cloud: string;
}

interface CornerstoneLocation {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface CornerstoneRequisition {
  requisitionId?: number;
  postingEffectiveDate?: string | null;
  displayJobTitle?: string | null;
  locations?: CornerstoneLocation[];
  externalDescription?: string | null;
}

interface CornerstoneSearchResponse {
  data?: {
    totalCount?: number;
    requisitions?: CornerstoneRequisition[];
  };
}

/** Parse the tenant and career-site ID from public CSOD URLs. */
export function parseCornerstoneUrl(url: string): ParsedCornerstoneUrl | null {
  try {
    const parsed = new URL(url);
    const hostMatch = parsed.hostname.match(/^([a-z0-9-]+)\.csod\.com$/i);
    const pathMatch = parsed.pathname.match(/^\/ux\/ats\/careersite\/(\d+)\/home(?:\/|$)/i);
    if (!hostMatch?.[1] || !pathMatch?.[1]) return null;
    const tenant = parsed.searchParams.get('c') ?? hostMatch[1];
    if (tenant.toLowerCase() !== hostMatch[1].toLowerCase()) return null;
    return {
      origin: parsed.origin,
      tenant,
      careerSiteId: Number(pathMatch[1]),
    };
  } catch {
    return null;
  }
}

function extractJsonObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

function parseContext(html: string): CornerstoneContext {
  const marker = html.search(/csod\.context\s*=\s*\{/i);
  const objectStart = marker < 0 ? -1 : html.indexOf('{', marker);
  const json = objectStart < 0 ? null : extractJsonObject(html, objectStart);
  if (!json) throw new Error('Cornerstone page did not expose csod.context');

  const value = JSON.parse(json) as {
    token?: string;
    cultureID?: number;
    cultureName?: string;
    endpoints?: { cloud?: string };
  };
  const cloud = value.endpoints?.cloud;
  if (!value.token || !value.cultureID || !value.cultureName || !cloud) {
    throw new Error('Cornerstone csod.context is missing API configuration');
  }
  const cloudUrl = new URL(cloud);
  if (!cloudUrl.hostname.endsWith('.api.csod.com')) {
    throw new Error(`unexpected Cornerstone API host: ${cloudUrl.hostname}`);
  }
  return {
    token: value.token,
    cultureId: value.cultureID,
    cultureName: value.cultureName,
    cloud: cloudUrl.origin,
  };
}

function parsePostedDate(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapType(title: string): JobType | null {
  if (/co[ -]?op/i.test(title)) return 'co-op';
  if (/intern|student/i.test(title)) return 'intern';
  return null;
}

function locationText(locations: CornerstoneLocation[] | undefined): string {
  return [...new Set((locations ?? []).map((location) => {
    const country = location.country === 'CA'
      ? 'Canada'
      : location.country === 'US' ? 'United States' : location.country;
    return [location.city, location.state, country].filter(Boolean).join(', ');
  }).filter(Boolean))].join('; ');
}

/** Map one search result to the common adapter shape. */
export function parseCornerstoneRequisition(
  requisition: CornerstoneRequisition,
  board: CornerstoneBoard,
  parsed: ParsedCornerstoneUrl,
): RawJob | null {
  const id = requisition.requisitionId;
  const title = requisition.displayJobTitle?.trim();
  if (!id || !title) return null;
  const location = locationText(requisition.locations);
  return {
    title,
    company: board.name,
    location,
    remote: /remote/i.test(`${title} ${location}`),
    url: `${parsed.origin}/ux/ats/careersite/${parsed.careerSiteId}/home/requisition/${id}?c=${encodeURIComponent(parsed.tenant)}`,
    source: 'cornerstone',
    postedAt: parsePostedDate(requisition.postingEffectiveDate),
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: mapType(title),
    sponsorship: null,
    description: requisition.externalDescription?.replace(/\s+/g, ' ').trim() || null,
  };
}

const PAGE_SIZE = 25;
const MAX_PAGES = 20;

async function fetchCornerstoneBoard(board: CornerstoneBoard): Promise<RawJob[]> {
  const parsed = parseCornerstoneUrl(board.url);
  if (!parsed) throw new Error(`unparseable Cornerstone URL: ${board.url}`);
  const html = await fetchText(board.url);
  const context = parseContext(html);
  const endpoint = `${context.cloud}/rec-job-search/external/jobs`;
  const jobs: RawJob[] = [];

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const body = JSON.stringify({
      careerSiteId: parsed.careerSiteId,
      careerSitePageId: board.careerSitePageId ?? 1,
      pageNumber,
      pageSize: PAGE_SIZE,
      cultureId: context.cultureId,
      searchText: '',
      cultureName: context.cultureName,
      states: [],
      countryCodes: [],
      cities: [],
      placeID: '',
      radius: null,
      postingsWithinDays: null,
      customFieldCheckboxKeys: [],
      customFieldDropdowns: [],
      customFieldRadios: [],
    });
    const text = await fetchText(`${endpoint}#${parsed.tenant}@${pageNumber}`, {
      realUrl: endpoint,
      method: 'POST',
      body,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${context.token}`,
        'content-type': 'application/json',
        'csod-accept-language': context.cultureName,
        origin: parsed.origin,
        referer: board.url,
      },
    });
    const data = JSON.parse(text) as CornerstoneSearchResponse;
    const requisitions = data.data?.requisitions ?? [];
    for (const requisition of requisitions) {
      const job = parseCornerstoneRequisition(requisition, board, parsed);
      if (job) jobs.push(job);
    }
    const total = data.data?.totalCount;
    if (requisitions.length < PAGE_SIZE || jobs.length >= (total ?? Infinity)) break;
  }
  return jobs;
}

/** Fetch boards concurrently while isolating a failed tenant. */
async function fetchBoards(boards: CornerstoneBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchCornerstoneBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function cornerstoneAdapter(
  boards: CornerstoneBoard[] = CORNERSTONE_BOARDS,
): Adapter {
  return {
    name: 'cornerstone',
    fetch: () => fetchBoards(boards),
  };
}
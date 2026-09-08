/**
 * Oracle Recruiting Cloud adapter.
 *
 * Oracle Candidate Experience sites expose the same public REST resource used by
 * their browser UI. A careers URL supplies the origin and site number; no tenant
 * credentials or HTML parsing are required.
 */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface OracleBoard {
  /** A Candidate Experience URL ending in `/sites/<site number>`. */
  url: string;
  name: string;
}

/** Oracle boards verified against the public recruitingCEJobRequisitions API. */
export const ORACLE_BOARDS: OracleBoard[] = [
  {
    url: 'https://hcpd.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Careers',
    name: 'J.D. Irving',
  },
  {
    url: 'https://fa-epmd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_3001',
    name: 'Linamar',
  },
  {
    url: 'https://ejia.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001',
    name: 'S&C Electric',
  },
  {
    url: 'https://emit.fa.ca3.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001',
    name: 'WSP',
  },
  {
    url: 'https://ebct.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_3002',
    name: 'Samuel & Son',
  },
  {
    url: 'https://emfg.fa.em4.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_4001',
    name: 'Arcelor Mittal',
  },
  {
    url: 'https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace',
    name: 'Honeywell Aerospace',
  },
  {
    url: 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=AttributeChar4&mode=location&selectedFlexFieldsFacets=%22AttributeChar4%7CGraduates%3BTrainees%22',
    name: 'Wood',
  },
];

export interface ParsedOracleUrl {
  origin: string;
  language: string;
  site: string;
  lastSelectedFacet?: string;
  selectedFlexFieldsFacets?: string;
}

/** Decompose a Candidate Experience URL, including deep `/jobs` and `/job/<id>` URLs. */
export function parseOracleUrl(url: string): ParsedOracleUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.oraclecloud.com')) return null;

    const match = parsed.pathname.match(
      /^\/hcmUI\/CandidateExperience\/([^/]+)\/sites\/([^/]+)(?:\/|$)/i,
    );
    if (!match?.[1] || !match[2]) return null;
    const lastSelectedFacet = parsed.searchParams.get('lastSelectedFacet');
    const selectedFlexFieldsFacets = parsed.searchParams.get('selectedFlexFieldsFacets')
      ?.replace(/^"|"$/g, '');
    return {
      origin: parsed.origin,
      language: match[1],
      site: match[2],
      ...(lastSelectedFacet ? { lastSelectedFacet } : {}),
      ...(selectedFlexFieldsFacets ? { selectedFlexFieldsFacets } : {}),
    };
  } catch {
    return null;
  }
}

interface OracleLocation {
  Name?: string;
  LocationName?: string;
  PrimaryLocation?: string;
  TownOrCity?: string;
  Region2?: string;
  Region3?: string;
  Country?: string;
}

export interface OracleRequisition {
  Id?: string | number;
  id?: string | number;
  Title?: string;
  title?: string;
  PostedDate?: string;
  postedDate?: string;
  PostingEndDate?: string | null;
  postingEndDate?: string | null;
  PrimaryLocation?: string;
  primaryLocation?: string;
  WorkplaceType?: string;
  workplaceType?: string;
  WorkplaceTypeCode?: string;
  workplaceTypeCode?: string;
  WorkerType?: string;
  workerType?: string;
  ContractType?: string;
  contractType?: string;
  JobType?: string;
  jobType?: string;
  ShortDescriptionStr?: string;
  shortDescriptionStr?: string;
  workLocation?: OracleLocation[];
  secondaryLocations?: OracleLocation[];
  otherWorkLocations?: OracleLocation[];
}

interface OracleSearch {
  TotalJobsCount?: number;
  totalJobsCount?: number;
  Offset?: number;
  offset?: number;
  Limit?: number;
  limit?: number;
  requisitionList?: OracleRequisition[];
}

interface OracleResponse {
  items?: OracleSearch[];
}

/** Convert Oracle's date-only posting value to an unambiguous ISO timestamp. */
export function parseOraclePostedDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function locationName(location: OracleLocation): string | null {
  const direct = location.Name ?? location.LocationName ?? location.PrimaryLocation;
  if (direct) return direct;
  const parts = [location.TownOrCity, location.Region2 ?? location.Region3, location.Country]
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ') : null;
}

/** Preserve every advertised location; a secondary Canadian office may be decisive. */
export function collectOracleLocations(job: OracleRequisition): string {
  const locations = [
    job.PrimaryLocation,
    ...(job.workLocation ?? []).map(locationName),
    ...(job.secondaryLocations ?? []).map(locationName),
    ...(job.otherWorkLocations ?? []).map(locationName),
  ].filter((location): location is string => Boolean(location));
  return [...new Set(locations)].join('; ');
}

function mapOracleType(job: OracleRequisition): JobType | null {
  const value = [
    job.WorkerType ?? job.workerType,
    job.ContractType ?? job.contractType,
    job.JobType ?? job.jobType,
    job.Title ?? job.title,
  ].filter(Boolean).join(' ');
  if (/co.?op/i.test(value)) return 'co-op';
  if (/intern|student|trainee|stagiaire/i.test(value)) return 'intern';
  if (/contract|temporary|fixed.?term/i.test(value)) return 'contract';
  if (/full.?time|regular/i.test(value)) return 'full-time';
  return null;
}

const SEARCH_TERMS = (process.env.JT_ORACLE_TERMS ?? 'intern,co-op,student,stagiaire')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const PAGE_SIZE = 25;
const MAX_PAGES = 5;

async function searchJobs(
  parsed: ParsedOracleUrl,
  keyword: string,
  offset: number,
): Promise<OracleSearch> {
  const endpoint = new URL(
    '/hcmRestApi/resources/latest/recruitingCEJobRequisitions',
    parsed.origin,
  );
  endpoint.searchParams.set('onlyData', 'true');
  endpoint.searchParams.set(
    'expand',
    'requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations',
  );
  endpoint.searchParams.set(
    'finder',
    `findReqs;siteNumber=${parsed.site},keyword=${keyword},limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`,
  );

  const response = await fetchJson<OracleResponse>(endpoint.toString());
  return response.items?.[0] ?? {};
}

async function searchFacetedJobs(
  parsed: ParsedOracleUrl,
  offset: number,
): Promise<OracleSearch> {
  const endpoint = new URL(
    '/hcmRestApi/CandidateExperience/recruitingCEJobSearch/list',
    parsed.origin,
  ).toString();
  const body = JSON.stringify({
    input: '',
    expand: 'requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations,flexFieldsFacet.values,requisitionList.requisitionFlexFields',
    siteNumber: parsed.site,
    limit: PAGE_SIZE,
    lastSelectedFacet: parsed.lastSelectedFacet,
    selectedFlexFieldsFacets: parsed.selectedFlexFieldsFacets,
    sortBy: 'POSTING_DATES_DESC',
    offset,
    facets: 'WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS;RETAIL_LOCATION',
  });
  const response = await fetchJson<OracleResponse>(`${endpoint}#${body}`, {
    realUrl: endpoint,
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/vnd.oracle.adf.action+json',
      'ora-irc-language': parsed.language,
      'ora-irc-rest-action': 'ACE_JOBSEARCH_LIST',
    },
  });
  return response.items?.[0] ?? {};
}

export function mapOracleRequisition(
  requisition: OracleRequisition,
  board: OracleBoard,
  parsed: ParsedOracleUrl,
): RawJob | null {
  const id = String(requisition.Id ?? requisition.id ?? '');
  const title = (requisition.Title ?? requisition.title)?.trim() ?? '';
  if (!id || !title) return null;

  const location = collectOracleLocations({
    ...requisition,
    PrimaryLocation: requisition.PrimaryLocation ?? requisition.primaryLocation,
  });
  const workplaceType = requisition.WorkplaceType ?? requisition.workplaceType ?? '';
  const workplaceTypeCode = requisition.WorkplaceTypeCode ?? requisition.workplaceTypeCode;
  return {
    title,
    company: board.name,
    location,
    remote: /remote/i.test(location)
      || /remote/i.test(workplaceType)
      || workplaceTypeCode === 'ORA_REMOTE',
    url: `${parsed.origin}/hcmUI/CandidateExperience/${parsed.language}/sites/${parsed.site}/job/${encodeURIComponent(id)}`,
    source: 'oracle',
    postedAt: parseOraclePostedDate(requisition.PostedDate ?? requisition.postedDate),
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: mapOracleType(requisition),
    sponsorship: null,
    description: (requisition.ShortDescriptionStr ?? requisition.shortDescriptionStr)?.trim() || null,
  };
}

async function fetchOracleBoard(board: OracleBoard): Promise<RawJob[]> {
  const parsed = parseOracleUrl(board.url);
  if (!parsed) throw new Error(`unparseable Oracle Candidate Experience URL: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  if (parsed.selectedFlexFieldsFacets) {
    let pages = MAX_PAGES;
    for (let page = 0; page < pages; page++) {
      const data = await searchFacetedJobs(parsed, page * PAGE_SIZE);
      const requisitions = data.requisitionList ?? [];
      if (requisitions.length === 0) break;
      const total = data.TotalJobsCount ?? data.totalJobsCount;
      if (page === 0 && typeof total === 'number') {
        pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      }
      for (const requisition of requisitions) {
        const id = String(requisition.Id ?? requisition.id ?? '');
        if (!id || seen.has(id)) continue;
        const job = mapOracleRequisition(requisition, board, parsed);
        if (!job) continue;
        seen.add(id);
        jobs.push(job);
      }
      if (requisitions.length < PAGE_SIZE) break;
    }
    return jobs;
  }

  for (const term of SEARCH_TERMS) {
    let pages = MAX_PAGES;
    for (let page = 0; page < pages; page++) {
      const data = await searchJobs(parsed, term, page * PAGE_SIZE);
      const requisitions = data.requisitionList ?? [];
      if (requisitions.length === 0) break;

      if (page === 0 && typeof data.TotalJobsCount === 'number') {
        pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(data.TotalJobsCount / PAGE_SIZE)));
      }

      for (const requisition of requisitions) {
        const id = String(requisition.Id ?? '');
        if (!id || seen.has(id)) continue;
        const job = mapOracleRequisition(requisition, board, parsed);
        if (!job) continue;
        seen.add(id);
        jobs.push(job);
      }

      if (requisitions.length < PAGE_SIZE) break;
    }
  }

  return jobs;
}

/** Fetch boards concurrently; one unavailable Oracle tenant does not block the rest. */
async function fetchBoards(boards: OracleBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchOracleBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function oracleAdapter(boards: OracleBoard[] = ORACLE_BOARDS): Adapter {
  return {
    name: 'oracle',
    fetch: () => fetchBoards(boards),
  };
}
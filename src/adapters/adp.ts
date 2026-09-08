/** ADP Workforce Now public Career Center API adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface AdpBoard {
  url: string;
  name: string;
}

export const ADP_BOARDS: AdpBoard[] = [{
  url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=3196ba6f-d49c-4493-9290-3d91489bdfa9&ccId=19000101_000001&type=JS&lang=en_CA',
  name: 'General Fusion',
}];

export interface ParsedAdpUrl {
  origin: string;
  cid: string;
  ccId: string;
  lang: string;
}

interface AdpCode {
  codeValue?: string;
  shortName?: string;
}

interface AdpLocation {
  nameCode?: AdpCode;
  address?: {
    cityName?: string;
    countrySubdivisionLevel1?: AdpCode;
    countryCode?: string;
  };
}

interface AdpRate {
  amountValue?: number;
  currencyCode?: string;
}

export interface AdpRequisition {
  itemID?: string;
  requisitionTitle?: string;
  postDate?: string;
  clientRequisitionID?: string;
  requisitionDescription?: string;
  requisitionLocations?: AdpLocation[];
  payGradeRange?: { minimumRate?: AdpRate; maximumRate?: AdpRate };
  sponsoredVisaTypeCodes?: AdpCode[];
  customFieldGroup?: {
    stringFields?: Array<{ stringValue?: string; nameCode?: AdpCode }>;
  };
}

interface AdpListResponse {
  jobRequisitions?: AdpRequisition[];
  meta?: { totalNumber?: number };
}

const PAGE_SIZE = 20;
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 5;

export function parseAdpUrl(url: string): ParsedAdpUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== 'workforcenow.adp.com'
    || !/\/mdf\/recruitment\/recruitment\.html$/i.test(parsed.pathname)) return null;

  const cid = parsed.searchParams.get('cid')?.trim();
  const ccId = parsed.searchParams.get('ccId')?.trim();
  const lang = parsed.searchParams.get('lang')?.trim() || 'en_CA';
  if (!cid || !ccId) return null;
  return { origin: parsed.origin, cid, ccId, lang };
}

function apiUrl(parsed: ParsedAdpUrl, path = ''): URL {
  const url = new URL(
    `/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions${path}`,
    parsed.origin,
  );
  url.searchParams.set('cid', parsed.cid);
  url.searchParams.set('ccId', parsed.ccId);
  url.searchParams.set('lang', parsed.lang);
  url.searchParams.set('locale', parsed.lang);
  return url;
}

function externalId(requisition: AdpRequisition): string | null {
  return requisition.customFieldGroup?.stringFields?.find(
    (field) => field.nameCode?.codeValue === 'ExternalJobID',
  )?.stringValue?.trim() || null;
}

function htmlToText(html: string | undefined): string | null {
  if (!html) return null;
  return load(html).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function mapType(value: string): JobType | null {
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b|\bstagiaire\b/i.test(value)) return 'intern';
  if (/\bcontract|temporary|fixed[- ]term\b/i.test(value)) return 'contract';
  if (/\bfull[- ]?time\b/i.test(value)) return 'full-time';
  return null;
}

export function mapAdpRequisition(
  requisition: AdpRequisition,
  board: AdpBoard,
  parsed: ParsedAdpUrl,
): RawJob | null {
  const id = externalId(requisition);
  const title = requisition.requisitionTitle?.trim();
  if (!id || !title) return null;

  const locations = (requisition.requisitionLocations ?? []).map((location) => {
    const labelled = location.nameCode?.shortName?.trim();
    if (labelled) return labelled;
    return [
      location.address?.cityName,
      location.address?.countrySubdivisionLevel1?.codeValue,
      location.address?.countryCode,
    ].filter(Boolean).join(', ');
  }).filter(Boolean);
  const location = [...new Set(locations)].join('; ');
  const minimum = requisition.payGradeRange?.minimumRate;
  const maximum = requisition.payGradeRange?.maximumRate;
  const currency = minimum?.currencyCode ?? maximum?.currencyCode ?? null;
  const salaryRaw = minimum?.amountValue != null || maximum?.amountValue != null
    ? `${minimum?.amountValue ?? ''}${minimum?.amountValue != null && maximum?.amountValue != null ? '-' : ''}${maximum?.amountValue ?? ''}${currency ? ` ${currency}` : ''}`
    : null;
  const detailUrl = new URL(board.url);
  detailUrl.searchParams.set('type', 'MP');
  detailUrl.searchParams.set('jobId', id);

  return {
    title,
    company: board.name,
    location,
    remote: /\bremote\b/i.test(`${title} ${location}`),
    url: detailUrl.toString(),
    source: 'adp',
    postedAt: requisition.postDate ?? null,
    salaryRaw,
    salaryMin: minimum?.amountValue ?? null,
    salaryMax: maximum?.amountValue ?? null,
    salaryCurrency: currency,
    type: mapType(title),
    sponsorship: requisition.sponsoredVisaTypeCodes?.map(
      (code) => code.shortName ?? code.codeValue,
    ).filter(Boolean).join(', ') || null,
    description: htmlToText(requisition.requisitionDescription),
  };
}

async function fetchAdpBoard(board: AdpBoard): Promise<RawJob[]> {
  const parsed = parseAdpUrl(board.url);
  if (!parsed) throw new Error(`unparseable ADP URL: ${board.url}`);

  const summaries: AdpRequisition[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = apiUrl(parsed);
    url.searchParams.set('$top', String(PAGE_SIZE));
    url.searchParams.set('$skip', String(page * PAGE_SIZE));
    const response = await fetchJson<AdpListResponse>(url.toString());
    const batch = response.jobRequisitions ?? [];
    summaries.push(...batch);
    if (batch.length < PAGE_SIZE || summaries.length >= (response.meta?.totalNumber ?? Infinity)) break;
  }

  const jobs: RawJob[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < summaries.length) {
      const summary = summaries[cursor++];
      if (!summary) continue;
      const id = externalId(summary);
      let requisition = summary;
      if (id) {
        try {
          requisition = await fetchJson<AdpRequisition>(apiUrl(parsed, `/${encodeURIComponent(id)}`).toString());
        } catch {
          requisition = summary;
        }
      }
      const job = mapAdpRequisition({ ...summary, ...requisition }, board, parsed);
      if (job) jobs.push(job);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, summaries.length) },
    () => worker(),
  ));
  return jobs;
}

export function adpAdapter(boards: AdpBoard[] = ADP_BOARDS): Adapter {
  return {
    name: 'adp',
    fetch: async () => {
      const settled = await Promise.allSettled(boards.map(fetchAdpBoard));
      const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
      if (jobs.length === 0 && boards.length > 0 && settled.every((result) => result.status === 'rejected')) {
        throw new Error(settled.map((result, index) => result.status === 'rejected'
          ? `${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
          : '').filter(Boolean).join('; '));
      }
      return jobs;
    },
  };
}
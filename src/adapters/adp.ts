/** ADP Workforce Now public recruitment API adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface AdpBoard {
  /** A verified public ADP Workforce Now recruitment URL. */
  url: string;
  name: string;
}

export const ADP_BOARDS: AdpBoard[] = [
  {
    url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=6008c003-f9a4-47a3-8573-a3b0d594bcba&ccId=9201209146560_3&lang=fr_CA&jobId=577655&jwId=9201209146560_1',
    name: 'Marmen',
  },
  {
    url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=d355e8f6-9a6c-48a9-b7ba-45a41dc5daad&ccId=9200648065638_2&lang=en_CA',
    name: 'Novarc Technologies',
  },
];

export interface ParsedAdpUrl {
  origin: string;
  cid: string;
  ccId: string;
  jwId: string | null;
  lang: string;
}

export function parseAdpUrl(url: string): ParsedAdpUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'workforcenow.adp.com') return null;
  if (!parsed.pathname.endsWith('/mdf/recruitment/recruitment.html')) return null;

  const cid = parsed.searchParams.get('cid');
  const ccId = parsed.searchParams.get('ccId');
  const jwId = parsed.searchParams.get('jwId');
  const lang = parsed.searchParams.get('lang');
  if (!cid || !ccId || !lang) return null;
  return { origin: parsed.origin, cid, ccId, jwId, lang };
}

interface AdpLocation {
  nameCode?: { shortName?: string };
  address?: {
    cityName?: string;
    countrySubdivisionLevel1?: { codeValue?: string };
    postalCode?: string;
  };
}

interface AdpStringField {
  stringValue?: string;
  nameCode?: { codeValue?: string };
}

export interface AdpPosting {
  itemID?: string;
  requisitionTitle?: string;
  postDate?: string;
  workLevelCode?: { shortName?: string };
  clientRequisitionID?: string;
  requisitionLocations?: AdpLocation[];
  sponsoredVisaTypeCodes?: unknown[];
  customFieldGroup?: { stringFields?: AdpStringField[] };
  requisitionDescription?: string;
}

interface AdpResponse {
  jobRequisitions?: AdpPosting[];
  meta?: { startSequence?: number; totalNumber?: number };
}

const PAGE_SIZE = 20;
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 4;
const MAX_DETAIL_LOOKUPS = 50;
const STUDENT_ROLE = /\b(intern(ship)?|co[\s-]?op|student|apprentice|stagiaire|stage|étudiant)\b/i;

function externalJobId(posting: AdpPosting): string | null {
  return posting.customFieldGroup?.stringFields
    ?.find((field) => field.nameCode?.codeValue === 'ExternalJobID')
    ?.stringValue ?? null;
}

function descriptionText(html: string | undefined): string | null {
  if (!html) return null;
  const $ = load(`<div>${html}</div>`);
  $('br').replaceWith('\n');
  $('p,li,h1,h2,h3,h4,h5,h6').append('\n');
  const text = $('div').first().text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
  return text || null;
}

function postingType(posting: AdpPosting): JobType | null {
  const value = `${posting.requisitionTitle ?? ''} ${posting.workLevelCode?.shortName ?? ''}`;
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (STUDENT_ROLE.test(value)) return 'intern';
  if (/contract|temporary|temporaire|contractuel/i.test(value)) return 'contract';
  return null;
}

function postingUrl(posting: AdpPosting, board: AdpBoard): string | null {
  const jobId = externalJobId(posting);
  if (!jobId) return null;
  const url = new URL(board.url);
  url.searchParams.set('jobId', jobId);
  return url.toString();
}

export function mapAdpPosting(posting: AdpPosting, board: AdpBoard): RawJob | null {
  const title = posting.requisitionTitle?.trim();
  const url = postingUrl(posting, board);
  if (!title || !url) return null;

  const location = (posting.requisitionLocations ?? [])
    .map((entry) => entry.nameCode?.shortName?.trim()
      || [entry.address?.cityName, entry.address?.countrySubdivisionLevel1?.codeValue]
        .filter(Boolean)
        .join(', '))
    .filter(Boolean)
    .join('; ');
  const description = descriptionText(posting.requisitionDescription);
  const salaryRaw = description
    ?.split(/\n|(?<=[.!?])\s+/)
    .find((sentence) => /salary|compensation|salaire|rémunération/i.test(sentence)
      && /\$\s*\d|\d[\d ,.]*\s*\$/i.test(sentence)) ?? null;
  const sponsorship = description
    ?.split(/(?<=[.!?])\s+/)
    .filter((sentence) => /visa|sponsor|right to work|eligible to work|autorisé.*travailler/i.test(sentence))
    .join(' ') || null;

  return {
    title,
    company: board.name,
    location,
    remote: /remote|hybrid|télétravail|hybride/i.test(`${title} ${location} ${description ?? ''}`),
    url,
    source: 'adp',
    postedAt: posting.postDate ?? null,
    salaryRaw,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: postingType(posting),
    sponsorship,
    description,
  };
}

function apiBase(parsed: ParsedAdpUrl): string {
  return `${parsed.origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`;
}

function apiParams(parsed: ParsedAdpUrl): URLSearchParams {
  const params = new URLSearchParams({
    cid: parsed.cid,
    ccId: parsed.ccId,
    lang: parsed.lang,
    locale: parsed.lang,
  });
  if (parsed.jwId) params.set('jwId', parsed.jwId);
  return params;
}

async function fetchBoard(board: AdpBoard): Promise<RawJob[]> {
  const parsed = parseAdpUrl(board.url);
  if (!parsed) throw new Error(`unparseable ADP Workforce Now URL: ${board.url}`);
  const configuration = parsed;

  const base = apiBase(configuration);
  const postings: AdpPosting[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = apiParams(configuration);
    params.set('$top', String(PAGE_SIZE));
    params.set('$skip', String(offset));
    const response = await fetchJson<AdpResponse>(`${base}?${params}`);
    const pagePostings = response.jobRequisitions ?? [];
    if (pagePostings.length === 0) break;
    let added = 0;
    for (const posting of pagePostings) {
      const key = externalJobId(posting) ?? posting.itemID;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      postings.push(posting);
      added++;
    }
    offset += pagePostings.length;
    if (added === 0 || postings.length >= (response.meta?.totalNumber ?? Infinity)) break;
  }

  const detailIndexes = postings
    .map((posting, index) => STUDENT_ROLE.test(
      `${posting.requisitionTitle ?? ''} ${posting.workLevelCode?.shortName ?? ''}`,
    ) ? index : -1)
    .filter((index) => index >= 0)
    .slice(0, MAX_DETAIL_LOOKUPS);
  let cursor = 0;

  async function detailWorker(): Promise<void> {
    while (cursor < detailIndexes.length) {
      const index = detailIndexes[cursor++];
      const posting = index === undefined ? undefined : postings[index];
      const jobId = posting && externalJobId(posting);
      if (!posting || !jobId || index === undefined) continue;
      try {
        postings[index] = await fetchJson<AdpPosting>(`${base}/${jobId}?${apiParams(configuration)}`);
      } catch {
        // Listing data remains usable if a posting closes before its detail request.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, detailIndexes.length) },
    detailWorker,
  ));
  return postings.flatMap((posting) => {
    const mapped = mapAdpPosting(posting, board);
    return mapped ? [mapped] : [];
  });
}

async function fetchBoards(boards: AdpBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (jobs.length === 0) {
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    if (failures.length > 0) throw new Error(failures.join('; '));
  }
  return jobs;
}

export function adpAdapter(boards: AdpBoard[] = ADP_BOARDS): Adapter {
  return {
    name: 'adp',
    fetch: () => fetchBoards(boards),
  };
}
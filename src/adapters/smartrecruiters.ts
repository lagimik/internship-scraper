/** SmartRecruiters public postings API adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface SmartRecruitersBoard {
  /** A verified public job or careers URL containing the exact company identifier. */
  url: string;
  name: string;
}

export const SMARTRECRUITERS_BOARDS: SmartRecruitersBoard[] = [
  {
    url: 'https://jobs.smartrecruiters.com/GDMSI/744000147548151-co-op-winter-2027-systems-engineering-4-8-months',
    name: 'General Dynamics Missions System International',
  },
];

export interface ParsedSmartRecruitersUrl {
  companyIdentifier: string;
}

export function parseSmartRecruitersUrl(url: string): ParsedSmartRecruitersUrl | null {
  const match = /^https?:\/\/jobs\.smartrecruiters\.com\/([^/?#]+)/i.exec(url);
  const companyIdentifier = match?.[1];
  return companyIdentifier ? { companyIdentifier } : null;
}

interface SmartRecruitersSection {
  title?: string;
  text?: string;
}

export interface SmartRecruitersPosting {
  id: string;
  name: string;
  company?: { identifier?: string; name?: string };
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  typeOfEmployment?: { id?: string; label?: string };
  postingUrl?: string;
  applyUrl?: string;
  ref?: string;
  jobAd?: { sections?: Record<string, SmartRecruitersSection> };
}

interface SmartRecruitersResponse {
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_DETAIL_LOOKUPS = 50;
const STUDENT_ROLE = /\b(intern(ship)?|co[\s-]?op|student|stagiaire)\b/i;

function htmlToText(html: string): string {
  return load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

function jobType(posting: SmartRecruitersPosting): JobType | null {
  if (/\bco[\s-]?op\b/i.test(posting.name)) return 'co-op';
  const sourceType = `${posting.typeOfEmployment?.id ?? ''} ${posting.typeOfEmployment?.label ?? ''}`;
  return /intern/i.test(sourceType) ? 'intern' : null;
}

function postingUrl(posting: SmartRecruitersPosting, companyIdentifier: string): string {
  if (posting.postingUrl) return posting.postingUrl;
  const slug = posting.name
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `https://jobs.smartrecruiters.com/${companyIdentifier}/${posting.id}-${slug}`;
}

export function mapSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  board: SmartRecruitersBoard,
  companyIdentifier: string,
): RawJob {
  const sections = Object.values(posting.jobAd?.sections ?? {});
  const description = sections
    .map((section) => htmlToText(section.text ?? ''))
    .filter(Boolean)
    .join('\n\n') || null;
  const salaryRaw = description
    ?.split(/(?<=[.!?])\s+/)
    .find((sentence) => /\$\s*\d/.test(sentence)) ?? null;
  const sponsorship = description
    ?.split(/(?<=[.!?])\s+/)
    .filter((sentence) => /eligible to work|security clearance|citizen(ship)?|work authori[sz]ation/i.test(sentence))
    .join(' ') || null;

  return {
    title: posting.name,
    company: posting.company?.name ?? board.name,
    location: posting.location?.fullLocation
      ?? [posting.location?.city, posting.location?.region, posting.location?.country]
        .filter(Boolean)
        .join(', '),
    remote: posting.location?.remote ?? false,
    url: postingUrl(posting, companyIdentifier),
    source: 'smartrecruiters',
    postedAt: posting.releasedDate ?? null,
    salaryRaw,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: jobType(posting),
    sponsorship,
    description,
  };
}

async function fetchBoard(board: SmartRecruitersBoard): Promise<RawJob[]> {
  const parsed = parseSmartRecruitersUrl(board.url);
  if (!parsed) throw new Error(`unparseable SmartRecruiters URL: ${board.url}`);

  const base = `https://api.smartrecruiters.com/v1/companies/${parsed.companyIdentifier}/postings`;
  const postings: SmartRecruitersPosting[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const response = await fetchJson<SmartRecruitersResponse>(`${base}?limit=${PAGE_SIZE}&offset=${offset}`);
    const content = response.content ?? [];
    postings.push(...content);
    if (content.length < PAGE_SIZE || postings.length >= (response.totalFound ?? Infinity)) break;
  }

  let detailLookups = 0;
  for (let index = 0; index < postings.length && detailLookups < MAX_DETAIL_LOOKUPS; index++) {
    const posting = postings[index];
    if (!posting || !STUDENT_ROLE.test(posting.name)) continue;
    detailLookups++;
    try {
      postings[index] = await fetchJson<SmartRecruitersPosting>(`${base}/${posting.id}`);
    } catch {
      // The list payload is sufficient when an individual detail request disappears.
    }
  }

  return postings.map((posting) => mapSmartRecruitersPosting(posting, board, parsed.companyIdentifier));
}

async function fetchBoards(boards: SmartRecruitersBoard[]): Promise<RawJob[]> {
  const results = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (jobs.length === 0) {
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    if (errors.length > 0) throw new Error(errors.join('; '));
  }
  return jobs;
}

export function smartRecruitersAdapter(
  boards: SmartRecruitersBoard[] = SMARTRECRUITERS_BOARDS,
): Adapter {
  return {
    name: 'smartrecruiters',
    fetch: () => fetchBoards(boards),
  };
}
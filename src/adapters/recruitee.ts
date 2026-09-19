/** Recruitee public careers API adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface RecruiteeBoard {
  /** A verified public Recruitee board or posting URL. */
  url: string;
  name: string;
}

export const RECRUITEE_BOARDS: RecruiteeBoard[] = [
  {
    url: 'https://ajwalter.recruitee.com/o/stage-genie-mecanique-internship-mechanical-engineering',
    name: 'AJ Walter Aviation',
  },
];

export interface ParsedRecruiteeUrl {
  origin: string;
  tenant: string;
  boardUrl: string;
  apiUrl: string;
}

export function parseRecruiteeUrl(value: string): ParsedRecruiteeUrl | null {
  try {
    const url = new URL(value);
    const hostMatch = url.hostname.match(/^([a-z0-9-]+)\.recruitee\.com$/i);
    if (url.protocol !== 'https:' || !hostMatch?.[1]) return null;
    if (url.pathname !== '/' && !/^\/o\/[^/]+\/?$/.test(url.pathname)) return null;
    return {
      origin: url.origin,
      tenant: hostMatch[1],
      boardUrl: `${url.origin}/`,
      apiUrl: `${url.origin}/api/offers/`,
    };
  } catch {
    return null;
  }
}

interface RecruiteeLocation {
  name?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface RecruiteeSalary {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  period?: string | null;
}

export interface RecruiteePosting {
  title: string;
  company_name?: string;
  careers_url: string;
  published_at?: string | null;
  created_at?: string | null;
  city?: string;
  state_name?: string;
  country?: string;
  locations?: RecruiteeLocation[];
  remote?: boolean;
  hybrid?: boolean;
  employment_type_code?: string;
  salary?: RecruiteeSalary | null;
  description?: string | null;
  requirements?: string | null;
}

interface RecruiteeResponse {
  offers?: RecruiteePosting[];
}

function htmlToText(html: string | null | undefined): string {
  return html ? load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim() : '';
}

function mapType(posting: RecruiteePosting): JobType | null {
  if (/\bco[\s-]?op\b/i.test(posting.title)) return 'co-op';
  if (/\bintern(ship)?\b|\bstage\b|\bstagiaire\b/i.test(posting.title)) return 'intern';
  if (/contract|temporary|freelance/i.test(posting.employment_type_code ?? '')) return 'contract';
  if (/fulltime|permanent/i.test(posting.employment_type_code ?? '')) return 'full-time';
  return null;
}

function formatLocation(location: RecruiteeLocation): string {
  return [location.city || location.name, location.state, location.country]
    .filter(Boolean)
    .join(', ');
}

function parsePostedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function mapRecruiteePosting(
  posting: RecruiteePosting,
  board: RecruiteeBoard,
): RawJob {
  const locations = (posting.locations ?? []).map(formatLocation).filter(Boolean);
  const location = locations.join('; ')
    || [posting.city, posting.state_name, posting.country].filter(Boolean).join(', ');
  const description = [htmlToText(posting.description), htmlToText(posting.requirements)]
    .filter(Boolean)
    .join('\n\n') || null;
  const salary = posting.salary;
  const salaryParts = salary
    ? [salary.min, salary.max].filter((value): value is number => typeof value === 'number')
    : [];
  const salaryRaw = salaryParts.length > 0
    ? `${salaryParts.join('-')} ${salary?.currency ?? ''} ${salary?.period ?? ''}`.trim()
    : null;

  return {
    title: posting.title,
    company: board.name,
    location,
    remote: posting.remote ?? false,
    url: posting.careers_url,
    source: 'recruitee',
    postedAt: parsePostedAt(posting.published_at ?? posting.created_at),
    salaryRaw,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    type: mapType(posting),
    sponsorship: null,
    description,
  };
}

async function fetchBoard(board: RecruiteeBoard): Promise<RawJob[]> {
  const parsed = parseRecruiteeUrl(board.url);
  if (!parsed) throw new Error(`unparseable Recruitee URL: ${board.url}`);
  const response = await fetchJson<RecruiteeResponse>(parsed.apiUrl);
  return (response.offers ?? []).map((posting) => mapRecruiteePosting(posting, board));
}

async function fetchBoards(boards: RecruiteeBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const successes = settled.filter((result) => result.status === 'fulfilled').length;
  if (successes === 0 && boards.length > 0) {
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    throw new Error(failures.join('; '));
  }
  return jobs;
}

export function recruiteeAdapter(boards: RecruiteeBoard[] = RECRUITEE_BOARDS): Adapter {
  return { name: 'recruitee', fetch: () => fetchBoards(boards) };
}
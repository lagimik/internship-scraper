/** Workable public careers API adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface WorkableBoard {
  /** A verified public careers URL containing the exact account slug. */
  url: string;
  name: string;
}

export const WORKABLE_BOARDS: WorkableBoard[] = [
  { url: 'https://apply.workable.com/bos-innovations/', name: 'BOS Innovations' },
];

export interface ParsedWorkableUrl {
  account: string;
}

export function parseWorkableUrl(url: string): ParsedWorkableUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'apply.workable.com') return null;
  const account = parsed.pathname.split('/').filter(Boolean)[0];
  return account ? { account } : null;
}

interface WorkableLocation {
  country?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  hidden?: boolean;
}

export interface WorkablePosting {
  id: number;
  shortcode: string;
  title: string;
  remote?: boolean;
  location?: WorkableLocation;
  locations?: WorkableLocation[];
  published?: string;
  type?: string;
  workplace?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
}

interface WorkableResponse {
  total?: number;
  results?: WorkablePosting[];
}

const DETAIL_CONCURRENCY = 4;
const MAX_DETAIL_LOOKUPS = 40;

function htmlToText(html: string): string {
  return load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

function formatLocation(location: WorkableLocation): string {
  return [location.city, location.region, location.country].filter(Boolean).join(', ');
}

function jobType(posting: WorkablePosting): JobType | null {
  if (/\bco[\s-]?op\b/i.test(posting.title)) return 'co-op';
  if (/intern/i.test(posting.type ?? '')) return 'intern';
  if (/contract|temporary/i.test(posting.type ?? '')) return 'contract';
  return null;
}

export function mapWorkablePosting(
  posting: WorkablePosting,
  board: WorkableBoard,
  account: string,
): RawJob {
  const visibleLocations = (posting.locations ?? []).filter((location) => !location.hidden);
  const location = visibleLocations.map(formatLocation).filter(Boolean).join('; ')
    || formatLocation(posting.location ?? {});
  const description = [posting.description, posting.requirements, posting.benefits]
    .map((html) => html ? htmlToText(html) : '')
    .filter(Boolean)
    .join('\n\n') || null;
  const salaryRaw = description
    ?.split(/(?<=[.!?])\s+/)
    .find((sentence) => /\$\s*\d/.test(sentence)) ?? null;
  const sponsorship = description
    ?.split(/(?<=[.!?])\s+/)
    .filter((sentence) => /eligible to work|citizen(ship)?|work authori[sz]ation|sponsorship/i.test(sentence))
    .join(' ') || null;

  return {
    title: posting.title,
    company: board.name,
    location,
    remote: posting.remote ?? posting.workplace === 'remote',
    url: `https://apply.workable.com/${account}/j/${posting.shortcode}/`,
    source: 'workable',
    postedAt: posting.published ?? null,
    salaryRaw,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: jobType(posting),
    sponsorship,
    description,
  };
}

async function fetchBoard(board: WorkableBoard): Promise<RawJob[]> {
  const parsed = parseWorkableUrl(board.url);
  if (!parsed) throw new Error(`unparseable Workable URL: ${board.url}`);
  const { account } = parsed;

  const endpoint = `https://apply.workable.com/api/v3/accounts/${account}/jobs`;
  const response = await fetchJson<WorkableResponse>(`${endpoint}#all`, {
    method: 'POST',
    body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
    headers: { 'content-type': 'application/json' },
    realUrl: endpoint,
  });
  const postings = (response.results ?? []).slice();
  let cursor = 0;

  async function detailWorker(): Promise<void> {
    while (cursor < Math.min(postings.length, MAX_DETAIL_LOOKUPS)) {
      const index = cursor++;
      const posting = postings[index];
      if (!posting) return;
      try {
        postings[index] = await fetchJson<WorkablePosting>(
          `https://apply.workable.com/api/v2/accounts/${account}/jobs/${posting.shortcode}`,
        );
      } catch {
        // List data remains usable if a posting closes between the two requests.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, postings.length, MAX_DETAIL_LOOKUPS) },
    detailWorker,
  ));
  return postings.map((posting) => mapWorkablePosting(posting, board, account));
}

async function fetchBoards(boards: WorkableBoard[]): Promise<RawJob[]> {
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

export function workableAdapter(boards: WorkableBoard[] = WORKABLE_BOARDS): Adapter {
  return {
    name: 'workable',
    fetch: () => fetchBoards(boards),
  };
}
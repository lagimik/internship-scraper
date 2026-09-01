/**
 * Siemens Careers Marketplace adapter.
 *
 * Siemens uses Avature, whose public SearchJobs pages are server-rendered HTML. This
 * follows the Workday adapter's high-signal approach: query student/target-role terms,
 * page each result set, dedupe by detail URL, and let normalize() enforce country,
 * role, student type, age, and four-month requirements.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';
import {
  parseAvatureSearchPage,
  type AvatureBoard,
  type ParsedAvaturePage,
} from './avature.js';

const ORIGIN = 'https://jobs.siemens.com';
const SEARCH_PATH = '/en_US/externaljobs/SearchJobs/';
const PAGE_SIZE = 6;
const MAX_PAGES_PER_TERM = 10;

/** Siemens' verified Canada facet, plus global searches needed to include US jobs. */
const SEARCHES: Array<{ term: string | null; country?: string; maxPages: number }> = [
  { term: null, country: 'Canada', maxPages: 50 },
  { term: 'intern', maxPages: MAX_PAGES_PER_TERM },
  { term: 'co-op', maxPages: MAX_PAGES_PER_TERM },
  { term: 'student', maxPages: MAX_PAGES_PER_TERM },
  { term: 'mechanical intern', maxPages: MAX_PAGES_PER_TERM },
  { term: 'mechanical co-op', maxPages: MAX_PAGES_PER_TERM },
  { term: 'manufacturing intern', maxPages: MAX_PAGES_PER_TERM },
  { term: 'mechanical', maxPages: MAX_PAGES_PER_TERM },
  { term: 'manufacturing', maxPages: MAX_PAGES_PER_TERM },
  { term: 'mechatronics', maxPages: MAX_PAGES_PER_TERM },
];

function searchUrl(term: string | null, country?: string): string {
  const path = term ? `${SEARCH_PATH}${encodeURIComponent(term)}` : SEARCH_PATH;
  const url = new URL(path, ORIGIN);
  url.searchParams.set('listFilterMode', '1');
  url.searchParams.set('folderRecordsPerPage', String(PAGE_SIZE));
  if (country === 'Canada') {
    // 42386=[812214] is the verified Siemens portal facet for Canada.
    url.searchParams.set('42386', '[812214]');
    url.searchParams.set('42386_format', '17546');
  }
  return url.toString();
}

/** Parse a Siemens result page and assign the dedicated source identity. */
export function parseSiemensSearchPage(
  html: string,
  country?: string,
  currentOffset = 0,
): ParsedAvaturePage {
  const board: AvatureBoard = { url: searchUrl(null, country), name: 'Siemens', country };
  const parsed = parseAvatureSearchPage(html, board, currentOffset);
  return {
    ...parsed,
    jobs: parsed.jobs.map((job) => ({ ...job, source: 'siemens' })),
  };
}

async function fetchSearch(
  term: string | null,
  country: string | undefined,
  maxPages: number,
): Promise<RawJob[]> {
  const board: AvatureBoard = { url: searchUrl(term, country), name: 'Siemens', country };
  const jobs: RawJob[] = [];
  const visitedOffsets = new Set<number>();
  let offset = 0;

  for (let page = 0; page < maxPages && !visitedOffsets.has(offset); page++) {
    visitedOffsets.add(offset);
    const url = new URL(board.url);
    if (offset > 0) url.searchParams.set('folderOffset', String(offset));
    const parsed = parseSiemensSearchPage(await fetchText(url.toString()), country, offset);
    jobs.push(...parsed.jobs);
    if (parsed.nextOffset === null || parsed.jobs.length === 0) break;
    offset = parsed.nextOffset;
  }
  return jobs;
}

async function fetchSiemensJobs(): Promise<RawJob[]> {
  const settled = await Promise.allSettled(
    SEARCHES.map((search) => fetchSearch(search.term, search.country, search.maxPages)),
  );
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const label = SEARCHES[index]?.term ?? 'Canada';
      errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    for (const job of result.value) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
  });

  if (jobs.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
  return jobs;
}

export function siemensAdapter(): Adapter {
  return { name: 'siemens', fetch: fetchSiemensJobs };
}
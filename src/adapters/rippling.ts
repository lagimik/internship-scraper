/**
 * Rippling adapter.
 *
 * Public Rippling boards expose paginated JSON endpoints used by the careers page:
 *
 *   GET https://ats.rippling.com/api/v2/board/<slug>/jobs
 *   GET https://ats.rippling.com/api/v2/board/<slug>/jobs/<uuid>
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface RipplingBoard {
  /** A public board or job URL, including the exact board slug. */
  url: string;
  name: string;
}

export const RIPPLING_BOARDS: RipplingBoard[] = [
  {
    url: 'https://ats.rippling.com/en-CA/kraken-robotics-inc/jobs',
    name: 'Kraken Robotics Inc.',
  },
];

export interface ParsedRipplingUrl {
  origin: string;
  locale: string | null;
  slug: string;
}

interface RipplingLocation {
  name?: string;
  country?: string;
  countryCode?: string;
  state?: string | null;
  stateCode?: string | null;
  city?: string | null;
  workplaceType?: string;
}

export interface RipplingPosting {
  id?: string;
  uuid?: string;
  name?: string;
  url?: string;
  locations?: RipplingLocation[];
  workLocations?: string[];
  employmentType?: { id?: string; label?: string } | null;
  createdOn?: string | null;
  description?: { company?: string | null; role?: string | null } | null;
  payRangeDetails?: unknown[];
}

interface RipplingListResponse {
  items?: RipplingPosting[];
  page?: number;
  totalPages?: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 5;

/** Parse a Rippling board or job URL and preserve its exact locale and slug. */
export function parseRipplingUrl(url: string): ParsedRipplingUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'ats.rippling.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const locale = /^[a-z]{2}-[A-Z]{2}$/i.test(segments[0] ?? '') ? segments.shift()! : null;
  const [slug, jobs] = segments;
  if (!slug || jobs !== 'jobs') return null;
  return { origin: parsed.origin, locale, slug };
}

function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const $ = load(`<div>${html}</div>`);
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4').each((_, element) => {
    $(element).append('\n');
  });
  const text = $('div').first().text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function mapType(posting: RipplingPosting): JobType | null {
  const value = [posting.name, posting.employmentType?.id, posting.employmentType?.label].join(' ');
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?s?\b|\bstudent\b/i.test(value)) return 'intern';
  if (/\bcontract|temp(orary)?\b/i.test(value)) return 'contract';
  if (/\bfull[- ]?time\b/i.test(value)) return 'full-time';
  return null;
}

/** Map a merged list/detail response to the shared adapter shape. */
export function mapRipplingPosting(
  posting: RipplingPosting,
  board: RipplingBoard,
  parsed: ParsedRipplingUrl,
): RawJob | null {
  const id = posting.uuid ?? posting.id;
  const title = posting.name?.trim();
  if (!id || !title) return null;

  const structuredLocations = posting.locations ?? [];
  const locationNames = structuredLocations
    .map((location) => location.name?.trim())
    .filter((location): location is string => Boolean(location));
  const locations = locationNames.length > 0 ? locationNames : posting.workLocations ?? [];
  const description = [posting.description?.role, posting.description?.company]
    .map(htmlToText)
    .filter((value): value is string => Boolean(value))
    .join('\n\n') || null;

  return {
    title,
    company: board.name,
    location: [...new Set(locations)].join('; '),
    remote: structuredLocations.some((location) => location.workplaceType === 'REMOTE')
      || locations.some((location) => /\bremote\b/i.test(location)),
    url: posting.url ?? `${parsed.origin}/${parsed.locale ? `${parsed.locale}/` : ''}${parsed.slug}/jobs/${id}`,
    source: 'rippling',
    postedAt: posting.createdOn ?? null,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: mapType(posting),
    sponsorship: null,
    description,
  };
}

async function fetchRipplingBoard(board: RipplingBoard): Promise<RawJob[]> {
  const parsed = parseRipplingUrl(board.url);
  if (!parsed) throw new Error(`unparseable Rippling URL: ${board.url}`);
  const boardUrl = parsed;
  const apiBase = `${boardUrl.origin}/api/v2/board/${boardUrl.slug}/jobs`;
  const summaries: RipplingPosting[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      city: '',
      country: '',
      groupJobsByLocation: 'true',
      page: String(page),
      pageSize: String(PAGE_SIZE),
      searchQuery: '',
      state: '',
      workplaceType: '',
    });
    const response = await fetchJson<RipplingListResponse>(`${apiBase}?${params}`);
    summaries.push(...(response.items ?? []));
    if (page + 1 >= (response.totalPages ?? 1)) break;
  }

  const out: RawJob[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < summaries.length) {
      const summary = summaries[cursor++];
      const id = summary?.id ?? summary?.uuid;
      if (!summary || !id) continue;
      try {
        const detail = await fetchJson<RipplingPosting>(`${apiBase}/${id}`);
        const job = mapRipplingPosting({ ...summary, ...detail, locations: summary.locations }, board, boardUrl);
        if (job) out.push(job);
      } catch {
        const job = mapRipplingPosting(summary, board, boardUrl);
        if (job) out.push(job);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(DETAIL_CONCURRENCY, summaries.length) },
    () => worker(),
  ));
  return out;
}

async function fetchBoards(boards: RipplingBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchRipplingBoard));
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

export function ripplingAdapter(boards: RipplingBoard[] = RIPPLING_BOARDS): Adapter {
  return {
    name: 'rippling',
    fetch: () => fetchBoards(boards),
  };
}
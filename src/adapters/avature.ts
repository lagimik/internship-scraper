/**
 * Avature careers-site adapter.
 *
 * Avature portals render public search results as server-side HTML. A configured URL
 * carries the portal-specific facet IDs (which are not portable between employers),
 * while `folderOffset` or `jobOffset` pages through the result folder. Keeping the
 * complete verified search URL is safer than reconstructing its numeric filters.
 */

import * as cheerio from 'cheerio';
import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface AvatureBoard {
  /** A verified, country-filtered Avature SearchJobs URL. */
  url: string;
  name: string;
  /** Used when a result says only "Multiple Locations". */
  country?: string;
}

export const AVATURE_BOARDS: AvatureBoard[] = [
  {
    url: 'https://jobs.pomerleau.ca/en_US/Jobs/SearchJobs',
    name: 'Pomerleau',
  },
  {
    url: 'https://jobs.siemens-energy.com/en_US/jobs/Jobs?29454=964508&29454_format=11381&listFilterMode=1&folderRecordsPerPage=20',
    name: 'Siemens Energy',
    country: 'Canada',
  },
];

export interface ParsedAvaturePage {
  jobs: RawJob[];
  /** Offset of the next page, or null when this is the last page. */
  nextOffset: number | null;
  offsetParameter: 'folderOffset' | 'jobOffset' | null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Parse one server-rendered Avature result page. Exported for fixture tests. */
export function parseAvatureSearchPage(
  html: string,
  board: AvatureBoard,
  currentOffset = 0,
): ParsedAvaturePage {
  const $ = cheerio.load(html);
  const origin = new URL(board.url).origin;
  const jobs: RawJob[] = [];

  $('article.article--result').each((_, card) => {
    const titleLink = $(card).find('a[href*="/JobDetail/"], a[href*="/FolderDetail/"]').first();
    const title = cleanText(titleLink.text());
    const href = titleLink.attr('href');
    if (!title || !href) return;

    let location = cleanText($(card).find('.list-item-location').first().text());
    if (!location) {
      location = [
        $(card).find('.list-item-jobCity').first().text(),
        $(card).find('.list-item-jobState').first().text(),
        $(card).find('.list-item-jobCountry').first().text(),
      ].map(cleanText).filter(Boolean).join(', ');
    }
    // The configured board is explicitly country-filtered. Avature collapses
    // multi-site rows to this placeholder, hiding the country that selected the row.
    if (board.country && (!location || /multiple locations?/i.test(location))) {
      location = location ? `${location}, ${board.country}` : board.country;
    }

    const family = cleanText($(card).find('.list-item-family').first().text());
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|work from home/i.test(`${title} ${location}`),
      url: new URL(href, origin).href,
      source: 'avature',
      // Siemens does not expose a reliable date in search cards. Avoid one detail
      // request per global result; normalization still records first_seen_at.
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: family ? `Job family: ${family}` : null,
    });
  });

  const paginationLinks = $('a[href*="folderOffset="], a[href*="jobOffset="]').map((_, link) => {
    const href = $(link).attr('href');
    if (!href) return null;
    try {
      const url = new URL(href, origin);
      const offsetParameter = url.searchParams.has('folderOffset') ? 'folderOffset' : 'jobOffset';
      const offset = Number(url.searchParams.get(offsetParameter));
      return Number.isFinite(offset) && offset >= 0 ? { offset, offsetParameter } : null;
    } catch {
      return null;
    }
  }).get().filter((link): link is { offset: number; offsetParameter: 'folderOffset' | 'jobOffset' } => Boolean(link));

  const forwardLinks = paginationLinks.filter((link) => link.offset > currentOffset);
  const nextLink = forwardLinks.sort((left, right) => left.offset - right.offset)[0];
  return {
    jobs,
    nextOffset: nextLink?.offset ?? null,
    offsetParameter: nextLink?.offsetParameter ?? null,
  };
}

export function parseAvatureUrl(url: string): { origin: string; searchPath: string } | null {
  try {
    const parsed = new URL(url);
    if (!/\/(?:SearchJobs|Jobs)\/?$/i.test(parsed.pathname)) return null;
    return { origin: parsed.origin, searchPath: parsed.pathname };
  } catch {
    return null;
  }
}

const MAX_PAGES = 50;

async function fetchAvatureBoard(board: AvatureBoard): Promise<RawJob[]> {
  if (!parseAvatureUrl(board.url)) throw new Error(`unparseable Avature URL: ${board.url}`);

  const out: RawJob[] = [];
  const seen = new Set<string>();
  const visitedOffsets = new Set<number>();
  let offset = 0;
  let offsetParameter: 'folderOffset' | 'jobOffset' | null = null;

  for (let page = 0; page < MAX_PAGES && !visitedOffsets.has(offset); page++) {
    visitedOffsets.add(offset);
    const url = new URL(board.url);
    if (offset > 0 && offsetParameter) url.searchParams.set(offsetParameter, String(offset));

    const parsed = parseAvatureSearchPage(await fetchText(url.href), board, offset);
    for (const job of parsed.jobs) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      out.push(job);
    }
    if (parsed.nextOffset === null || parsed.jobs.length === 0) break;
    offset = parsed.nextOffset;
    offsetParameter = parsed.offsetParameter;
  }

  return out;
}

/** Fetch boards concurrently; one broken employer portal does not discard the rest. */
async function fetchBoards(boards: AvatureBoard[], concurrency = 2): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...await fetchAvatureBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function avatureAdapter(boards: AvatureBoard[] = AVATURE_BOARDS): Adapter {
  return {
    name: 'avature',
    fetch: () => fetchBoards(boards),
  };
}
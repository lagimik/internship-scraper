/**
 * Collage adapter.
 *
 * Public Collage boards are server-rendered HTML at:
 *
 *   GET https://secure.collage.co/jobs/<board>/
 *
 * Listing cards include title, commitment, location, canonical job URL, and a
 * machine-readable closed marker. No public structured endpoint is exposed.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface CollageBoard {
  /** A verified public Collage board or job URL. */
  url: string;
  name: string;
}

export const COLLAGE_BOARDS: CollageBoard[] = [
  { url: 'https://secure.collage.co/jobs/nordspace/', name: 'NordSpace Corp' },
];

export interface ParsedCollageUrl {
  origin: string;
  board: string;
}

/** Parse a Collage board or job URL into its public board identifier. */
export function parseCollageUrl(url: string): ParsedCollageUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'secure.collage.co') return null;
    const match = parsed.pathname.match(/^\/jobs\/([^/]+)(?:\/\d+)?\/?$/);
    if (!match?.[1]) return null;
    return { origin: parsed.origin, board: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

function mapType(value: string): JobType | null {
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b/i.test(value)) return 'intern';
  if (/\bcontract|temporary\b/i.test(value)) return 'contract';
  if (/\bfull[\s-]?time\b/i.test(value)) return 'full-time';
  return null;
}

/** Map open cards from a public Collage board page. */
export function parseCollageBoard(
  html: string,
  board: CollageBoard,
  parsed: ParsedCollageUrl,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href || anchor.find('img[alt="position-closed"]').length > 0) return;

    const jobUrl = new URL(href, parsed.origin);
    const path = jobUrl.pathname.match(/^\/jobs\/([^/]+)\/(\d+)\/?$/);
    if (jobUrl.origin !== parsed.origin || path?.[1] !== parsed.board || !path[2]) return;

    const title = anchor.find('.ATS-position-title').first().text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const metadata = anchor.find('.ATS-commitment-and-location').first().text()
      .replace(/\s+/g, ' ')
      .trim();
    const [commitment = '', ...locationParts] = metadata.split(/\s*[•·]\s*/);
    const location = locationParts.join(' · ').trim();

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: jobUrl.toString(),
      source: 'collage',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(`${title} ${commitment}`),
      sponsorship: null,
      description: null,
    });
  });

  return jobs;
}

async function fetchBoard(board: CollageBoard): Promise<RawJob[]> {
  const parsed = parseCollageUrl(board.url);
  if (!parsed) throw new Error(`unparseable Collage URL: ${board.url}`);
  const boardUrl = `${parsed.origin}/jobs/${encodeURIComponent(parsed.board)}/`;
  const html = await fetchText(boardUrl, { headers: { accept: 'text/html' } });
  return parseCollageBoard(html, board, parsed);
}

/** Fetch boards concurrently; fail only when every configured board fails. */
async function fetchBoards(boards: CollageBoard[]): Promise<RawJob[]> {
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

export function collageAdapter(boards: CollageBoard[] = COLLAGE_BOARDS): Adapter {
  return { name: 'collage', fetch: () => fetchBoards(boards) };
}
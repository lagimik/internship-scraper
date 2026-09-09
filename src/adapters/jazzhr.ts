/**
 * JazzHR adapter.
 *
 * Public `applytojob.com` boards render every current opening in server-side HTML.
 * Listing cards provide canonical job links, locations, and departments without
 * authentication or detail-page requests.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface JazzHrBoard {
  /** A verified public JazzHR board or posting URL. */
  url: string;
  name: string;
}

export const JAZZHR_BOARDS: JazzHrBoard[] = [
  { url: 'https://lmitechnologies.applytojob.com/', name: 'LMI Technologies' },
];

export interface ParsedJazzHrUrl {
  origin: string;
  tenant: string;
  boardUrl: string;
}

/** Preserve the exact tenant from a public JazzHR URL. */
export function parseJazzHrUrl(value: string): ParsedJazzHrUrl | null {
  try {
    const url = new URL(value);
    const hostMatch = url.hostname.match(/^([a-z0-9-]+)\.applytojob\.com$/i);
    if (url.protocol !== 'https:' || !hostMatch?.[1]) return null;
    if (url.pathname !== '/' && !/^\/apply(?:\/|$)/.test(url.pathname)) return null;
    return {
      origin: url.origin,
      tenant: hostMatch[1],
      boardUrl: `${url.origin}/`,
    };
  } catch {
    return null;
  }
}

function mapType(value: string): JobType | null {
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b/i.test(value)) return 'intern';
  if (/\bcontract|temporary\b/i.test(value)) return 'contract';
  if (/\bfull[\s-]?time\b/i.test(value)) return 'full-time';
  return null;
}

/** Map JazzHR's public server-rendered listing cards. */
export function parseJazzHrJobs(
  html: string,
  board: JazzHrBoard,
  parsed: ParsedJazzHrUrl,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];

  $('.list-group-item').each((_, element) => {
    const card = $(element);
    const anchor = card.find('h3 a[href]').first();
    const href = anchor.attr('href');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!href || !title) return;

    const jobUrl = new URL(href, parsed.origin);
    if (jobUrl.origin !== parsed.origin
      || !/^\/apply\/[a-z0-9]+\/[^/]+\/?$/i.test(jobUrl.pathname)) return;

    const location = card.find('i.fa-map-marker').parent().text().replace(/\s+/g, ' ').trim();
    const department = card.find('i.fa-sitemap').parent().text().replace(/\s+/g, ' ').trim();
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: jobUrl.toString(),
      source: 'jazzhr',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(title),
      sponsorship: null,
      description: department || null,
    });
  });

  return jobs;
}

async function fetchBoard(board: JazzHrBoard): Promise<RawJob[]> {
  const parsed = parseJazzHrUrl(board.url);
  if (!parsed) throw new Error(`unparseable JazzHR URL: ${board.url}`);
  const html = await fetchText(parsed.boardUrl, { headers: { accept: 'text/html' } });
  return parseJazzHrJobs(html, board, parsed);
}

/** Fetch boards concurrently; fail only when every configured board fails. */
async function fetchBoards(boards: JazzHrBoard[]): Promise<RawJob[]> {
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

export function jazzHrAdapter(boards: JazzHrBoard[] = JAZZHR_BOARDS): Adapter {
  return { name: 'jazzhr', fetch: () => fetchBoards(boards) };
}
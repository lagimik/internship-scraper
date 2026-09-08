/**
 * Teamtailor adapter.
 *
 * Public career sites expose server-rendered job cards at `/jobs` and bounded
 * pagination fragments at `/jobs/show_more?page=N`; no API credentials are needed.
 */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface TeamtailorBoard {
  /** A verified public Teamtailor careers or job URL. */
  url: string;
  name: string;
}

export const TEAMTAILOR_BOARDS: TeamtailorBoard[] = [
  { url: 'https://vention.na.teamtailor.com/jobs/', name: 'Vention' },
];

export interface ParsedTeamtailorUrl {
  origin: string;
}

/** Preserve the exact regional tenant from a public Teamtailor URL. */
export function parseTeamtailorUrl(url: string): ParsedTeamtailorUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.teamtailor.com')) return null;
    if (!/^\/jobs(?:\/|$)/.test(parsed.pathname)) return null;
    return { origin: parsed.origin };
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

/** Map Teamtailor's public listing cards and return its next pagination fragment. */
export function parseTeamtailorJobs(
  html: string,
  board: TeamtailorBoard,
  parsed: ParsedTeamtailorUrl,
): { jobs: RawJob[]; nextPage: string | null } {
  const $ = load(html);
  const jobs: RawJob[] = [];

  $('li a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href) return;
    const jobUrl = new URL(href, parsed.origin);
    if (jobUrl.origin !== parsed.origin || !/^\/jobs\/\d+-[^/]+\/?$/.test(jobUrl.pathname)) return;

    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const metadata = anchor.siblings('div').first().children('span').toArray()
      .map((span) => $(span).text().replace(/\s+/g, ' ').trim())
      .filter((value) => value && value !== '·');
    const location = metadata.slice(1).join(', ');

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: jobUrl.toString(),
      source: 'teamtailor',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(title),
      sponsorship: null,
      description: metadata[0] ?? null,
    });
  });

  const nextHref = $('a[href*="/jobs/show_more?page="]').first().attr('href');
  if (!nextHref) return { jobs, nextPage: null };
  const nextUrl = new URL(nextHref, parsed.origin);
  return {
    jobs,
    nextPage: nextUrl.origin === parsed.origin && nextUrl.pathname === '/jobs/show_more'
      ? nextUrl.toString()
      : null,
  };
}

async function fetchBoard(board: TeamtailorBoard): Promise<RawJob[]> {
  const parsed = parseTeamtailorUrl(board.url);
  if (!parsed) throw new Error(`unparseable Teamtailor URL: ${board.url}`);

  const jobs = new Map<string, RawJob>();
  let pageUrl: string | null = `${parsed.origin}/jobs`;
  for (let page = 0; pageUrl && page < 10; page++) {
    const html = await fetchText(pageUrl, { headers: { accept: 'text/html' } });
    const result = parseTeamtailorJobs(html, board, parsed);
    for (const job of result.jobs) jobs.set(job.url, job);
    pageUrl = result.nextPage;
  }
  return [...jobs.values()];
}

/** Fetch boards concurrently; fail only when every configured board fails. */
async function fetchBoards(boards: TeamtailorBoard[]): Promise<RawJob[]> {
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

export function teamtailorAdapter(boards: TeamtailorBoard[] = TEAMTAILOR_BOARDS): Adapter {
  return { name: 'teamtailor', fetch: () => fetchBoards(boards) };
}
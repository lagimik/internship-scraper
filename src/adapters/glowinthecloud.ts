/** Folks ATS public career-site adapter hosted by Glow in the Cloud. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface GlowInTheCloudBoard {
  /** A verified public Folks ATS board or posting URL. */
  url: string;
  name: string;
}

export const GLOW_IN_THE_CLOUD_BOARDS: GlowInTheCloudBoard[] = [
  { url: 'https://jobs.glowinthecloud.com/avianor?l=en', name: 'Avianor' },
];

export interface ParsedGlowInTheCloudUrl {
  origin: string;
  board: string;
  locale: string;
}

/** Preserve the exact company slug and locale from a Folks ATS URL. */
export function parseGlowInTheCloudUrl(url: string): ParsedGlowInTheCloudUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'jobs.glowinthecloud.com') return null;
    const match = parsed.pathname.match(/^\/([a-z0-9-]+)(?:\/\d+)?\/?$/i);
    if (!match?.[1]) return null;
    return {
      origin: parsed.origin,
      board: match[1],
      locale: parsed.searchParams.get('l') || 'en',
    };
  } catch {
    return null;
  }
}

function jobType(title: string, schedule: string): JobType | null {
  const value = `${title} ${schedule}`;
  if (/\bco[\s-]?op\b/i.test(value)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b/i.test(value)) return 'intern';
  if (/\bcontract(or)?ship\b|\btemporary\b/i.test(value)) return 'contract';
  return null;
}

function salary(value: string, location: string): Pick<RawJob,
  'salaryRaw' | 'salaryMin' | 'salaryMax' | 'salaryCurrency'> {
  const salaryRaw = value.replace(/\s+/g, ' ').trim() || null;
  const amounts = salaryRaw?.match(/([\d,.]+)\s*\$?(?:\s*-\s*([\d,.]+)\s*\$?)?/);
  const parseAmount = (amount: string | undefined): number | null => {
    if (!amount) return null;
    const parsed = Number(amount.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    salaryRaw,
    salaryMin: parseAmount(amounts?.[1]),
    salaryMax: parseAmount(amounts?.[2]),
    salaryCurrency: salaryRaw && /\bcanada\b/i.test(location) ? 'CAD' : null,
  };
}

/** Map the server-rendered cards on a public Folks ATS board. */
export function parseGlowInTheCloudBoard(
  html: string,
  board: GlowInTheCloudBoard,
  parsed = parseGlowInTheCloudUrl(board.url),
): RawJob[] {
  if (!parsed) return [];
  const $ = load(html);
  const jobs: RawJob[] = [];

  $('.job-title a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href) return;
    const jobUrl = new URL(href, parsed.origin);
    const path = jobUrl.pathname.match(/^\/([a-z0-9-]+)\/(\d+)\/?$/i);
    if (jobUrl.origin !== parsed.origin || path?.[1] !== parsed.board || !path[2]) return;

    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const card = anchor.closest('li');
    const location = card.find('li[title="Address"] span').first().text()
      .replace(/\s+/g, ' ').trim();
    const schedule = card.find('li[title="Job types"] span').first().text()
      .replace(/\s+/g, ' ').trim();
    const salaryText = card.find('li[title="Salary"]').first().text();
    jobUrl.search = new URLSearchParams({ l: parsed.locale }).toString();

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /\bremote\b|home.?based/i.test(`${title} ${location} ${schedule}`),
      url: jobUrl.toString(),
      source: 'folks',
      postedAt: null,
      ...salary(salaryText, location),
      type: jobType(title, schedule),
      sponsorship: null,
      description: schedule || null,
    });
  });

  return jobs;
}

async function fetchBoard(board: GlowInTheCloudBoard): Promise<RawJob[]> {
  const parsed = parseGlowInTheCloudUrl(board.url);
  if (!parsed) throw new Error(`unparseable Glow in the Cloud URL: ${board.url}`);
  const boardUrl = `${parsed.origin}/${encodeURIComponent(parsed.board)}?${new URLSearchParams({ l: parsed.locale })}`;
  const html = await fetchText(boardUrl, { headers: { accept: 'text/html' } });
  return parseGlowInTheCloudBoard(html, board, parsed);
}

/** Fetch boards concurrently; fail only when every configured board fails. */
async function fetchBoards(boards: GlowInTheCloudBoard[]): Promise<RawJob[]> {
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

export function folksAdapter(
  boards: GlowInTheCloudBoard[] = GLOW_IN_THE_CLOUD_BOARDS,
): Adapter {
  return { name: 'folks', fetch: () => fetchBoards(boards) };
}
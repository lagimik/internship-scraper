/** d.vinci public careers-page adapter. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface DvinciBoard {
  /** A verified public d.vinci board or posting URL. */
  url: string;
  name: string;
}

export const DVINCI_BOARDS: DvinciBoard[] = [
  {
    url: 'https://doppelmayr.dvinci-hr.com/fr/p/fr/jobs/101438/stagiaire-genie-mecanique-hiver-2027',
    name: 'Doppelmayr Canada',
  },
];

export interface ParsedDvinciUrl {
  origin: string;
  locale: string;
  portal: string;
  boardUrl: string;
}

export function parseDvinciUrl(value: string): ParsedDvinciUrl | null {
  try {
    const url = new URL(value);
    const hostMatch = url.hostname.match(/^([a-z0-9-]+)\.dvinci-hr\.com$/i);
    const pathMatch = url.pathname.match(/^\/([a-z]{2})\/p\/([a-z0-9-]+)\/jobs(?:\/iframe|\/\d+\/[^/]+)?\/?$/i);
    if (url.protocol !== 'https:' || !hostMatch || !pathMatch?.[1] || !pathMatch[2]) return null;
    const locale = pathMatch[1].toLowerCase();
    const portal = pathMatch[2];
    return {
      origin: url.origin,
      locale,
      portal,
      boardUrl: `${url.origin}/${locale}/p/${portal}/jobs`,
    };
  } catch {
    return null;
  }
}

export function parseDvinciListing(html: string, parsed: ParsedDvinciUrl): string[] {
  const $ = load(html);
  const detailPath = new RegExp(`^/${parsed.locale}/p/${parsed.portal}/jobs/\\d+/[^/?#]+/?$`, 'i');
  return [...new Set($('a[href]').map((_, element) => {
    const href = $(element).attr('href');
    if (!href) return null;
    const url = new URL(href, parsed.origin);
    return detailPath.test(url.pathname) ? url.toString() : null;
  }).get().filter((url): url is string => Boolean(url)))];
}

interface DvinciAddress {
  addressLocality?: string;
  addressRegion?: string | null;
  addressCountry?: string;
}

interface DvinciJobPosting {
  '@type'?: string;
  title?: string;
  datePosted?: string;
  description?: string;
  employmentType?: string | string[];
  jobLocation?: Array<{ address?: DvinciAddress }>;
}

function findJobPosting(value: unknown): DvinciJobPosting | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const posting = findJobPosting(item);
      if (posting) return posting;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['@type'] === 'JobPosting') return record as unknown as DvinciJobPosting;
  return findJobPosting(record['@graph']);
}

function mapType(title: string, employmentType: string | string[] | undefined): JobType | null {
  if (/\bco[\s-]?op\b/i.test(title)) return 'co-op';
  if (/\bintern(ship)?\b|\bstage\b|\bstagiaire\b/i.test(title)) return 'intern';
  const types = Array.isArray(employmentType) ? employmentType.join(' ') : employmentType ?? '';
  if (/praktikum|intern/i.test(types)) return 'intern';
  if (/temporary|befristet|contract/i.test(types)) return 'contract';
  if (/full.?time|vollzeit/i.test(types)) return 'full-time';
  return null;
}

export function parseDvinciJob(html: string, jobUrl: string, board: DvinciBoard): RawJob {
  const $ = load(html);
  const scripts = $('script[type="application/ld+json"]').map((_, element) => $(element).text()).get();
  let posting: DvinciJobPosting | null = null;
  for (const script of scripts) {
    try {
      posting = findJobPosting(JSON.parse(script));
      if (posting) break;
    } catch {
      // Ignore unrelated malformed structured data and continue looking.
    }
  }
  if (!posting?.title) throw new Error(`missing JobPosting JSON-LD at ${jobUrl}`);

  const locations = (posting.jobLocation ?? []).map((location) => [
    location.address?.addressLocality,
    location.address?.addressRegion,
    location.address?.addressCountry,
  ].filter(Boolean).join(', ')).filter(Boolean);
  const description = posting.description
    ? load(`<div>${posting.description}</div>`)('div').text().replace(/\s+/g, ' ').trim()
    : null;
  const canonical = $('link[rel="canonical"]').attr('href');
  const url = canonical ? new URL(canonical, jobUrl).toString() : jobUrl;
  const postedAt = posting.datePosted && !Number.isNaN(Date.parse(posting.datePosted))
    ? new Date(posting.datePosted).toISOString()
    : null;

  return {
    title: posting.title.trim(),
    company: board.name,
    location: locations.join('; '),
    remote: /\bremote\b|t[eé]l[eé]travail/i.test(`${posting.title} ${locations.join(' ')} ${description ?? ''}`),
    url,
    source: 'dvinci',
    postedAt,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: mapType(posting.title, posting.employmentType),
    sponsorship: null,
    description,
  };
}

async function fetchBoard(board: DvinciBoard): Promise<RawJob[]> {
  const parsed = parseDvinciUrl(board.url);
  if (!parsed) throw new Error(`unparseable d.vinci URL: ${board.url}`);
  const listing = await fetchText(parsed.boardUrl);
  const jobUrls = parseDvinciListing(listing, parsed).slice(0, 200);
  const jobs: RawJob[] = [];
  for (let offset = 0; offset < jobUrls.length; offset += 5) {
    const batch = jobUrls.slice(offset, offset + 5);
    const settled = await Promise.allSettled(batch.map(async (jobUrl) => (
      parseDvinciJob(await fetchText(jobUrl), jobUrl, board)
    )));
    jobs.push(...settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
  }
  return jobs;
}

async function fetchBoards(boards: DvinciBoard[]): Promise<RawJob[]> {
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

export function dvinciAdapter(boards: DvinciBoard[] = DVINCI_BOARDS): Adapter {
  return { name: 'dvinci', fetch: () => fetchBoards(boards) };
}
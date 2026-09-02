/**
 * Custom job-board adapter for sites without a reusable ATS integration.
 *
 * This intentionally supports a small set of declarative strategies rather than a
 * universal scraper. Add a board configuration and parser for each stable public
 * listing format; failures remain isolated to that board.
 */

import { load } from 'cheerio';
import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

type CustomBoard = CyberRecruiterBoard | HtmlBoard;

interface BoardBase {
  name: string;
  url: string;
}

export interface CyberRecruiterBoard extends BoardBase {
  kind: 'cyber-recruiter';
}

export interface HtmlSelectors {
  card: string;
  titleLink: string;
  location: string;
  postedDate?: string;
  description?: string;
  nextPage?: string;
}

export interface HtmlBoard extends BoardBase {
  kind: 'html';
  selectors: HtmlSelectors;
  maxPages?: number;
}

export const CUSTOM_BOARDS: CustomBoard[] = [
  {
    kind: 'cyber-recruiter',
    name: 'Brock Solutions',
    url: 'https://careers.brocksolutions.com/Careers.aspx?type=CAREERSMAIN',
  },
  {
    kind: 'html',
    name: 'General Dynamics Land Systems Canada',
    url: 'https://generaldynamics-ca-careers.ttcportals.com/search/jobs/in/country/canada',
    selectors: {
      card: '.jobs-section__item',
      titleLink: 'h2 a[href*="/jobs/"]',
      location: '.large-4.columns',
      postedDate: 'time[datetime]',
      nextPage: 'a[rel="next"]',
    },
    maxPages: 5,
  },
  
];

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function emptyFields(): Pick<RawJob,
  'salaryRaw' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'sponsorship'> {
  return {
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    sponsorship: null,
  };
}

/** Parse a conventional card-based HTML board using only configured selectors. */
export function parseConfiguredHtml(html: string, board: HtmlBoard, pageUrl = board.url): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $(board.selectors.card).each((_, element) => {
    const card = $(element);
    const anchor = card.find(board.selectors.titleLink).first();
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;
    const location = card.find(board.selectors.location).first().text().replace(/\s+/g, ' ').trim();
    const dateElement = board.selectors.postedDate
      ? card.find(board.selectors.postedDate).first()
      : null;
    const dateValue = dateElement?.attr('datetime') ?? dateElement?.text().trim();
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: isoDate(dateValue),
      ...emptyFields(),
      type: null,
      description: board.selectors.description
        ? card.find(board.selectors.description).first().text().replace(/\s+/g, ' ').trim() || null
        : null,
    });
  });
  return jobs;
}

const CANADIAN_GROUP = /[?&]groupvalue=(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)-/i;

/** Find Canadian location pages from a Cyber Recruiter location index. */
export function discoverCyberRecruiterPages(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const pages = $('a.JobLink[href*="groupvalue="]').toArray()
    .map((anchor) => $(anchor).attr('href'))
    .filter((href): href is string => typeof href === 'string' && CANADIAN_GROUP.test(href))
    .map((href) => new URL(href, baseUrl).toString());
  return [...new Set(pages)];
}

/** Parse Cyber Recruiter's row-oriented result layout, which has no job-card wrapper. */
export function parseCyberRecruiterJobs(
  html: string,
  board: CyberRecruiterBoard,
  pageUrl: string,
): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('a.JobLink[href*="type=JOBDESCR"]').each((_, element) => {
    const anchor = $(element);
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    let row = anchor.closest('tr').next();
    let location = '';
    let description: string | null = null;
    while (row.length && row.find('a.JobLink[href*="type=JOBDESCR"]').length === 0) {
      const cells = row.find('td');
      const label = cells.first().text().replace(/\s+/g, ' ').trim();
      if (/^location:/i.test(label) && !location) {
        location = cells.eq(1).text().replace(/\s+/g, ' ').trim();
      } else if (cells.length === 1 && !row.find('hr').length) {
        const text = cells.text().replace(/\s+/g, ' ').trim();
        if (text.length > 30) description = text;
      }
      row = row.next();
    }
    if (location && !/\bcanada\b/i.test(location)) location += ', Canada';
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'custom',
      postedAt: null,
      ...emptyFields(),
      type: null,
      description,
    });
  });
  return jobs;
}

async function fetchCyberRecruiter(board: CyberRecruiterBoard): Promise<RawJob[]> {
  const index = await fetchText(board.url, { headers: { accept: 'text/html' } });
  const pages = discoverCyberRecruiterPages(index, board.url);
  const jobs: RawJob[] = [];
  for (const page of pages) {
    jobs.push(...parseCyberRecruiterJobs(
      await fetchText(page, { headers: { accept: 'text/html' } }),
      board,
      page,
    ));
  }
  return jobs;
}

async function fetchHtml(board: HtmlBoard): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let pageUrl: string | null = board.url;
  const visited = new Set<string>();
  for (let page = 0; page < (board.maxPages ?? 3) && pageUrl; page++) {
    if (visited.has(pageUrl)) break;
    visited.add(pageUrl);
    const html = await fetchText(pageUrl, { headers: { accept: 'text/html' } });
    jobs.push(...parseConfiguredHtml(html, board, pageUrl));
    const $ = load(html);
    const next = board.selectors.nextPage
      ? $(board.selectors.nextPage).first().attr('href')
      : null;
    pageUrl = next ? new URL(next, pageUrl).toString() : null;
  }
  return jobs;
}

async function fetchBoard(board: CustomBoard): Promise<RawJob[]> {
  if (board.kind === 'cyber-recruiter') return fetchCyberRecruiter(board);
  return fetchHtml(board);
}

/** Fetch configured boards concurrently; one unusual or blocked site cannot stop others. */
async function fetchBoards(boards: CustomBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function customAdapter(boards: CustomBoard[] = CUSTOM_BOARDS): Adapter {
  return { name: 'custom', fetch: () => fetchBoards(boards) };
}
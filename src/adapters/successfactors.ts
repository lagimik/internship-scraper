/**
 * SAP SuccessFactors Recruiting Marketing adapter.
 *
 * Career Site Builder exposes server-rendered search pages at `/search/`. The same
 * title links and location/date fields shown to a browser are parsed here, avoiding
 * private APIs and one detail-page request per posting.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';
import { load } from 'cheerio';

export interface SuccessFactorsBoard {
  /** Any public page on the employer's SuccessFactors career-site host. */
  url: string;
  name: string;
}

/** Career sites verified to expose server-rendered `/search/` results. */
export const SUCCESSFACTORS_BOARDS: SuccessFactorsBoard[] = [
  {
    url: 'https://jobs.hatch.com/search/?createNewAlert=false&q=engineer&locationsearch=',
    name: 'Hatch',
  },
  {
    url: 'https://jobs.atsautomation.com/search/?createNewAlert=false&q=&locationsearch=canada',
    name: 'ATS Automation',
  },
  {
    url: 'https://careers.kinectrics.com/go/Engineering-and-Scientific/2625217/',
    name: 'Kinectrics',
  },
  {
    url: 'https://jobs.bombardier.com/search/?q=',
    name: 'Bombardier',
  },
];

export interface ParsedSuccessFactorsUrl {
  origin: string;
  searchUrl: string;
}

/** Resolve any career-site page to the host's conventional search endpoint. */
export function parseSuccessFactorsUrl(url: string): ParsedSuccessFactorsUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { origin: parsed.origin, searchUrl: `${parsed.origin}/search/` };
  } catch {
    return null;
  }
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^date\s*/i, '').trim();
  const parts = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})$/i.exec(cleaned);
  if (!parts?.[1] || !parts[2] || !parts[3]) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(parts[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(parts[3]), month, Number(parts[2])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parse both the classic table layout and the newer responsive tile layout. */
export function parseSuccessFactorsHtml(
  html: string,
  board: SuccessFactorsBoard,
): RawJob[] {
  const parsed = parseSuccessFactorsUrl(board.url);
  if (!parsed) return [];

  const $ = load(html);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  $('a.jobTitle-link[href*="/job/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!href || !title || seen.has(href)) return;
    seen.add(href);

    // Both layouts repeat title links for desktop/tablet/phone. Their enclosing result
    // row is the stable boundary and, unlike link-to-link slicing, also handles ATS's
    // template where metadata appears before the title.
    const container = anchor.closest('.job-row, tr.data-row, tr');
    const primaryLocation = container.find('.jobLocation').first().text().trim()
      || container.find('.section-field.location').first().text().replace(/^\s*location\s*/i, '').trim();
    const otherLocations = container.find('.section-field.multilocation').first().text()
      .replace(/^\s*other locations?\s*/i, '').trim();
    const location = [...new Set([primaryLocation, otherLocations].filter(Boolean))].join('; ');
    const date = container.find('.jobDate').first().text().trim()
      || container.find('.section-field.date').first().text().trim();
    const url = new URL(href, parsed.origin).toString();

    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(location) || /remote/i.test(title),
      url,
      source: 'successfactors',
      postedAt: parseDate(date),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: null,
    });
  });

  return jobs;
}

/** Return the next server-rendered result offset advertised by the page. */
export function nextSuccessFactorsOffset(html: string, current: number): number | null {
  const offsets = [...html.matchAll(/[?&](?:amp;)?startrow=(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((offset) => offset > current);
  return offsets.length ? Math.min(...offsets) : null;
}

const SEARCH_TERMS = (process.env.JT_SF_TERMS ?? 'intern,co-op,student,stagiaire')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const MAX_PAGES = 6;

async function fetchBoard(board: SuccessFactorsBoard): Promise<RawJob[]> {
  const parsed = parseSuccessFactorsUrl(board.url);
  if (!parsed) throw new Error(`unparseable SuccessFactors URL: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(parsed.searchUrl);
      url.searchParams.set('createNewAlert', 'false');
      url.searchParams.set('q', term);
      url.searchParams.set('locationsearch', 'Canada');
      if (offset > 0) url.searchParams.set('startrow', String(offset));

      const html = await fetchText(url.toString(), {
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      const pageJobs = parseSuccessFactorsHtml(html, board);
      for (const job of pageJobs) {
        if (!seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      const next = nextSuccessFactorsOffset(html, offset);
      if (next === null || next <= offset) break;
      offset = next;
    }
  }
  return jobs;
}

/** Fetch boards concurrently; an unavailable employer site does not block the rest. */
async function fetchBoards(boards: SuccessFactorsBoard[], concurrency = 3): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        jobs.push(...await fetchBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function successFactorsAdapter(
  boards: SuccessFactorsBoard[] = SUCCESSFACTORS_BOARDS,
): Adapter {
  return {
    name: 'successfactors',
    fetch: () => fetchBoards(boards),
  };
}
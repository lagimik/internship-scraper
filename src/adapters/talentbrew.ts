/**
 * Radancy TalentBrew careers-site adapter.
 *
 * TalentBrew serves public, server-rendered search pages. A job detail URL contains
 * the organization ID needed by the search form, so boards are configured with a
 * verified job URL rather than a guessed company identifier.
 */

import * as cheerio from 'cheerio';
import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface TalentBrewBoard {
  /** A verified TalentBrew job URL containing the organization ID. */
  url: string;
  name: string;
}

export const TALENTBREW_BOARDS: TalentBrewBoard[] = [
  {
    url: 'https://careers.l3harris.com/en/job/-/-/4832/100087751328',
    name: 'L3Harris Technologies',
  },
];

export interface ParsedTalentBrewUrl {
  origin: string;
  locale: string;
  organizationId: string;
  searchUrl: string;
}

export interface ParsedTalentBrewPage {
  jobs: RawJob[];
  nextPage: number | null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Derive the search endpoint and organization ID from a TalentBrew job URL. */
export function parseTalentBrewUrl(url: string): ParsedTalentBrewUrl | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const jobIndex = segments.indexOf('job');
    if (jobIndex < 0 || segments.length < jobIndex + 4) return null;

    const locale = segments[jobIndex - 1];
    const organizationId = segments.at(-2);
    const jobId = segments.at(-1);
    if (!locale || !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(locale)) return null;
    if (!organizationId || !/^\d+$/.test(organizationId)) return null;
    if (!jobId || !/^\d+$/.test(jobId)) return null;

    return {
      origin: parsed.origin,
      locale,
      organizationId,
      searchUrl: `${parsed.origin}/${locale}/search-jobs`,
    };
  } catch {
    return null;
  }
}

/** Parse one server-rendered TalentBrew search result page. */
export function parseTalentBrewSearchPage(
  html: string,
  board: TalentBrewBoard,
  parsed: ParsedTalentBrewUrl,
): ParsedTalentBrewPage {
  const $ = cheerio.load(html);
  const jobs: RawJob[] = [];

  $('a[data-job-id][href*="/job/"]').each((_, element) => {
    const anchor = $(element);
    const title = cleanText(anchor.find('h2').first().text());
    const href = anchor.attr('href');
    if (!title || !href) return;

    const location = cleanText(anchor.find('.job-location').first().text());
    const category = cleanText(anchor.find('.job-category').first().text());
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|work from home/i.test(`${title} ${location}`),
      url: new URL(href, parsed.origin).href,
      source: 'talentbrew',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: category ? `Job category: ${category}` : null,
    });
  });

  const nextHref = $('a.next[href]').first().attr('href');
  const nextPageText = nextHref?.match(/[?&]p=(\d+)/)?.[1];
  const nextPage = nextPageText ? Number(nextPageText) : null;
  return { jobs, nextPage };
}

const SEARCH_TERMS = ['co-op', 'intern', 'student'];
const MAX_PAGES = 10;

async function fetchTalentBrewBoard(board: TalentBrewBoard): Promise<RawJob[]> {
  const parsed = parseTalentBrewUrl(board.url);
  if (!parsed) throw new Error(`unparseable TalentBrew URL: ${board.url}`);

  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  for (const term of SEARCH_TERMS) {
    let page = 1;
    for (let request = 0; request < MAX_PAGES; request++) {
      const url = new URL(parsed.searchUrl);
      url.searchParams.set('k', term);
      url.searchParams.set('orgIds', parsed.organizationId);
      if (page > 1) url.searchParams.set('p', String(page));

      const result = parseTalentBrewSearchPage(await fetchText(url.href), board, parsed);
      for (const job of result.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (result.jobs.length === 0 || result.nextPage === null) break;
      page = result.nextPage;
    }
  }
  return jobs;
}

/** Fetch boards concurrently; one unavailable employer site does not discard others. */
async function fetchBoards(boards: TalentBrewBoard[], concurrency = 3): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...await fetchTalentBrewBoard(board));
      } catch (error) {
        failures.push(`${board.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function talentBrewAdapter(boards: TalentBrewBoard[] = TALENTBREW_BOARDS): Adapter {
  return {
    name: 'talentbrew',
    fetch: () => fetchBoards(boards),
  };
}
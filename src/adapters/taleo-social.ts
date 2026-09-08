/** Oracle Taleo Social Sourcing adapter using public saved searches and paged HTML fragments. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';

export interface TaleoSocialBoard {
  /** A verified `/jobs/search/<id>` URL with employer-selected location facets. */
  url: string;
  name: string;
  maxPages?: number;
}

export const TALEO_SOCIAL_BOARDS: TaleoSocialBoard[] = [{
  url: 'https://jobs.arup.com/jobs/search/21005057',
  name: 'Arup',
  maxPages: 3,
}];

export interface ParsedTaleoSocialUrl {
  origin: string;
  searchId: string;
}

export interface TaleoSocialPage {
  jobs: RawJob[];
  total: number | null;
  searchId: string | null;
  token: string | null;
  siteName: string;
}

interface TaleoSocialFragment {
  Status?: string;
  UserMessage?: string;
  Result?: string;
}

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function parseTaleoSocialUrl(value: string): ParsedTaleoSocialUrl | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/jobs\/search\/(\d+)\/?$/);
    if (url.protocol !== 'https:' || !match?.[1]) return null;
    return { origin: url.origin, searchId: match[1] };
  } catch {
    return null;
  }
}

function inferType(title: string): JobType | null {
  if (/\bco[\s-]?op\b/i.test(title)) return 'co-op';
  if (/\b(?:intern(?:ship)?|student|graduate)\b/i.test(title)) return 'intern';
  return null;
}

/** Map a full search page or an AJAX fragment's server-rendered job rows. */
export function parseTaleoSocialPage(
  html: string,
  board: TaleoSocialBoard,
  pageUrl = board.url,
): TaleoSocialPage {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('.job_list_row').each((_, element) => {
    const row = $(element);
    const anchor = row.find('a.job_link[href]').first();
    const title = cleanText(anchor.text());
    const href = anchor.attr('href');
    if (!title || !href) return;

    const location = cleanText(row.find('.location').first().text());
    const category = cleanText(row.find('.category').first().text());
    const summary = cleanText(row.find('.jlr_description').first().text());
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: new URL(href, pageUrl).toString(),
      source: 'taleo-social',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: inferType(title),
      sponsorship: null,
      description: [category && `Category: ${category}`, summary].filter(Boolean).join('; ') || null,
    });
  });

  const results = cleanText($('.jResultsContent, #jResultsArea').first().text());
  const totalMatch = results.match(/(\d[\d,]*)\s+results?\b/i);
  const content = $('.jResultsContent').first();
  return {
    jobs,
    total: totalMatch?.[1] ? Number(totalMatch[1].replace(/,/g, '')) : null,
    searchId: content.attr('data-jsid') ?? null,
    token: $('#tsstoken').attr('value') ?? null,
    siteName: $('body').attr('data-site-name') ?? 'default657',
  };
}

async function fetchBoard(board: TaleoSocialBoard): Promise<RawJob[]> {
  const parsed = parseTaleoSocialUrl(board.url);
  if (!parsed) throw new Error(`unparseable Taleo Social Sourcing URL: ${board.url}`);

  const initial = await fetch(board.url, {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!initial.ok) throw new Error(`HTTP ${initial.status} for ${board.url}`);
  const html = await initial.text();
  const first = parseTaleoSocialPage(html, board);
  const searchId = first.searchId ?? parsed.searchId;
  if (searchId !== parsed.searchId || !first.token) {
    throw new Error('Taleo Social Sourcing page did not expose its saved-search token');
  }

  const cookies = initial.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]).join('; ');
  if (!cookies) throw new Error('Taleo Social Sourcing page did not provide an anonymous session');

  const jobs = [...first.jobs];
  const pageCount = Math.min(board.maxPages ?? 5, Math.ceil((first.total ?? jobs.length) / 10));
  for (let page = 2; page <= pageCount; page++) {
    const endpoint = new URL('/ajax/content/job_results', parsed.origin);
    endpoint.searchParams.set('JobSearch.id', searchId);
    endpoint.searchParams.set('page_index', String(page));
    endpoint.searchParams.set('site-name', first.siteName);
    endpoint.searchParams.set('include_site', 'true');
    endpoint.searchParams.set('uid', '1');
    const pageResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        cookie: cookies,
        referer: board.url,
        'tss-token': first.token,
        'x-requested-with': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!pageResponse.ok) throw new Error(`HTTP ${pageResponse.status} for ${endpoint}`);
    const response = await pageResponse.json() as TaleoSocialFragment;
    if (response.Status !== 'OK' || typeof response.Result !== 'string') {
      throw new Error(response.UserMessage || `Taleo Social Sourcing page ${page} failed`);
    }
    jobs.push(...parseTaleoSocialPage(response.Result, board, board.url).jobs);
  }

  return [...new Map(jobs.map((job) => [job.url, job])).values()];
}

async function fetchBoards(boards: TaleoSocialBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function taleoSocialAdapter(boards: TaleoSocialBoard[] = TALEO_SOCIAL_BOARDS): Adapter {
  return { name: 'taleo-social', fetch: () => fetchBoards(boards) };
}
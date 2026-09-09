import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface IcimsBoard {
  name: string;
  url: string;
  maxPages?: number;
}

export interface IcimsConfig {
  origin: string;
  boardUrl: string;
}

export interface IcimsPage {
  jobs: RawJob[];
  nextPage: number | null;
}

export const ICIMS_BOARDS: IcimsBoard[] = [{
  name: 'Hexagon Autonomous Solutions',
  url: 'https://careers-hexagonpositioning.icims.com/jobs/search',
  maxPages: 10,
}];

export function parseIcimsUrl(value: string): IcimsConfig | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.icims.com')
      || !/^\/jobs\/(?:search|\d+(?:\/|$))/.test(url.pathname)) return null;
    return {
      origin: url.origin,
      boardUrl: new URL('/jobs/search', url.origin).toString(),
    };
  } catch {
    return null;
  }
}

function fieldValue(card: ReturnType<ReturnType<typeof load>>, label: string): string {
  let value = '';
  card.find('.iCIMS_JobHeaderTag').each((_, element) => {
    const field = card.find(element);
    if (field.find('dt').text().replace(/\s+/g, ' ').trim() === label) {
      value = field.find('dd').text().replace(/\s+/g, ' ').trim();
    }
  });
  return value;
}

function jobType(title: string, value: string): JobType | null {
  const combined = `${title} ${value}`;
  if (/\bco[\s-]?op\b/i.test(combined)) return 'co-op';
  if (/\bintern(ship)?\b|\bstudent\b/i.test(combined)) return 'intern';
  if (/full[\s-]?time|regular/i.test(value)) return 'full-time';
  if (/contract|temporary/i.test(value)) return 'contract';
  return null;
}

/** Parse iCIMS' public server-rendered search cards and pagination link. */
export function parseIcimsSearchPage(
  html: string,
  board: IcimsBoard,
  config: IcimsConfig,
): IcimsPage {
  const $ = load(html);
  const jobs: RawJob[] = [];
  $('.iCIMS_JobsTable .row').each((_, element) => {
    const card = $(element);
    const anchor = card.find('.title a[href*="/jobs/"]').first();
    const title = anchor.find('h3').text().replace(/\s+/g, ' ').trim();
    const href = anchor.attr('href');
    if (!title || !href) return;

    const location = card.find('.header.left span:not(.sr-only)').first().text()
      .replace(/\s+/g, ' ').trim();
    const canonicalUrl = new URL(href, config.origin);
    canonicalUrl.search = '';
    const employmentType = fieldValue(card, 'Type');
    const category = fieldValue(card, 'Category');
    const description = card.find('.description').text().replace(/\s+/g, ' ').trim();
    jobs.push({
      title,
      company: board.name,
      location,
      remote: /remote|home.?based/i.test(`${title} ${location}`),
      url: canonicalUrl.toString(),
      source: 'icims',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: jobType(title, employmentType),
      sponsorship: null,
      description: [category, description].filter(Boolean).join(' - ') || null,
    });
  });

  const nextHref = $('a[href*="/jobs/search?pr="]').filter((_, link) => (
    $(link).text().includes('Next page of results')
    || $(link).find('[title="Next page of results"]').length > 0
  )).first().attr('href');
  const nextPageValue = nextHref ? new URL(nextHref, config.origin).searchParams.get('pr') : null;
  const nextPage = nextPageValue === null ? null : Number(nextPageValue);
  return { jobs, nextPage: Number.isInteger(nextPage) ? nextPage : null };
}

async function fetchBoard(board: IcimsBoard): Promise<RawJob[]> {
  const config = parseIcimsUrl(board.url);
  if (!config) throw new Error(`Unsupported iCIMS URL: ${board.url}`);

  const jobs: RawJob[] = [];
  let page = 0;
  for (let request = 0; request < (board.maxPages ?? 10); request++) {
    const pageUrl = new URL(config.boardUrl);
    pageUrl.searchParams.set('pr', String(page));
    pageUrl.searchParams.set('in_iframe', '1');
    const html = await fetchText(pageUrl.toString(), { headers: { accept: 'text/html' } });
    const parsed = parseIcimsSearchPage(html, board, config);
    jobs.push(...parsed.jobs);
    if (parsed.nextPage === null || parsed.nextPage <= page) break;
    page = parsed.nextPage;
  }
  return jobs;
}

async function fetchBoards(boards: IcimsBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function icimsAdapter(boards: IcimsBoard[] = ICIMS_BOARDS): Adapter {
  return { name: 'icims', fetch: () => fetchBoards(boards) };
}
/** Paradox careers-site adapter using public sitemaps and JobPosting JSON-LD. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface ParadoxBoard {
  /** A verified public jobs search URL. */
  url: string;
  name: string;
  sitemapLocale: string;
}

export const PARADOX_BOARDS: ParadoxBoard[] = [{
  url: 'https://careers.gevernova.com/jobs?filter%5Bemployment_type%5D%5B0%5D=Intern',
  name: 'GE Vernova',
  sitemapLocale: 'en',
}];

export interface ParsedParadoxUrl {
  origin: string;
  sitemapUrl: string;
  jobId: string | null;
}

export interface ParsedParadoxSitemap {
  sitemaps: string[];
  urls: string[];
}

interface JsonLdAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string | { name?: string };
}

interface JsonLdPosting {
  '@type'?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  jobLocationType?: string;
  jobLocation?: { address?: JsonLdAddress } | Array<{ address?: JsonLdAddress }>;
  baseSalary?: {
    currency?: string;
    value?: number | { minValue?: number; maxValue?: number; value?: number };
  };
}

/** Accept a Paradox jobs search or detail URL and recover its sitemap origin. */
export function parseParadoxUrl(url: string): ParsedParadoxUrl | null {
  try {
    const parsed = new URL(url);
    const detail = parsed.pathname.match(/\/job\/([^/]+)\/?$/i);
    if (parsed.protocol !== 'https:' || (parsed.pathname !== '/jobs' && !detail)) return null;
    return {
      origin: parsed.origin,
      sitemapUrl: `${parsed.origin}/sitemap.xml`,
      jobId: detail?.[1] ?? null,
    };
  } catch {
    return null;
  }
}

export function parseParadoxSitemap(xml: string): ParsedParadoxSitemap {
  const $ = load(xml, { xmlMode: true });
  const values = $('loc').toArray().map((element) => $(element).text().trim()).filter(Boolean);
  return {
    sitemaps: $('sitemapindex').length ? values : [],
    urls: $('urlset').length ? values : [],
  };
}

function findPosting(value: unknown): JsonLdPosting | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const posting = findPosting(item);
      if (posting) return posting;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const object = value as JsonLdPosting & { '@graph'?: unknown };
  return object['@type'] === 'JobPosting' ? object : findPosting(object['@graph']);
}

function mapJobType(title: string, employmentType: string | string[] | undefined): JobType | null {
  if (/\bco[ -]?op\b/i.test(title)) return 'co-op';
  if (/\bintern(?:ship)?\b|\bstudent\b|\bstagiaire\b/i.test(title)) return 'intern';
  const values = Array.isArray(employmentType) ? employmentType : [employmentType];
  if (values.some((value) => value === 'INTERN')) return 'intern';
  if (values.some((value) => value === 'FULL_TIME')) return 'full-time';
  if (values.some((value) => value === 'CONTRACTOR' || value === 'TEMPORARY')) return 'contract';
  return null;
}

/** Map a Paradox detail page's schema.org metadata to the shared adapter shape. */
export function parseParadoxJob(
  html: string,
  board: ParadoxBoard,
  pageUrl: string,
): RawJob | null {
  const $ = load(html);
  let posting: JsonLdPosting | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (posting) return;
    try {
      posting = findPosting(JSON.parse($(element).text()));
    } catch {
      // Ignore unrelated malformed metadata blocks.
    }
  });
  const data = posting as JsonLdPosting | null;
  const title = data?.title?.trim();
  if (!data || !title) return null;

  const locations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
  const location = locations.flatMap((item) => {
    const address = item?.address;
    if (!address) return [];
    const country = typeof address.addressCountry === 'string'
      ? address.addressCountry
      : address.addressCountry?.name;
    return [[address.addressLocality, address.addressRegion, country].filter(Boolean).join(', ')];
  }).filter(Boolean).join('; ');
  const description = data.description
    ? load(data.description).text().replace(/\s+/g, ' ').trim()
    : null;
  const salaryValue = data.baseSalary?.value;
  const salaryObject = typeof salaryValue === 'object' ? salaryValue : null;
  const salaryMin = salaryObject?.minValue ?? salaryObject?.value
    ?? (typeof salaryValue === 'number' ? salaryValue : null);
  const salaryMax = salaryObject?.maxValue ?? salaryObject?.value
    ?? (typeof salaryValue === 'number' ? salaryValue : null);
  const canonical = $('link[rel="canonical"]').attr('href');

  return {
    title,
    company: board.name,
    location,
    remote: data.jobLocationType === 'TELECOMMUTE' || /\bremote\b/i.test(`${title} ${location}`),
    url: canonical ? new URL(canonical, pageUrl).toString() : pageUrl,
    source: 'paradox',
    postedAt: data.datePosted && !Number.isNaN(Date.parse(data.datePosted))
      ? new Date(data.datePosted).toISOString()
      : null,
    salaryRaw: salaryMin !== null || salaryMax !== null
      ? [salaryMin, salaryMax].filter((value, index, values) => value !== null && values.indexOf(value) === index).join(' - ')
      : null,
    salaryMin,
    salaryMax,
    salaryCurrency: data.baseSalary?.currency ?? null,
    type: mapJobType(title, data.employmentType),
    sponsorship: description?.match(/[^.]*\b(?:sponsor(?:ship)?|work authorization|legally authorized to work)\b[^.]*\.?/i)?.[0]?.trim() ?? null,
    description,
  };
}

const STUDENT_URL = /(?:intern|co-?op|student|stagiaire)[^/]*\/job\/[^/]+\/?$/i;
const MAX_SITEMAPS = 5;
const MAX_DETAILS = 250;
const DETAIL_CONCURRENCY = 5;

async function fetchBoard(board: ParadoxBoard): Promise<RawJob[]> {
  const parsed = parseParadoxUrl(board.url);
  if (!parsed) throw new Error(`unparseable Paradox URL: ${board.url}`);
  const index = parseParadoxSitemap(await fetchText(parsed.sitemapUrl, {
    headers: { accept: 'application/xml' },
  }));
  const localeSuffix = new RegExp(`-${board.sitemapLocale}\\.xml$`, 'i');
  const sitemapUrls = index.sitemaps.filter((url) => localeSuffix.test(url)).slice(0, MAX_SITEMAPS);
  const sitemapResults = await Promise.allSettled(sitemapUrls.map((url) => fetchText(url, {
    headers: { accept: 'application/xml' },
  })));
  const detailUrls = [...new Set(sitemapResults.flatMap((result) => result.status === 'fulfilled'
    ? parseParadoxSitemap(result.value).urls.filter((url) => STUDENT_URL.test(url))
    : []))].slice(0, MAX_DETAILS);

  const jobs: RawJob[] = [];
  for (let offset = 0; offset < detailUrls.length; offset += DETAIL_CONCURRENCY) {
    const batch = detailUrls.slice(offset, offset + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((url) => fetchText(url, {
      headers: { accept: 'text/html' },
    })));
    results.forEach((result, index) => {
      const url = batch[index];
      if (result.status !== 'fulfilled' || !url) return;
      const job = parseParadoxJob(result.value, board, url);
      if (job) jobs.push(job);
    });
  }
  return jobs;
}

async function fetchBoards(boards: ParadoxBoard[]): Promise<RawJob[]> {
  const results = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function paradoxAdapter(boards: ParadoxBoard[] = PARADOX_BOARDS): Adapter {
  return { name: 'paradox', fetch: () => fetchBoards(boards) };
}
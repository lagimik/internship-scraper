/** Phenom CareerConnect adapter using public sitemaps and JobPosting JSON-LD. */

import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

export interface PhenomBoard {
  url: string;
  name: string;
  /** Values observed in the site's content API requests. */
  refNum: string;
  locale: string;
}

export const PHENOM_BOARDS: PhenomBoard[] = [
  {
    url: 'https://careers.abb/global/en',
    name: 'ABB',
    refNum: 'ABB1GLOBAL',
    locale: 'en_global',
  },
  {
    url: 'https://careers.tranetechnologies.com/global/en',
    name: 'Trane Technologies',
    refNum: 'TRTEGLOBAL',
    locale: 'en_global',
  },
  {
    url: 'https://careers.atco.com/global/en',
    name: 'ATCO Group',
    refNum: 'AGZAGAGLOBAL',
    locale: 'en_global',
  },
  {
    url: 'https://careers.thalesgroup.com/global/en',
    name: 'Thales',
    refNum: 'TGPTGWGLOBAL',
    locale: 'en_global',
  },
];

export interface ParsedPhenomUrl {
  origin: string;
  sitePath: string;
  jobId: string | null;
}

export function parsePhenomUrl(url: string): ParsedPhenomUrl | null {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^(\/[^/]+\/[a-z]{2})(?:(?:\/job\/([^/]+)(?:\/[^/]+)?)|\/search-results)?\/?$/i);
  if (!match?.[1]) return null;
  return { origin: parsed.origin, sitePath: match[1], jobId: match[2] ?? null };
}

export function parsePhenomSitemap(xml: string): string[] {
  const $ = load(xml, { xmlMode: true });
  return $('loc').toArray().map((element) => $(element).text().trim()).filter(Boolean);
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

function mapJobType(title: string, employmentType: string | string[] | undefined): JobType | null {
  if (/\bco[ -]?op\b/i.test(title)) return 'co-op';
  if (/\bintern(?:ship)?\b|\bstagiaire\b/i.test(title)) return 'intern';
  const values = Array.isArray(employmentType) ? employmentType : [employmentType];
  if (values.includes('FULL_TIME')) return 'full-time';
  if (values.includes('CONTRACTOR') || values.includes('TEMPORARY')) return 'contract';
  return null;
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

/** Map Phenom's schema.org JobPosting block to the shared adapter shape. */
export function parsePhenomJob(html: string, board: PhenomBoard, pageUrl: string): RawJob | null {
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
  const canonical = $('link[rel="canonical"]').attr('href');
  const description = data.description
    ? load(data.description).text().replace(/\s+/g, ' ').trim()
    : null;
  const salaryValue = data.baseSalary?.value;
  const salaryObject = typeof salaryValue === 'object' ? salaryValue : null;
  const salaryMin = salaryObject?.minValue ?? salaryObject?.value
    ?? (typeof salaryValue === 'number' ? salaryValue : null);
  const salaryMax = salaryObject?.maxValue ?? salaryObject?.value
    ?? (typeof salaryValue === 'number' ? salaryValue : null);

  return {
    title,
    company: board.name,
    location,
    remote: data.jobLocationType === 'TELECOMMUTE' || /\bremote\b/i.test(`${title} ${location}`),
    url: canonical ? new URL(canonical, pageUrl).toString() : pageUrl,
    source: 'phenom',
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
    sponsorship: description?.match(/[^.]*\b(?:sponsor(?:ship)?|work authorization|legal right to work)\b[^.]*\.?/i)?.[0]?.trim() ?? null,
    description,
  };
}

const STUDENT_SLUG = /(?:^|[-_/])(?:intern(?:ship)?|co-?op|student|stagiaire)(?=[-_/]|$)/i;
const MAX_SITEMAPS = 10;
const MAX_DETAILS = 250;
const DETAIL_CONCURRENCY = 5;

/** Find student job pages in either a direct urlset or fetched child sitemaps. */
export function discoverPhenomDetailUrls(rootXml: string, childXml: string[] = []): string[] {
  const rootUrls = parsePhenomSitemap(rootXml);
  const directUrls = rootUrls.filter((url) => /\/job\//i.test(url) && STUDENT_SLUG.test(url));
  const urls = directUrls.length > 0
    ? directUrls
    : childXml.flatMap((xml) => parsePhenomSitemap(xml).filter((url) => STUDENT_SLUG.test(url)));
  return [...new Set(urls)].slice(0, MAX_DETAILS);
}

async function fetchBoard(board: PhenomBoard): Promise<RawJob[]> {
  const rootXml = await fetchText(`${board.url}/sitemap_index.xml`, {
    headers: { accept: 'application/xml' },
  });
  let detailUrls = discoverPhenomDetailUrls(rootXml);
  if (detailUrls.length === 0) {
    const sitemapUrls = parsePhenomSitemap(rootXml).slice(0, MAX_SITEMAPS);
    const sitemapResults = await Promise.allSettled(sitemapUrls.map((url) => fetchText(url, {
      headers: { accept: 'application/xml' },
    })));
    detailUrls = discoverPhenomDetailUrls(rootXml, sitemapResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []));
  }

  const jobs: RawJob[] = [];
  for (let offset = 0; offset < detailUrls.length; offset += DETAIL_CONCURRENCY) {
    const batch = detailUrls.slice(offset, offset + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((url) => fetchText(url, {
      headers: { accept: 'text/html' },
    })));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const url = batch[index];
      if (!url) return;
      const job = parsePhenomJob(result.value, board, url);
      if (job) jobs.push(job);
    });
  }
  return jobs;
}

async function fetchBoards(boards: PhenomBoard[]): Promise<RawJob[]> {
  const results = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return jobs;
}

export function phenomAdapter(boards: PhenomBoard[] = PHENOM_BOARDS): Adapter {
  return { name: 'phenom', fetch: () => fetchBoards(boards) };
}
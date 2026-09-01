/**
 * Tesla careers adapter for a search-results page saved from a browser.
 *
 * Tesla's Akamai configuration blocks this application's server-side requests. Save
 * the rendered careers search page as `input/tesla.html`; this adapter parses the
 * visible result cards without making a network request.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load } from 'cheerio';
import type { Adapter, JobType, RawJob } from '../types.js';

const INPUT_PATH = resolve(process.cwd(), 'input', 'tesla.html');
const TESLA_ORIGIN = 'https://www.tesla.com';

function mapType(type: string | undefined): JobType | null {
  const normalized = type?.toLowerCase() ?? '';
  if (/\bintern(ship)?\b|\bapprentice\b/.test(normalized)) return 'intern';
  if (/\bco[ -]?op\b/.test(normalized)) return 'co-op';
  if (/\bfull[ -]?time\b/.test(normalized)) return 'full-time';
  if (/\bseasonal\b|\bcontract\b/.test(normalized)) return 'contract';
  return null;
}

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Parse rendered Tesla search-result cards. Exported for deterministic fixture tests. */
export function parseTeslaHtml(html: string): RawJob[] {
  const $ = load(html);
  const jobs: RawJob[] = [];

  $('li[class*="SearchListItem"]').each((_index, element) => {
    const card = $(element);
    const link = card.find('a[href*="/careers/search/job/"]').first();
    const title = cleanText(link.text());
    const href = link.attr('href')?.trim();
    const metadata = card.find('ul[class*="ListResultItemSublist"] > li').first();
    const category = cleanText(metadata.find('strong').first().text());
    const typeLabel = cleanText(metadata.find('strong').eq(1).text());
    const location = cleanText(card.find('li[class*="ListResultItemSublistLocation"] strong').first().text());
    if (!title || !href || !location) return;

    jobs.push({
      title,
      company: 'Tesla',
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: new URL(href, TESLA_ORIGIN).href,
      source: 'tesla',
      // Search-result cards do not expose a reliable posting date.
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(typeLabel),
      sponsorship: null,
      description: category ? `Job category: ${category}` : null,
    });
  });

  return jobs;
}

async function loadTeslaInput(): Promise<RawJob[]> {
  return parseTeslaHtml(await readFile(INPUT_PATH, 'utf8'));
}

export function teslaAdapter(): Adapter {
  return {
    name: 'tesla',
    fetch: loadTeslaInput,
  };
}
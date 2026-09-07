/** Tesla careers adapter for a search response saved from a browser. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Adapter, JobType, RawJob } from '../types.js';

const INPUT_PATH = resolve(process.cwd(), 'input', 'tesla.json');
const TESLA_ORIGIN = 'https://www.tesla.com';

interface TeslaListing {
  id: string;
  t: string;
  dp: string;
  l: string;
  y: number;
}

interface TeslaPayload {
  lookup: {
    locations: Record<string, string>;
    departments: Record<string, string>;
    types: Record<string, string>;
  };
  listings: TeslaListing[];
}

function mapType(type: string | undefined): JobType | null {
  const normalized = type?.toLowerCase() ?? '';
  if (/\bintern(ship)?\b|\bapprentice\b/.test(normalized)) return 'intern';
  if (/\bco[ -]?op\b/.test(normalized)) return 'co-op';
  if (/\bfull[ -]?time\b/.test(normalized)) return 'full-time';
  if (/\bseasonal\b|\bcontract\b/.test(normalized)) return 'contract';
  return null;
}

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();

function slugifyTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Parse Tesla's compact careers search payload. Exported for fixture tests. */
export function parseTeslaJson(payload: TeslaPayload): RawJob[] {
  return payload.listings.flatMap((listing) => {
    const title = cleanText(listing.t);
    const location = payload.lookup.locations[listing.l];
    if (!listing.id || !title || !location) return [];

    const department = payload.lookup.departments[listing.dp];
    const typeLabel = payload.lookup.types[String(listing.y)];
    return [{
      title,
      company: 'Tesla',
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: `${TESLA_ORIGIN}/en_CA/careers/search/job/${slugifyTitle(title)}-${listing.id}`,
      source: 'tesla',
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(typeLabel),
      sponsorship: null,
      description: department ? `Job category: ${department}` : null,
    }];
  });
}

async function loadTeslaInput(): Promise<RawJob[]> {
  const payload = JSON.parse(await readFile(INPUT_PATH, 'utf8')) as TeslaPayload;
  return parseTeslaJson(payload);
}

export function teslaAdapter(): Adapter {
  return {
    name: 'tesla',
    fetch: loadTeslaInput,
  };
}
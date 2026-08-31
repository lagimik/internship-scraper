/**
 * Tesla Canada careers adapter.
 *
 * Tesla's careers application downloads one compact state document containing all
 * current listings and lookup tables. Canadian location IDs are identified through
 * the `geo` tree, then joined to listings and their human-readable location/type:
 *
 *   GET https://www.tesla.com/cua-api/apps/careers/state
 *
 * This avoids rendering the React application and requests the state only once.
 */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

const STATE_URL = 'https://www.tesla.com/cua-api/apps/careers/state';
const CAREERS_URL = 'https://www.tesla.com/en_CA/careers/search/?site=CA';
const JOB_URL = 'https://www.tesla.com/en_CA/careers/search/job';

interface TeslaListing {
  id?: string;
  /** Title. */
  t?: string;
  /** Department lookup ID. */
  dp?: string;
  /** Function lookup ID. */
  f?: string;
  /** Location lookup ID. */
  l?: string;
  /** Job-type lookup ID. */
  y?: number;
  /** Unpublish date, not the posting date. */
  pu?: string | null;
}

interface TeslaSite {
  id?: string;
  cities?: Record<string, string[]>;
}

interface TeslaRegion {
  sites?: TeslaSite[];
}

export interface TeslaCareersState {
  lookup?: {
    locations?: Record<string, string>;
    departments?: Record<string, string>;
    types?: Record<string, string>;
  };
  geo?: TeslaRegion[];
  listings?: TeslaListing[];
}

function mapType(type: string | undefined): JobType | null {
  switch (type?.toLowerCase()) {
    case 'intern': return 'intern';
    case 'fulltime': return 'full-time';
    case 'seasonal': return 'contract';
    default: return null;
  }
}

/** Map the careers state to Canadian jobs. Exported for deterministic fixture tests. */
export function parseTeslaCareersState(state: TeslaCareersState): RawJob[] {
  const canada = (state.geo ?? [])
    .flatMap((region) => region.sites ?? [])
    .find((site) => site.id === 'CA');
  if (!canada) return [];

  const canadianLocationIds = new Set(Object.values(canada.cities ?? {}).flat());
  const locations = state.lookup?.locations ?? {};
  const departments = state.lookup?.departments ?? {};
  const types = state.lookup?.types ?? {};

  return (state.listings ?? []).flatMap((listing) => {
    const id = listing.id?.trim();
    const title = listing.t?.trim();
    const locationId = listing.l;
    if (!id || !title || !locationId || !canadianLocationIds.has(locationId)) return [];

    const location = locations[locationId]?.trim() ?? '';
    const department = listing.dp ? departments[listing.dp] : null;
    return [{
      title,
      company: 'Tesla',
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: `${JOB_URL}/${encodeURIComponent(id)}`,
      source: 'tesla',
      // Tesla exposes an optional unpublish date, but not a reliable posted date.
      postedAt: null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: mapType(listing.y == null ? undefined : types[String(listing.y)]),
      sponsorship: null,
      description: department ? `Job category: ${department}` : null,
    }];
  });
}

async function fetchTeslaCanada(): Promise<RawJob[]> {
  const state = await fetchJson<TeslaCareersState>(STATE_URL, {
    headers: {
      referer: CAREERS_URL,
      // Match the public careers client. Tesla's edge can still reject particular
      // server IPs; the scrape runner isolates that failure from every other source.
      'user-agent': 'Mozilla/5.0 (compatible; job-tracker/0.1; +personal-job-search)',
    },
  });
  return parseTeslaCareersState(state);
}

export function teslaAdapter(): Adapter {
  return {
    name: 'tesla',
    fetch: fetchTeslaCanada,
  };
}
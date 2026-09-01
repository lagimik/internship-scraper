/** Country/region matching for Canadian and US internship locations. */

import type { CountryCode, LocationConfidence } from '../types.js';

export const PROVINCES: Record<string, string> = {
  ontario: 'ON', quebec: 'QC', 'québec': 'QC', 'british columbia': 'BC', alberta: 'AB',
  manitoba: 'MB', saskatchewan: 'SK', 'nova scotia': 'NS', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', newfoundland: 'NL', 'prince edward island': 'PE',
  'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT',
};

export const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

const CA_CODES = new Set(Object.values(PROVINCES));
const US_CODES = new Set(Object.values(STATES));

const CA_CITIES: Record<string, string> = {
  toronto: 'ON', ottawa: 'ON', mississauga: 'ON', brampton: 'ON', hamilton: 'ON',
  london: 'ON', kitchener: 'ON', waterloo: 'ON', windsor: 'ON', markham: 'ON',
  vaughan: 'ON', burlington: 'ON', oakville: 'ON', guelph: 'ON', kingston: 'ON',
  montreal: 'QC', 'montréal': 'QC', 'quebec city': 'QC', laval: 'QC', gatineau: 'QC',
  sherbrooke: 'QC', vancouver: 'BC', burnaby: 'BC', surrey: 'BC', richmond: 'BC',
  victoria: 'BC', kelowna: 'BC', 'north vancouver': 'BC', calgary: 'AB', edmonton: 'AB',
  winnipeg: 'MB', regina: 'SK', saskatoon: 'SK', halifax: 'NS', moncton: 'NB',
};

const US_CITIES: Record<string, string> = {
  'san francisco': 'CA', 'san jose': 'CA', 'los angeles': 'CA', 'san diego': 'CA',
  seattle: 'WA', austin: 'TX', houston: 'TX', dallas: 'TX', boston: 'MA', chicago: 'IL',
  'new york': 'NY', atlanta: 'GA', denver: 'CO', portland: 'OR', phoenix: 'AZ',
  pittsburgh: 'PA', philadelphia: 'PA', detroit: 'MI', minneapolis: 'MN',
  'washington dc': 'DC', 'washington, dc': 'DC',
};

const AMBIGUOUS_CA_CITIES = new Set(['london', 'vancouver', 'windsor', 'kingston', 'richmond', 'victoria']);
const FOREIGN_NAMED = /\b(united kingdom|england|australia|india|germany|france|japan|china|singapore|brazil|ireland|netherlands|spain|italy|poland|israel|mexico|sweden|switzerland|korea|taiwan|new zealand|saudi arabia)\b/;

export interface LocationMatch {
  country: CountryCode;
  region: string | null;
  confidence: LocationConfidence;
  remote: boolean;
  matchedBy: string;
}

function has(loc: string, value: string): boolean {
  return new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(loc);
}

/** A multi-country posting returns one match per eligible country. */
export function matchLocations(rawLocation: string): LocationMatch[] {
  const loc = (rawLocation ?? '').toLowerCase().trim();
  if (!loc) return [];

  const remote = /\bremote\b|\bwork from home\b|\bwfh\b|\bdistributed\b/.test(loc);
  const caNamed = /\bcanada\b|\bcanadian\b/.test(loc);
  const usNamed = /\bunited states\b|\busa?\b|\bu\.s\.a?\b|\bus[- ]only\b/.test(loc);
  const broadRemote = remote && /north america|americas|global|worldwide|anywhere/.test(loc);
  const matches = new Map<CountryCode, LocationMatch>();

  const add = (country: CountryCode, region: string | null, confidence: LocationConfidence, matchedBy: string) => {
    const current = matches.get(country);
    if (!current || (current.confidence === 'ambiguous' && confidence === 'confirmed') || (!current.region && region)) {
      matches.set(country, { country, region, confidence, remote, matchedBy });
    }
  };

  if (caNamed) add('CA', null, usNamed ? 'ambiguous' : 'confirmed', remote ? 'remote-canada' : 'country:canada');
  if (usNamed) add('US', null, caNamed ? 'ambiguous' : 'confirmed', remote ? 'remote-us' : 'country:united-states');
  if (broadRemote) {
    add('CA', null, 'ambiguous', 'remote-broad-region');
    add('US', null, 'ambiguous', 'remote-broad-region');
  }

  for (const [name, code] of Object.entries(PROVINCES)) {
    if (has(loc, name)) add('CA', code, 'confirmed', `province:${name}`);
  }
  for (const [name, code] of Object.entries(STATES)) {
    if (has(loc, name)) add('US', code, 'confirmed', `state:${name}`);
  }

  for (const code of CA_CODES) {
    const c = code.toLowerCase();
    if (new RegExp(`\\(\\s*${c}\\s*\\)`).test(loc) || new RegExp(`,\\s*${c}\\b`).test(loc) ||
        new RegExp(`\\bca/${c}(?:/|\\b)`).test(loc)) {
      add('CA', code, caNamed || !usNamed ? 'confirmed' : 'ambiguous', `province-code:${code}`);
    }
  }
  for (const code of US_CODES) {
    const c = code.toLowerCase();
    if (new RegExp(`,\\s*${c}(?:\\s|,|$)`).test(loc) || new RegExp(`\\bus/${c}(?:/|\\b)`).test(loc)) {
      // ON and CA-style abbreviations can overlap other text; a known US city or
      // explicit country below supplies stronger corroboration.
      add('US', code, usNamed ? 'confirmed' : 'ambiguous', `state-code:${code}`);
    }
  }

  for (const [city, code] of Object.entries(CA_CITIES)) {
    if (has(loc, city) && !usNamed && !(AMBIGUOUS_CA_CITIES.has(city) && FOREIGN_NAMED.test(loc))) {
      add('CA', code, caNamed ? 'confirmed' : 'ambiguous', `city:${city}`);
    }
  }
  for (const [city, code] of Object.entries(US_CITIES)) {
    if (has(loc, city)) add('US', code, usNamed ? 'confirmed' : 'ambiguous', `city:${city}`);
  }

  return [...matches.values()];
}
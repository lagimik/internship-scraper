/**
 * Classic SAP E-Recruiting adapter.
 *
 * Public Web Dynpro boards establish an anonymous session, then submit UI events to
 * the session-specific form action. Search results arrive as HTML in an XML update;
 * activating a title returns the stable public posting URL in an OpenWindow command.
 */

import { load } from 'cheerio';
import type { Adapter, RawJob } from '../types.js';

export interface SapERecruitingBoard {
  /** A public HRRCF_A_UNREG_JOB_SEARCH Web Dynpro URL with its real config ID. */
  url: string;
  name: string;
  location: string;
}

export const SAP_ERECRUITING_BOARDS: SapERecruitingBoard[] = [
  {
    url: 'https://app.bchydro.com/sap/bc/webdynpro/sap/hrrcf_a_unreg_job_search?sap-wd-configId=ZHRRCF_A_UNREG_JOB_SEARCH&sap-theme=sap_belize&saml2=disabled',
    name: 'BC Hydro',
    location: 'British Columbia, Canada',
  },
];

export interface ParsedSapERecruitingUrl {
  origin: string;
  applicationUrl: string;
  configId: string;
}

export interface SapERecruitingResult {
  controlId: string;
  title: string;
  areaOfExpertise: string;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULT_ROWS = 20;

export function parseSapERecruitingUrl(url: string): ParsedSapERecruitingUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:'
      || !/\/sap\/bc\/webdynpro\/sap\/hrrcf_a_unreg_job_search$/i.test(parsed.pathname)) {
      return null;
    }
    const configId = parsed.searchParams.get('sap-wd-configId');
    if (!configId) return null;
    return {
      origin: parsed.origin,
      applicationUrl: `${parsed.origin}${parsed.pathname}`,
      configId,
    };
  } catch {
    return null;
  }
}

function updateHtml(response: string): string {
  const updates = [...response.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
    .map((match) => match[1] ?? '')
    .find((content) => /<table[^>]+ct="ST"/i.test(content));
  return updates ?? response;
}

/** Parse SAP's current server-side table window. */
export function parseSapERecruitingResults(response: string): SapERecruitingResult[] {
  const $ = load(updateHtml(response));
  const results: SapERecruitingResult[] = [];
  $('table[ct="ST"] tr[role="row"]').each((_, row) => {
    const anchor = $(row).find('a[ct="LN"][id]').first();
    const controlId = anchor.attr('id');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!controlId || !title) return;
    const cells = $(row).find('td[role="gridcell"]');
    const areaOfExpertise = cells.last().text().replace(/\s+/g, ' ').trim();
    results.push({ controlId, title, areaOfExpertise });
  });
  return results.slice(0, MAX_RESULT_ROWS);
}

function decodeSapEscapes(value: string): string {
  return value
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

/** Recover the real public posting URL emitted by a title activation. */
export function parseSapERecruitingPostingUrl(response: string, origin: string): string | null {
  const raw = response.match(/\b(?:OpenWindow|openExternalWindow)\b[\s\S]*?"url":"([^"]+)"/i)?.[1];
  if (!raw) return null;
  try {
    return new URL(decodeSapEscapes(raw), origin).toString();
  } catch {
    return null;
  }
}

export function mapSapERecruitingResult(
  result: SapERecruitingResult,
  postingUrl: string,
  board: SapERecruitingBoard,
): RawJob {
  return {
    title: result.title,
    company: board.name,
    location: board.location,
    remote: /\bremote\b/i.test(result.title),
    url: postingUrl,
    source: 'sap-erecruiting',
    postedAt: null,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: /\bco[\s-]?op\b/i.test(result.title) ? 'co-op' : 'intern',
    sponsorship: null,
    description: result.areaOfExpertise
      ? `Area of expertise: ${result.areaOfExpertise}`
      : null,
  };
}

interface SapSession {
  action: string;
  cookie: string;
  secureId: string;
  appName: string;
  startButtonId: string;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

async function createSession(board: SapERecruitingBoard): Promise<SapSession> {
  const response = await request(board.url, { headers: { accept: 'text/html' } });
  const html = await response.text();
  const $ = load(html);
  const form = $('form').filter((_, element) => $(element).attr('id') === 'sap.client.SsrClient.form').first();
  const action = form.attr('action');
  const secureId = $('input[name="sap-wd-secure-id"]').attr('value');
  const appName = $('input[name="fesrAppName"]').attr('value');
  const cookie = response.headers.getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  if (!action || !secureId || !appName || !cookie) {
    throw new Error('SAP E-Recruiting session metadata was incomplete');
  }
  const sessionAction = new URL(action, board.url).toString();
  const contentResponse = await request(sessionAction, {
    method: 'POST',
    headers: {
      accept: 'text/xml, text/html, */*',
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      referer: board.url,
      'x-requested-with': 'XMLHttpRequest',
      'x-xhr-logon': 'accept',
    },
    body: eventBody({ secureId, appName }, loadingPlaceholderLoad()),
  });
  const content = load(updateHtml(await contentResponse.text()));
  const startButtonId = content('[ct="B"]').filter((_, element) => {
    return /^Start\b/.test(content(element).text().trim());
  }).first().attr('id');
  if (!startButtonId) throw new Error('SAP E-Recruiting Start control was not found');
  return { action: sessionAction, cookie, secureId, appName, startButtonId };
}

function eventBody(
  session: Pick<SapSession, 'secureId' | 'appName'>,
  eventQueue: string,
): string {
  return new URLSearchParams({
    'sap-charset': 'utf-8',
    'sap-wd-secure-id': session.secureId,
    fesrAppName: session.appName,
    SAPEVENTQUEUE: eventQueue,
  }).toString();
}

function loadingPlaceholderLoad(): string {
  return 'LoadingPlaceHolder_Load~E002Id~E004_loadingPlaceholder_~E003'
    + '~E002ResponseData~E004delta~E005ClientAction~E004submit~E003~E002~E003';
}

async function submitEvent(session: SapSession, eventQueue: string): Promise<string> {
  const response = await request(session.action, {
    method: 'POST',
    headers: {
      accept: 'text/xml, text/html, */*',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: session.cookie,
      'x-requested-with': 'XMLHttpRequest',
      'x-xhr-logon': 'accept',
    },
    body: eventBody(session, eventQueue),
  });
  return response.text();
}

function buttonPress(id: string): string {
  return `Button_Press~E002Id~E004${id}~E003~E002ResponseData~E004delta~E005ClientAction~E004submit~E003~E002~E003`;
}

function linkActivate(id: string): string {
  return `Link_Activate~E002Id~E004${id}~E005Ctrl~E004false~E005Shift~E004false~E003~E002ResponseData~E004delta~E005ClientAction~E004submit~E003~E002~E003`;
}

async function fetchBoard(board: SapERecruitingBoard): Promise<RawJob[]> {
  const parsed = parseSapERecruitingUrl(board.url);
  if (!parsed) throw new Error(`unparseable SAP E-Recruiting URL: ${board.url}`);
  const session = await createSession(board);
  const searchResponse = await submitEvent(session, buttonPress(session.startButtonId));
  const candidates = parseSapERecruitingResults(searchResponse).filter((result) => {
    return /co[\s-]?op|student|intern/i.test(`${result.title} ${result.areaOfExpertise}`);
  });
  const jobs: RawJob[] = [];
  for (const candidate of candidates) {
    try {
      const detailResponse = await submitEvent(session, linkActivate(candidate.controlId));
      const postingUrl = parseSapERecruitingPostingUrl(detailResponse, parsed.origin);
      if (postingUrl) jobs.push(mapSapERecruitingResult(candidate, postingUrl, board));
    } catch {
      // A single stale row must not hide other postings from the same result window.
    }
  }
  if (candidates.length > 0 && jobs.length === 0) {
    throw new Error('SAP E-Recruiting returned candidates but no posting URLs');
  }
  return jobs;
}

async function fetchBoards(boards: SapERecruitingBoard[]): Promise<RawJob[]> {
  const settled = await Promise.allSettled(boards.map(fetchBoard));
  const jobs = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const successes = settled.filter((result) => result.status === 'fulfilled').length;
  if (successes === 0 && boards.length > 0) {
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [`${boards[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    throw new Error(failures.join('; '));
  }
  return jobs;
}

export function sapERecruitingAdapter(
  boards: SapERecruitingBoard[] = SAP_ERECRUITING_BOARDS,
): Adapter {
  return { name: 'sap-erecruiting', fetch: () => fetchBoards(boards) };
}
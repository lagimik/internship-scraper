/**
 * Local dashboard. Reads only from SQLite, never live-scrapes (CLAUDE.md).
 *
 *   npm run web   ->  http://localhost:4000
 */

import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../lib/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);
const JOB_FIT_PATH = resolve(process.env.JT_JOB_FIT_PATH ?? resolve(process.cwd(), 'data/job-fit.json'));

interface JobFitAssessment {
  company: string;
  title: string;
  source_url: string;
  fit: string;
  summary: string;
}

interface JobRow {
  id: string; title: string; company: string; location: string; country: string; region: string | null;
  remote: number; url: string; source: string; sources: string; posted_at: string | null;
  first_seen_at: string; salary_raw: string | null; type: string | null;
  role_category: string | null; matched_by: string | null; location_confidence: string;
  location_matched_by: string | null; work_term_months: number | null;
  work_term_confidence: string;
  fit?: string;
  fit_summary?: string;
}

const db = openDb();
let fitModifiedAt = -1;
let fitByUrl = new Map<string, JobFitAssessment>();
let fitByRole = new Map<string, JobFitAssessment>();

function refreshFitAssessments(): void {
  const modifiedAt = statSync(JOB_FIT_PATH).mtimeMs;
  if (modifiedAt === fitModifiedAt) return;
  const fitData = JSON.parse(readFileSync(JOB_FIT_PATH, 'utf8')) as { roles?: JobFitAssessment[] };
  const assessments = fitData.roles ?? [];
  fitByUrl = new Map(assessments.map((assessment) => [assessment.source_url, assessment]));
  fitByRole = new Map(assessments.map((assessment) => [
    `${assessment.company.trim().toLocaleLowerCase()}\u0000${assessment.title.trim().toLocaleLowerCase()}`,
    assessment,
  ]));
  fitModifiedAt = modifiedAt;
}

/**
 * The WHERE clause for the current view. Shared by the row query and the count, so the
 * header can report "N of M" against the same filters rather than the whole table.
 */
function buildFilter(params: URLSearchParams): { where: string[]; args: Array<string | number> } {
  const where: string[] = [];
  const args: Array<string | number> = [];

  const q = params.get('q')?.trim();
  if (q) {
    where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const [param, col] of [['source', 'source'], ['country', 'country'], ['region', 'region'],
                              ['category', 'role_category']] as const) {
    const v = params.get(param);
    if (v) {
      where.push(`${col} = ?`);
      args.push(v);
    }
  }

  // `type=students` is a grouping, not a stored value: internships arrive labelled
  // either intern or co-op depending on the employer's wording, and they're the same
  // thing to the person job-hunting. Everything else is an exact match.
  const type = params.get('type');
  if (type === 'students') {
    where.push("type IN ('intern', 'co-op')");
  } else if (type) {
    where.push('type = ?');
    args.push(type);
  }
  if (params.get('remote') === '1') where.push('remote = 1');
  if (params.get('confirmed') === '1') where.push("location_confidence = 'confirmed'");

  // No age filter here on purpose: postings older than 30 days are deleted by the
  // scrape (see pruneStale), so everything in the table is current by construction.
  return { where, args };
}

function queryJobs(params: URLSearchParams): JobRow[] {
  refreshFitAssessments();
  const { where, args } = buildFilter(params);

  const dir = params.get('sort') === 'oldest' ? 'ASC' : 'DESC';
  // Name the columns rather than SELECT *: `description` alone is ~32KB across the
  // table and the dashboard never renders it, so it was a third of every response.
  const sql = `SELECT id, title, company, location, country, region, remote, url, source,
                      sources, posted_at, first_seen_at, salary_raw, type,
                      role_category, matched_by, location_confidence, location_matched_by,
                      work_term_months, work_term_confidence
               FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY COALESCE(posted_at, first_seen_at) ${dir}, company ASC
               LIMIT 500`;
  const jobs = db.prepare(sql).all(...args) as unknown as JobRow[];
  for (const job of jobs) {
    if (job.country !== 'CA') continue;
    const roleKey = `${job.company.trim().toLocaleLowerCase()}\u0000${job.title.trim().toLocaleLowerCase()}`;
    const assessment = fitByUrl.get(job.url) ?? fitByRole.get(roleKey);
    if (!assessment) continue;
    job.fit = assessment.fit;
    job.fit_summary = assessment.summary;
  }
  return jobs;
}

/** How many rows match the current filters, ignoring the display limit. */
function countJobs(params: URLSearchParams): number {
  const { where, args } = buildFilter(params);
  const sql = `SELECT COUNT(*) AS n FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return (db.prepare(sql).get(...args) as { n: number }).n;
}

/**
 * Facet counts are the same for every visitor and change only when a scrape writes,
 * but computing them runs five GROUP BY queries over the whole table. On a shared CPU
 * that competes with the scrape running in this same process, so cache them briefly.
 */
let facetCache: { at: number; value: ReturnType<typeof computeFacets> } | null = null;
const FACET_TTL_MS = 30_000;

function facets(): ReturnType<typeof computeFacets> {
  const now = Date.now();
  if (facetCache && now - facetCache.at < FACET_TTL_MS) return facetCache.value;
  const value = computeFacets();
  facetCache = { at: now, value };
  return value;
}

function computeFacets() {
  const col = (c: string) =>
    (db.prepare(`SELECT ${c} AS v, COUNT(*) AS n FROM jobs WHERE ${c} IS NOT NULL AND ${c} != ''
                 GROUP BY ${c} ORDER BY n DESC`).all() as unknown as Array<{ v: string; n: number }>);
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    sources: col('source'),
    countries: col('country'),
    regions: col('region'),
    categories: col('role_category'),
    // Only intern and co-op exist in the db, the scrape drops everything else, so
    // this is a sub-filter between the two, not a way to reach other job types.
    types: col('type'),
    total: one('SELECT COUNT(*) AS n FROM jobs'),
    runs: db.prepare(`SELECT source, ok, kept, inserted, started_at, error FROM runs
                      WHERE id IN (SELECT MAX(id) FROM runs GROUP BY source)
                      ORDER BY source`).all() as unknown as Array<{
                        source: string; ok: number; kept: number; inserted: number;
                        started_at: string; error: string | null }>,
  };
}

/**
 * Failed-login throttle.
 *
 * Basic auth has no lockout of its own, so without this an attacker can guess
 * passwords as fast as the network allows. Only *failures* are counted, a valid
 * session browses freely no matter how many requests it makes.
 */
const MAX_FAILURES = Number(process.env.JT_MAX_FAILURES ?? 10);
const LOCKOUT_MS = Number(process.env.JT_LOCKOUT_MINUTES ?? 15) * 60_000;
/** Cap on tracked IPs, so a spray across many addresses can't exhaust memory. */
const MAX_TRACKED_IPS = 10_000;

const failures = new Map<string, { count: number; until: number }>();

/**
 * The client's address, as reported by the Fly proxy.
 *
 * `fly-client-ip` is set by the proxy itself and cannot be spoofed by the caller;
 * trusting `x-forwarded-for` instead would let anyone reset their own counter by
 * forging a header. Falls back to the socket address when running locally.
 */
function clientIp(req: IncomingMessage): string {
  const flyIp = req.headers['fly-client-ip'];
  if (typeof flyIp === 'string' && flyIp) return flyIp;
  return req.socket.remoteAddress ?? 'unknown';
}

/** Milliseconds remaining on a lockout, or 0 when the caller may try again. */
function lockedFor(ip: string, now = Date.now()): number {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (entry.until <= now) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? entry.until - now : 0;
}

function recordFailure(ip: string, now = Date.now()): void {
  // Opportunistically drop expired entries before growing the map.
  if (failures.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of failures) if (entry.until <= now) failures.delete(key);
    if (failures.size >= MAX_TRACKED_IPS) return; // still full: stop tracking new IPs
  }
  const entry = failures.get(ip);
  // The window slides: each failure pushes the unlock time back out.
  failures.set(ip, { count: (entry?.count ?? 0) + 1, until: now + LOCKOUT_MS });
}

/**
 * Basic auth, enabled only when JT_PASSWORD is set.
 *
 * Locally the variable is unset and the dashboard stays open, exactly as before.
 * On a public host it is set to keep this personal job search private.
 */
function authorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env.JT_PASSWORD;
  if (!expected) return true;

  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const supplied = decoded.slice(decoded.indexOf(':') + 1);

  // Constant-time compare so the password can't be recovered by timing responses.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (process.env.JT_PASSWORD) {
    const ip = clientIp(req);
    const ok = authorized(req);

    if (ok) {
      // Check the password before the lockout, so this is one user's own board and a
      // burst of typos can't shut them out of it. An attacker gains nothing: being
      // let through already required the right password.
      failures.delete(ip);
    } else {
      const waitMs = lockedFor(ip);
      if (waitMs > 0) {
        const seconds = Math.ceil(waitMs / 1000);
        res.writeHead(429, { 'retry-after': String(seconds), 'content-type': 'text/plain' });
        res.end(`Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`);
        return;
      }
      recordFailure(ip);
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="Job Tracker", charset="UTF-8"',
        'content-type': 'text/plain',
      });
      res.end('Authentication required');
      return;
    }
  }

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(HERE, 'index.html'), 'utf8'));
      return;
    }

    if (url.pathname === '/api/jobs') {
      const jobs = queryJobs(url.searchParams);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jobs,
        // How many rows match the current filters, which may exceed the 500 the list
        // query returns. Counting the whole table instead made the header compare the
        // visible rows against postings the filters had deliberately excluded.
        matching: countJobs(url.searchParams),
        facets: facets(),
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// 0.0.0.0 so the process is reachable from outside its container when deployed;
// locally this behaves the same as binding localhost.
server.listen(PORT, '0.0.0.0', () => {
  const { total } = facets();
  const lock = process.env.JT_PASSWORD ? ' [password protected]' : '';
  console.log(`job-tracker → http://localhost:${PORT}  (${total} jobs)${lock}`);
});

/**
 * Export a self-contained, read-only dashboard that can be opened with file://.
 *
 *   npm run export
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(HERE, 'web/index.html');
const CLIENT_PATH = resolve(HERE, 'web/static.js');
const OUTPUT_PATH = resolve(process.env.JT_STATIC_OUTPUT ?? resolve(process.cwd(), 'site/index.html'));
const JOB_FIT_PATH = resolve(process.env.JT_JOB_FIT_PATH ?? resolve(process.cwd(), 'data/job-fit.json'));

interface JobFitAssessment {
  company: string;
  title: string;
  source_url: string;
  fit: string;
  summary: string;
}

interface StaticJob {
  title: string;
  company: string;
  location: string;
  country: string;
  region: string | null;
  remote: number;
  url: string;
  source: string;
  sources: string;
  posted_at: string | null;
  first_seen_at: string;
  salary_raw: string | null;
  type: string | null;
  role_category: string | null;
  location_confidence: string;
  location_matched_by: string | null;
  work_term_months: number | null;
  work_term_confidence: string;
  fit?: string;
  fit_summary?: string;
}

interface Facet {
  v: string;
  n: number;
}

function countBy(jobs: StaticJob[], key: keyof StaticJob): Facet[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const value = job[key];
    if (typeof value === 'string' && value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
}

function matchKey(company: string, title: string): string {
  return `${company.trim().toLocaleLowerCase()}\u0000${title.trim().toLocaleLowerCase()}`;
}

const db = openDb();
try {
  const jobs = db.prepare(`
        SELECT title, company, location, country, region, remote, url, source, sources,
           posted_at, first_seen_at, salary_raw, type, role_category,
          location_confidence, location_matched_by, work_term_months,
          work_term_confidence
    FROM jobs
  `).all() as unknown as StaticJob[];
  const fitData = JSON.parse(readFileSync(JOB_FIT_PATH, 'utf8')) as { roles?: JobFitAssessment[] };
  const assessments = fitData.roles ?? [];
  const fitByUrl = new Map(assessments.map((assessment) => [assessment.source_url, assessment]));
  const fitByRole = new Map(assessments.map((assessment) => [
    matchKey(assessment.company, assessment.title), assessment,
  ]));

  for (const job of jobs) {
    if (job.country !== 'CA') continue;
    const assessment = fitByUrl.get(job.url) ?? fitByRole.get(matchKey(job.company, job.title));
    if (!assessment) continue;
    job.fit = assessment.fit;
    job.fit_summary = assessment.summary;
  }

  const data = {
    generatedAt: new Date().toISOString(),
    jobs,
    facets: {
      sources: countBy(jobs, 'source'),
      countries: countBy(jobs, 'country'),
      regions: countBy(jobs, 'region'),
      categories: countBy(jobs, 'role_category'),
      types: countBy(jobs, 'type'),
      fits: countBy(jobs, 'fit'),
      total: jobs.length,
      runs: db.prepare(`SELECT source, ok, kept, started_at, error FROM runs
                        WHERE id IN (SELECT MAX(id) FROM runs GROUP BY source)
                        ORDER BY source`).all(),
    },
  };

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const client = readFileSync(CLIENT_PATH, 'utf8');
  const scriptStart = template.lastIndexOf('<script>');
  const scriptEnd = template.lastIndexOf('</script>');
  if (scriptStart < 0 || scriptEnd < scriptStart) throw new Error('Dashboard template script was not found');

  // Escaping "<" prevents job text containing "</script>" from ending the data
  // element early. The client reads this as JSON from textContent.
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const scripts = `<script type="application/json" id="dashboard-data">${json}</script>\n<script>\n${client}\n</script>`;
  const dashboardHtml = template.slice(0, scriptStart) + scripts + template.slice(scriptEnd + '</script>'.length);
  const analytics = `<script data-goatcounter="https://lagimik.goatcounter.com/count"\n        async src="//gc.zgo.at/count.js"></script>`;
  const html = dashboardHtml.replace('</head>', `${analytics}\n</head>`);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  writeFileSync(temporaryPath, html, 'utf8');
  renameSync(temporaryPath, OUTPUT_PATH);
  console.log(`static dashboard → ${OUTPUT_PATH} (${jobs.length} jobs)`);
} finally {
  db.close();
}
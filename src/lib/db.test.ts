import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, upsertJobs } from './db.js';
import type { JobPosting } from '../types.js';

test('db: stores country, region, and work-term metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-tracker-'));
  const db = openDb(join(directory, 'jobs.db'));
  const job: JobPosting = {
    id: 'test-us-job', title: 'Mechanical Engineer Intern - 4 months', company: 'Acme',
    location: 'Austin, TX', country: 'US', region: 'TX', remote: false,
    url: 'https://example.com/job', source: 'test', postedAt: null,
    firstSeenAt: new Date().toISOString(), salaryRaw: null, salaryMin: null,
    salaryMax: null, salaryCurrency: null, type: 'intern',
    roleCategory: 'mechanical-engineering', matchedBy: 'mechanical-engineering',
    locationConfidence: 'confirmed', locationMatchedBy: 'state-code:TX',
    workTermMonths: 4, workTermConfidence: 'confirmed', workTermMatchedBy: '4 months',
    sponsorship: null, description: null, status: 'new',
  };

  try {
    assert.deepEqual(upsertJobs(db, [job]), { inserted: 1, updated: 0, newJobs: [job] });
    const row = db.prepare(`
      SELECT country, region, work_term_months, work_term_confidence FROM jobs WHERE id = ?
    `).get(job.id) as Record<string, unknown>;
    assert.deepEqual({ ...row }, {
      country: 'US', region: 'TX', work_term_months: 4, work_term_confidence: 'confirmed',
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
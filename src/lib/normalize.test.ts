/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.js';
import type { RawJob } from '../types.js';

function raw(over: Partial<RawJob>): RawJob {
  return {
    title: 'Mechanical Engineer Intern',
    company: 'Acme',
    location: 'Toronto, ON',
    remote: false,
    url: 'https://example.com/1',
    source: 'test',
    postedAt: null,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: null,
    sponsorship: null,
    description: null,
    ...over,
  };
}

test('normalize: keeps only internships and co-ops', () => {
  const { keptJobs, droppedNotStudent } = normalize([
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', url: 'https://x/1' }),
    raw({ title: 'Mechatronics Engineer Co-op', description: 'Work term: Winter 2027', url: 'https://x/2' }),
    raw({ title: 'Senior Mechanical Engineer', description: 'Work term: Winter 2027', url: 'https://x/3' }),
    raw({ title: 'Mechanical Engineer, New Grad', description: 'Work term: Winter 2027', url: 'https://x/4' }),
  ]);

  assert.equal(keptJobs.length, 2);
  assert.equal(droppedNotStudent, 2); // the senior and new-grad roles
  assert.deepEqual(
    keptJobs.map((j) => j.type).sort(),
    ['co-op', 'intern'],
  );
});

test('normalize: an adapter-supplied type outranks the title guess', () => {
  // Ashby states employmentType outright; a title with no intern wording still counts.
  const { keptJobs } = normalize([
    raw({ title: 'Mechanical Design Engineer', description: 'Work term: Winter 2027', type: 'intern', url: 'https://x/5' }),
  ]);
  assert.equal(keptJobs.length, 1);
  assert.equal(keptJobs[0]?.type, 'intern');
});

test('normalize: postings older than the cutoff never enter the database', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const { keptJobs, droppedStale } = normalize([
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', postedAt: daysAgo(2), url: 'https://x/1' }),
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', postedAt: daysAgo(29), url: 'https://x/2', company: 'B' }),
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', postedAt: daysAgo(45), url: 'https://x/3', company: 'C' }),
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', postedAt: daysAgo(400), url: 'https://x/4', company: 'D' }),
    // No date: kept, since a third of rows come from lists with no date column and
    // rejecting them would discard current postings too.
    raw({ title: 'Mechanical Engineer Intern', description: 'Work term: Winter 2027', postedAt: null, url: 'https://x/5', company: 'E' }),
  ]);

  assert.equal(droppedStale, 2);
  assert.deepEqual(keptJobs.map((j) => j.company).sort(), ['Acme', 'B', 'E']);
});

test('normalize: keeps Canadian and US internships as separate country listings', () => {
  const { keptJobs, droppedNotTargetCountry } = normalize([
    raw({ title: 'Mechanical Engineer Intern - Winter 2027', location: 'Austin, TX', url: 'https://x/6' }),
    raw({ title: 'Mechanical Engineer Intern - Hiver 2027', location: 'Toronto, ON', company: 'B', url: 'https://x/7' }),
    raw({ title: 'Mechanical Engineer Intern - Winter 2027', location: 'Berlin, Germany', company: 'C', url: 'https://x/8' }),
  ]);
  assert.deepEqual(keptJobs.map((job) => [job.country, job.region]), [['US', 'TX'], ['CA', 'ON']]);
  assert.equal(keptJobs[0]?.workTermMonths, 4);
  assert.equal(droppedNotTargetCountry, 1);
});

test('normalize: rejects incompatible and unspecified work terms', () => {
  const { keptJobs, droppedWrongTerm } = normalize([
    raw({ title: 'Mechanical Engineer Intern - Winter 2027 - 8 months', url: 'https://x/9' }),
    raw({ title: 'Mechanical Engineer Intern', company: 'B', url: 'https://x/10' }),
    raw({ title: 'Mechanical Engineer Intern - Winter 2027', company: 'C', url: 'https://x/11' }),
  ]);
  assert.equal(keptJobs.length, 1);
  assert.equal(keptJobs[0]?.workTermConfidence, 'inferred');
  assert.equal(droppedWrongTerm, 2);
});

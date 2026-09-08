import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHBY_BOARDS, mapAshbyJob, parseAshbyUrl } from './ashby.js';

test('ashby: supplied Rivian VW URL preserves its exact board token', () => {
  assert.deepEqual(parseAshbyUrl('https://jobs.ashbyhq.com/rivianvw.tech'), {
    token: 'rivianvw.tech',
  });
  assert.ok(ASHBY_BOARDS.some((board) =>
    board.token === 'rivianvw.tech'
    && board.name === 'Rivian and Volkswagen Group Technologies'));
  assert.equal(parseAshbyUrl('https://example.com/rivianvw.tech'), null);
});

test('ashby: public posting maps the Canadian Vehicle Controls internship', () => {
  const job = mapAshbyJob({
    id: 'e00c49b7-44c1-4f0c-af3c-2c7a7402185b',
    title: 'Software Engineering Intern - Vehicle Controls (January - August 2027)',
    department: 'Technology and Innovation',
    team: 'Technology and Innovation',
    employmentType: 'Intern',
    location: 'Vancouver, British Columbia',
    secondaryLocations: [],
    publishedAt: '2026-09-08T18:32:56.875+00:00',
    isListed: true,
    isRemote: true,
    address: {
      postalAddress: {
        addressRegion: 'British Columbia',
        addressCountry: 'Canada',
        addressLocality: 'Vancouver',
      },
    },
    jobUrl: 'https://jobs.ashbyhq.com/rivianvw.tech/e00c49b7-44c1-4f0c-af3c-2c7a7402185b',
    applyUrl: 'https://jobs.ashbyhq.com/rivianvw.tech/e00c49b7-44c1-4f0c-af3c-2c7a7402185b/application',
    descriptionPlain: 'Candidates should be available from January 11 to August 13, 2027.',
    compensation: {
      compensationTierSummary: 'CA$30.00 – CA$33.75 per hour • Eligible for housing stipend',
      scrapeableCompensationSalarySummary: null,
    },
  }, {
    token: 'rivianvw.tech',
    name: 'Rivian and Volkswagen Group Technologies',
  });

  assert.equal(job.title, 'Software Engineering Intern - Vehicle Controls (January - August 2027)');
  assert.equal(job.company, 'Rivian and Volkswagen Group Technologies');
  assert.equal(job.location, 'Vancouver, British Columbia; Canada');
  assert.equal(job.url, 'https://jobs.ashbyhq.com/rivianvw.tech/e00c49b7-44c1-4f0c-af3c-2c7a7402185b');
  assert.equal(job.source, 'ashby');
  assert.equal(job.postedAt, '2026-09-08T18:32:56.875+00:00');
  assert.equal(job.remote, true);
  assert.equal(job.type, 'intern');
  assert.equal(job.salaryRaw, 'CA$30.00 – CA$33.75 per hour • Eligible for housing stipend');
  assert.match(job.description ?? '', /January 11 to August 13, 2027/);
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAMBOOHR_BOARDS, parseBambooHrPosting, parseBambooHrUrl } from './bamboohr.js';

test('bamboohr: Eavor posting URL decomposes into tenant API parts', () => {
  assert.deepEqual(parseBambooHrUrl('https://eavortechnologies.bamboohr.com/careers/134'), {
    origin: 'https://eavortechnologies.bamboohr.com',
    tenant: 'eavortechnologies',
  });
  assert.ok(BAMBOOHR_BOARDS.some((board) => (
    board.url === 'https://eavortechnologies.bamboohr.com/careers'
    && board.name === 'Eavor Technologies'
  )));
});

test('bamboohr: Eavor detail record maps canonical posting fields', () => {
  const board = {
    url: 'https://eavortechnologies.bamboohr.com/careers',
    name: 'Eavor Technologies',
  };
  const parsed = parseBambooHrUrl(board.url);
  assert.ok(parsed);
  const job = parseBambooHrPosting({
    id: '134',
    jobOpeningName: 'Senior Simulation Engineer',
    jobOpeningStatus: 'Open',
    employmentStatusLabel: 'Full-Time',
    location: { city: 'Calgary', state: 'Alberta', addressCountry: 'Canada' },
    atsLocation: { country: null, state: null, city: null },
    description: '<p>This is a hands-on solver development role.</p>',
    compensation: null,
    datePosted: '2026-08-14',
    locationType: '0',
    jobOpeningShareUrl: 'https://eavortechnologies.bamboohr.com/careers/134',
  }, board, parsed);
  assert.ok(job);
  assert.equal(job.title, 'Senior Simulation Engineer');
  assert.equal(job.company, 'Eavor Technologies');
  assert.equal(job.location, 'Calgary, Alberta, Canada');
  assert.equal(job.url, 'https://eavortechnologies.bamboohr.com/careers/134');
  assert.equal(job.source, 'bamboohr');
  assert.equal(job.postedAt, '2026-08-14T00:00:00.000Z');
  assert.match(job.description ?? '', /hands-on solver development/);
});

test('bamboohr: Giatec posting URL decomposes into tenant API parts', () => {
  assert.deepEqual(parseBambooHrUrl('https://giatecscientific.bamboohr.com/careers/301'), {
    origin: 'https://giatecscientific.bamboohr.com',
    tenant: 'giatecscientific',
  });
});

test('bamboohr: Giatec detail record maps canonical posting fields', () => {
  const board = {
    url: 'https://giatecscientific.bamboohr.com/careers',
    name: 'Giatec Scientific',
  };
  const parsed = parseBambooHrUrl(board.url);
  assert.ok(parsed);
  const job = parseBambooHrPosting({
    id: '301',
    jobOpeningName: 'Lead Support Engineer, Bedrock ',
    jobOpeningStatus: 'Open',
    employmentStatusLabel: 'Full-Time',
    location: { city: 'Ottawa', state: 'Ontario', addressCountry: 'Canada' },
    atsLocation: { country: null, state: null, city: null },
    compensation: '$125,000 to $155,000',
    datePosted: '2026-08-24',
    locationType: '2',
    jobOpeningShareUrl: 'https://giatecscientific.bamboohr.com/careers/301',
  }, board, parsed);
  assert.ok(job);
  assert.equal(job.title, 'Lead Support Engineer, Bedrock');
  assert.equal(job.company, 'Giatec Scientific');
  assert.equal(job.location, 'Ottawa, Ontario, Canada');
  assert.equal(job.url, 'https://giatecscientific.bamboohr.com/careers/301');
  assert.equal(job.source, 'bamboohr');
  assert.equal(job.postedAt, '2026-08-24T00:00:00.000Z');
  assert.equal(job.salaryRaw, '$125,000 to $155,000');
  assert.equal(job.type, 'full-time');
});
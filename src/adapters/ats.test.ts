import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLeverPosting, parseLeverUrl } from './ats.js';

test('lever: supplied Kepler URL preserves its exact board token', () => {
  assert.deepEqual(parseLeverUrl('https://jobs.lever.co/kepler'), { token: 'kepler' });
  assert.deepEqual(
    parseLeverUrl('https://jobs.lever.co/kepler/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1'),
    { token: 'kepler' },
  );
  assert.equal(parseLeverUrl('https://example.com/kepler'), null);
});

test('lever: public posting maps to the canonical Kepler internship', () => {
  const job = mapLeverPosting({
    id: '2ad02ce3-1d56-4aee-9f1d-5199c780c0c1',
    text: 'Embedded Software Engineering Intern (January 2027) (4 months)',
    hostedUrl: 'https://jobs.lever.co/kepler/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1',
    createdAt: 1787160427198,
    categories: {
      location: 'Toronto, Ontario',
      allLocations: ['Toronto, Ontario'],
      commitment: 'Intern/Co-op',
      team: 'Internship',
    },
  }, { token: 'kepler', name: 'Kepler Communications' });

  assert.equal(job.title, 'Embedded Software Engineering Intern (January 2027) (4 months)');
  assert.equal(job.company, 'Kepler Communications');
  assert.equal(job.location, 'Toronto, Ontario');
  assert.equal(job.url, 'https://jobs.lever.co/kepler/2ad02ce3-1d56-4aee-9f1d-5199c780c0c1');
  assert.equal(job.source, 'lever');
  assert.equal(job.postedAt, '2026-08-19T17:27:07.198Z');
  assert.equal(job.description, 'Internship');
});

test('lever: supplied Waabi URL preserves its exact board token', () => {
  assert.deepEqual(parseLeverUrl('https://jobs.lever.co/waabi'), { token: 'waabi' });
});

test('lever: public posting maps to the canonical Waabi internship', () => {
  const job = mapLeverPosting({
    id: '0fd4e30b-9bd1-4b53-9043-6088457363cb',
    text: 'Research Internship/Co-op',
    hostedUrl: 'https://jobs.lever.co/waabi/0fd4e30b-9bd1-4b53-9043-6088457363cb',
    createdAt: 1766095735237,
    categories: {
      location: 'Toronto, ON',
      allLocations: ['Toronto, ON', 'San Francisco, CA', 'Remote US'],
      commitment: 'Intern',
      team: 'Research',
    },
  }, { token: 'waabi', name: 'Waabi' });

  assert.equal(job.title, 'Research Internship/Co-op');
  assert.equal(job.company, 'Waabi');
  assert.equal(job.location, 'Toronto, ON, San Francisco, CA, Remote US');
  assert.equal(job.remote, true);
  assert.equal(job.url, 'https://jobs.lever.co/waabi/0fd4e30b-9bd1-4b53-9043-6088457363cb');
  assert.equal(job.source, 'lever');
  assert.equal(job.postedAt, '2025-12-18T22:08:55.237Z');
  assert.equal(job.description, 'Research');
});

test('lever: supplied Promise Robotics URL and posting preserve live identifiers', () => {
  const url = 'https://jobs.lever.co/promiserobotics/0760cec9-1d24-4f04-8dbd-715185b577c7';
  assert.deepEqual(parseLeverUrl(url), { token: 'promiserobotics' });

  const job = mapLeverPosting({
    id: '0760cec9-1d24-4f04-8dbd-715185b577c7',
    text: 'Industrial Engineer',
    hostedUrl: url,
    createdAt: 1783701160827,
    categories: {
      location: 'Calgary, AB',
      allLocations: ['Calgary, AB'],
      commitment: 'Full Time',
      team: 'Operations',
    },
  }, { token: 'promiserobotics', name: 'Promise Robotics' });

  assert.equal(job.title, 'Industrial Engineer');
  assert.equal(job.company, 'Promise Robotics');
  assert.equal(job.location, 'Calgary, AB');
  assert.equal(job.url, url);
  assert.equal(job.source, 'lever');
  assert.equal(job.postedAt, '2026-07-10T16:32:40.827Z');
  assert.equal(job.description, 'Operations');
});
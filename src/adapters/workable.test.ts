import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWorkablePosting, parseWorkableUrl, workableAdapter } from './workable.js';

test('workable: BOS URL preserves its verified account slug', () => {
  assert.deepEqual(parseWorkableUrl('https://apply.workable.com/bos-innovations/'), {
    account: 'bos-innovations',
  });
  assert.deepEqual(
    parseWorkableUrl('https://apply.workable.com/bos-innovations/j/CC12858E9E/'),
    { account: 'bos-innovations' },
  );
  assert.equal(parseWorkableUrl('https://example.com/bos-innovations/'), null);
});

test('workable: public API posting maps to the canonical BOS job', () => {
  assert.equal(workableAdapter().name, 'workable');
  const job = mapWorkablePosting({
    id: 6074963,
    shortcode: 'CC12858E9E',
    title: 'Senior Project Manager - Industrial Automation',
    remote: false,
    location: { country: 'Canada', countryCode: 'CA', city: 'London', region: 'Ontario' },
    locations: [
      { country: 'Canada', countryCode: 'CA', city: 'London', region: 'Ontario', hidden: false },
    ],
    published: '2026-09-02T00:00:00.000Z',
    type: 'full',
    workplace: 'on_site',
    description: '<p>Lead industrial automation projects.</p>',
    requirements: '<p>Applicants must be eligible to work in Canada.</p>',
  }, {
    url: 'https://apply.workable.com/bos-innovations/',
    name: 'BOS Innovations',
  }, 'bos-innovations');

  assert.equal(job.title, 'Senior Project Manager - Industrial Automation');
  assert.equal(job.company, 'BOS Innovations');
  assert.equal(job.location, 'London, Ontario, Canada');
  assert.equal(job.url, 'https://apply.workable.com/bos-innovations/j/CC12858E9E/');
  assert.equal(job.source, 'workable');
  assert.equal(job.postedAt, '2026-09-02T00:00:00.000Z');
  assert.equal(job.remote, false);
  assert.equal(job.type, null);
  assert.match(job.description ?? '', /Lead industrial automation projects/);
  assert.equal(job.sponsorship, 'Applicants must be eligible to work in Canada.');
});
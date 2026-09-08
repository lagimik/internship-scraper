import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collageAdapter, parseCollageBoard, parseCollageUrl } from './collage.js';

test('collage: NordSpace URL preserves the verified board identifier', () => {
  assert.deepEqual(parseCollageUrl('https://secure.collage.co/jobs/nordspace/'), {
    origin: 'https://secure.collage.co',
    board: 'nordspace',
  });
  assert.deepEqual(parseCollageUrl('https://secure.collage.co/jobs/nordspace/64869'), {
    origin: 'https://secure.collage.co',
    board: 'nordspace',
  });
  assert.equal(parseCollageUrl('https://example.com/jobs/nordspace/'), null);
});

test('collage: open cards map metadata and closed cards are excluded', () => {
  assert.equal(collageAdapter().name, 'collage');
  const board = {
    name: 'NordSpace Corp',
    url: 'https://secure.collage.co/jobs/nordspace/',
  };
  const parsed = parseCollageUrl(board.url);
  assert.ok(parsed);
  const jobs = parseCollageBoard(`
    <ul>
      <li><a class="clearfix table" href="/jobs/nordspace/70001">
        <span class="ATS-position-title">Mechanical Engineering Co-op</span>
        <span class="ATS-commitment-and-location">Co-op • Markham, ON</span>
      </a></li>
      <li><a class="clearfix table" href="/jobs/nordspace/64869">
        <span class="ATS-position-title">Launch Systems Engineering Intern</span>
        <span class="ATS-commitment-and-location">Intern • Markham, ON</span>
        <img alt="position-closed" src="/assets/position-closed.svg">
      </a></li>
    </ul>`, board, parsed);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.title, 'Mechanical Engineering Co-op');
  assert.equal(jobs[0]?.company, 'NordSpace Corp');
  assert.equal(jobs[0]?.location, 'Markham, ON');
  assert.equal(jobs[0]?.url, 'https://secure.collage.co/jobs/nordspace/70001');
  assert.equal(jobs[0]?.source, 'collage');
  assert.equal(jobs[0]?.type, 'co-op');
});
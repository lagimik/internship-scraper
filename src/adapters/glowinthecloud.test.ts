import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  folksAdapter,
  parseGlowInTheCloudBoard,
  parseGlowInTheCloudUrl,
} from './glowinthecloud.js';

test('glowinthecloud: Avianor URL preserves company slug and locale', () => {
  assert.deepEqual(parseGlowInTheCloudUrl('https://jobs.glowinthecloud.com/avianor?l=en'), {
    origin: 'https://jobs.glowinthecloud.com',
    board: 'avianor',
    locale: 'en',
  });
  assert.deepEqual(parseGlowInTheCloudUrl(
    'https://jobs.glowinthecloud.com/avianor/20260814001?l=en',
  ), {
    origin: 'https://jobs.glowinthecloud.com',
    board: 'avianor',
    locale: 'en',
  });
  assert.equal(parseGlowInTheCloudUrl('https://example.com/avianor'), null);
});

test('glowinthecloud: public card maps Avianor job metadata', () => {
  assert.equal(folksAdapter().name, 'folks');
  const board = { url: 'https://jobs.glowinthecloud.com/avianor?l=en', name: 'Avianor' };
  const [job] = parseGlowInTheCloudBoard(`
    <ul><li><div>
      <span class="job-title"><a href="/avianor/20260814001?l=en">
        Aircraft Interior Technician
      </a></span>
      <ul class="job-listing-features">
        <li title="Address"><span>11805 Rue Service A 5, Mirabel, QC J7N 1G1, Canada</span></li>
        <li title="Job types"><span>Day, Evening, Permanent</span></li>
        <li title="Salary">22.94$ - 34.41$ per hour</li>
      </ul>
    </div></li></ul>
  `, board);

  assert.deepEqual(job, {
    title: 'Aircraft Interior Technician',
    company: 'Avianor',
    location: '11805 Rue Service A 5, Mirabel, QC J7N 1G1, Canada',
    remote: false,
    url: 'https://jobs.glowinthecloud.com/avianor/20260814001?l=en',
    source: 'folks',
    postedAt: null,
    salaryRaw: '22.94$ - 34.41$ per hour',
    salaryMin: 22.94,
    salaryMax: 34.41,
    salaryCurrency: 'CAD',
    type: null,
    sponsorship: null,
    description: 'Day, Evening, Permanent',
  });
});
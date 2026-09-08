import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaleoSocialPage,
  parseTaleoSocialUrl,
  TALEO_SOCIAL_BOARDS,
} from './taleo-social.js';

const suppliedUrl = 'https://jobs.arup.com/jobs/search/21004882';

test('taleo-social: supplied Arup URL preserves its saved-search identifier', () => {
  assert.deepEqual(parseTaleoSocialUrl(suppliedUrl), {
    origin: 'https://jobs.arup.com',
    searchId: '21004882',
  });
  assert.equal(parseTaleoSocialUrl('https://example.com/not-a-search'), null);
  assert.ok(TALEO_SOCIAL_BOARDS.some(({ name, url }) => name === 'Arup'
    && url === 'https://jobs.arup.com/jobs/search/21005057'));
});

test('taleo-social: Arup result row maps canonical job fields', () => {
  const board = { name: 'Arup', url: 'https://jobs.arup.com/jobs/search/21005057' };
  const page = parseTaleoSocialPage(`
    <input id="tsstoken" value="public-token">
    <div class="jResultsContent" data-jsid="21005057">
      <div>28 results</div>
      <div id="job_list_33038" class="job_list_row jlr_Odd">
        <a class="job_link" href="https://jobs.arup.com/jobs/canada-renewable-energy-project-leader-33038">Canada Renewable Energy Project Leader</a>
        <span class="location">Toronto, Ontario, Canada</span>
        <span class="category">Advisory</span>
        <p class="jlr_description">Lead renewable energy projects across Canada.</p>
      </div>
    </div>
  `, board);

  assert.equal(page.total, 28);
  assert.equal(page.searchId, '21005057');
  assert.equal(page.token, 'public-token');
  assert.deepEqual(page.jobs[0], {
    title: 'Canada Renewable Energy Project Leader',
    company: 'Arup',
    location: 'Toronto, Ontario, Canada',
    remote: false,
    url: 'https://jobs.arup.com/jobs/canada-renewable-energy-project-leader-33038',
    source: 'taleo-social',
    postedAt: null,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: null,
    sponsorship: null,
    description: 'Category: Advisory; Lead renewable energy projects across Canada.',
  });
});
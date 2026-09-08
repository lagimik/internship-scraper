import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapWorkdayPosting,
  parseWorkdayUrl,
  WORKDAY_BOARDS,
} from './workday.js';

test('workday: supplied Airbus URL preserves its Canadian country facet', () => {
  const url = 'https://ag.wd3.myworkdayjobs.com/Airbus?locationCountry=a30a87ed25634629aa6c3958aa2b91ea';
  assert.ok(WORKDAY_BOARDS.some((board) => board.name === 'Airbus' && board.url === url));
  const parsed = parseWorkdayUrl(url);
  assert.deepEqual(parsed, {
    host: 'ag',
    dc: 'wd3',
    tenant: 'ag',
    site: 'Airbus',
    origin: 'https://ag.wd3.myworkdayjobs.com',
    appliedFacets: {
      locationCountry: ['a30a87ed25634629aa6c3958aa2b91ea'],
    },
  });
  assert.ok(parsed);

  const job = mapWorkdayPosting({
    title: 'Superviseur opération - Atelier Peinture (Jour) / Production supervisor - Paintshop (day)',
    externalPath: '/job/Montreal-Area/Superviseur-opration---Atelier-Peinture--Jour----Production-supervisor---Paintshop--day-_JR10415932',
    locationsText: 'Montreal Area',
    postedOn: 'Posted Yesterday',
    bulletFields: ['JR10415932'],
  }, { url, name: 'Airbus' }, parsed);

  assert.equal(job.company, 'Airbus');
  assert.equal(job.location, 'Montreal Area');
  assert.equal(job.url, 'https://ag.wd3.myworkdayjobs.com/en-US/Airbus/job/Montreal-Area/Superviseur-opration---Atelier-Peinture--Jour----Production-supervisor---Paintshop--day-_JR10415932');
  assert.equal(job.source, 'workday');
});
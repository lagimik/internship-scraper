import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adpAdapter, mapAdpRequisition, parseAdpUrl } from './adp.js';

const board = {
  url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=3196ba6f-d49c-4493-9290-3d91489bdfa9&ccId=19000101_000001&type=JS&lang=en_CA',
  name: 'General Fusion',
};

test('adp: supplied Workforce Now URL preserves its board identifiers', () => {
  assert.deepEqual(parseAdpUrl(board.url), {
    origin: 'https://workforcenow.adp.com',
    cid: '3196ba6f-d49c-4493-9290-3d91489bdfa9',
    ccId: '19000101_000001',
    lang: 'en_CA',
  });
  assert.equal(parseAdpUrl('https://example.com/careers?cid=x&ccId=y'), null);
});

test('adp: public requisition maps to a canonical General Fusion posting', () => {
  const parsed = parseAdpUrl(board.url);
  assert.ok(parsed);
  const job = mapAdpRequisition({
    itemID: '9201434816694_1',
    requisitionTitle: 'Analytical Mechanical Engineer',
    postDate: '2026-08-24T13:58:00.000-04:00',
    requisitionDescription: '<p>Design and analyze mechanical systems.</p>',
    requisitionLocations: [{
      nameCode: { shortName: ' Richmond, BC, CA' },
      address: { cityName: 'Richmond', countrySubdivisionLevel1: { codeValue: 'BC' } },
    }],
    payGradeRange: {
      minimumRate: { amountValue: 95000, currencyCode: 'CAD' },
      maximumRate: { amountValue: 115000, currencyCode: 'CAD' },
    },
    customFieldGroup: { stringFields: [{
      stringValue: '567472',
      nameCode: { codeValue: 'ExternalJobID' },
    }] },
  }, board, parsed);

  assert.ok(job);
  assert.equal(adpAdapter().name, 'adp');
  assert.equal(job.title, 'Analytical Mechanical Engineer');
  assert.equal(job.company, 'General Fusion');
  assert.equal(job.location, 'Richmond, BC, CA');
  assert.equal(job.url, `${board.url.replace('type=JS', 'type=MP')}&jobId=567472`);
  assert.equal(job.source, 'adp');
  assert.equal(job.salaryMin, 95000);
  assert.equal(job.salaryMax, 115000);
  assert.equal(job.salaryCurrency, 'CAD');
  assert.equal(job.description, 'Design and analyze mechanical systems.');
});
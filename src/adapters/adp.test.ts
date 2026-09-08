import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adpAdapter, mapAdpPosting, mapAdpRequisition, parseAdpUrl } from './adp.js';

const generalFusionBoard = {
  url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=3196ba6f-d49c-4493-9290-3d91489bdfa9&ccId=19000101_000001&type=JS&lang=en_CA',
  name: 'General Fusion',
};
const marmenUrl = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=6008c003-f9a4-47a3-8573-a3b0d594bcba&ccId=9201209146560_3&lang=fr_CA&jobId=577655&jwId=9201209146560_1';

test('adp: Workforce Now URLs preserve their available board identifiers', () => {
  assert.deepEqual(parseAdpUrl(generalFusionBoard.url), {
    origin: 'https://workforcenow.adp.com',
    cid: '3196ba6f-d49c-4493-9290-3d91489bdfa9',
    ccId: '19000101_000001',
    lang: 'en_CA',
  });
  assert.deepEqual(parseAdpUrl(marmenUrl), {
    origin: 'https://workforcenow.adp.com',
    cid: '6008c003-f9a4-47a3-8573-a3b0d594bcba',
    ccId: '9201209146560_3',
    jwId: '9201209146560_1',
    lang: 'fr_CA',
  });
  assert.equal(parseAdpUrl('https://example.com/careers?cid=x&ccId=y'), null);
});

test('adp: public requisition maps to a canonical General Fusion posting', () => {
  const parsed = parseAdpUrl(generalFusionBoard.url);
  assert.ok(parsed);
  const job = mapAdpRequisition({
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
  }, generalFusionBoard, parsed);

  assert.ok(job);
  assert.equal(adpAdapter().name, 'adp');
  assert.equal(job.title, 'Analytical Mechanical Engineer');
  assert.equal(job.company, 'General Fusion');
  assert.equal(job.location, 'Richmond, BC, CA');
  assert.equal(job.url, `${generalFusionBoard.url.replace('type=JS', 'type=MP')}&jobId=567472`);
  assert.equal(job.salaryMin, 95000);
  assert.equal(job.salaryMax, 115000);
  assert.equal(job.salaryCurrency, 'CAD');
  assert.equal(job.description, 'Design and analyze mechanical systems.');
});

test('adp: public API posting maps to the canonical Marmen internship', () => {
  const job = mapAdpPosting({
    requisitionTitle: 'Stagiaire - Génie mécanique - Fab. mécanosoudée (3e année H2027)',
    postDate: '2026-09-02T10:30:00.000-04:00',
    workLevelCode: { shortName: 'Stagiaire temps plein' },
    customFieldGroup: {
      stringFields: [{ stringValue: '577655', nameCode: { codeValue: 'ExternalJobID' } }],
    },
    requisitionLocations: [{
      nameCode: { shortName: ' Trois-Rivières, QC, CA' },
      address: { cityName: 'Trois-Rivières', countrySubdivisionLevel1: { codeValue: 'QC' } },
    }],
    requisitionDescription: '<h5>Stage rémunéré</h5><p>Participez à la fabrication mécanique.</p>',
  }, { url: marmenUrl, name: 'Marmen' });

  assert.ok(job);
  assert.equal(job.title, 'Stagiaire - Génie mécanique - Fab. mécanosoudée (3e année H2027)');
  assert.equal(job.company, 'Marmen');
  assert.equal(job.location, 'Trois-Rivières, QC, CA');
  assert.equal(job.url, marmenUrl);
  assert.equal(job.type, 'intern');
  assert.match(job.description ?? '', /Stage rémunéré/);
});
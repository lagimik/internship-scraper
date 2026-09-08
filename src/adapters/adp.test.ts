import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adpAdapter, mapAdpPosting, parseAdpUrl } from './adp.js';

const suppliedUrl = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=6008c003-f9a4-47a3-8573-a3b0d594bcba&ccId=9201209146560_3&lang=fr_CA&jobId=577655&jwId=9201209146560_1';

test('adp: supplied Marmen URL preserves every public API identifier', () => {
  assert.deepEqual(parseAdpUrl(suppliedUrl), {
    origin: 'https://workforcenow.adp.com',
    cid: '6008c003-f9a4-47a3-8573-a3b0d594bcba',
    ccId: '9201209146560_3',
    jwId: '9201209146560_1',
    lang: 'fr_CA',
  });
  assert.equal(parseAdpUrl('https://example.com/recruitment.html?cid=x'), null);
});

test('adp: public API posting maps to the canonical Marmen internship', () => {
  assert.equal(adpAdapter().name, 'adp');
  const job = mapAdpPosting({
    itemID: '9201300960629_1',
    requisitionTitle: 'Stagiaire - Génie mécanique - Fab. mécanosoudée (3e année H2027)',
    postDate: '2026-09-02T10:30:00.000-04:00',
    workLevelCode: { shortName: 'Stagiaire temps plein' },
    clientRequisitionID: '1255',
    customFieldGroup: {
      stringFields: [
        { stringValue: '577655', nameCode: { codeValue: 'ExternalJobID' } },
      ],
    },
    requisitionLocations: [{
      nameCode: { shortName: ' Trois-Rivières, QC, CA' },
      address: {
        cityName: 'Trois-Rivières',
        countrySubdivisionLevel1: { codeValue: 'QC' },
        postalCode: 'G8T 8Y8',
      },
    }],
    sponsoredVisaTypeCodes: [],
    requisitionDescription: '<h5>Stage rémunéré</h5><p>Participez à la fabrication mécanique.</p>',
  }, { url: suppliedUrl, name: 'Marmen' });

  assert.ok(job);
  assert.equal(job.title, 'Stagiaire - Génie mécanique - Fab. mécanosoudée (3e année H2027)');
  assert.equal(job.company, 'Marmen');
  assert.equal(job.location, 'Trois-Rivières, QC, CA');
  assert.equal(job.url, suppliedUrl);
  assert.equal(job.source, 'adp');
  assert.equal(job.postedAt, '2026-09-02T10:30:00.000-04:00');
  assert.equal(job.type, 'intern');
  assert.match(job.description ?? '', /Stage rémunéré/);
});
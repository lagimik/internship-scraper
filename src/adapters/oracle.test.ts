import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOracleRequisition, ORACLE_BOARDS, parseOracleUrl } from './oracle.js';

const suppliedUrl = 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=AttributeChar4&mode=location&selectedFlexFieldsFacets=%22AttributeChar4%7CGraduates%3BTrainees%22';

test('oracle: supplied Wood URL preserves its site and graduate trainee facet', () => {
  assert.ok(ORACLE_BOARDS.some((board) => board.name === 'Wood' && board.url === suppliedUrl));
  assert.deepEqual(parseOracleUrl(suppliedUrl), {
    origin: 'https://ehif.fa.em2.oraclecloud.com',
    language: 'en',
    site: 'CX_1',
    lastSelectedFacet: 'AttributeChar4',
    selectedFlexFieldsFacets: 'AttributeChar4|Graduates;Trainees',
  });
});

test('oracle: faceted search record maps to the canonical Canadian Wood job', () => {
  const parsed = parseOracleUrl(suppliedUrl);
  assert.ok(parsed);
  const job = mapOracleRequisition({
    id: '30933',
    title: 'Instrumentation & Controls Engineer in Training',
    primaryLocation: 'Trail, BC, Canada',
    workplaceType: 'Hybrid',
    workplaceTypeCode: 'ORA_HYBRID',
    postedDate: '2026-07-15',
    shortDescriptionStr: 'Wood is recruiting an Engineer in Training in Trail, BC.',
    workerType: undefined,
    contractType: undefined,
    jobType: undefined,
  }, { url: suppliedUrl, name: 'Wood' }, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Instrumentation & Controls Engineer in Training');
  assert.equal(job.company, 'Wood');
  assert.equal(job.location, 'Trail, BC, Canada');
  assert.equal(job.url, 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/30933');
  assert.equal(job.source, 'oracle');
  assert.equal(job.postedAt, '2026-07-15T00:00:00.000Z');
  assert.match(job.description ?? '', /Engineer in Training/);
});
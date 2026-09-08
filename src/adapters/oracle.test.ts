import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOracleRequisition, ORACLE_BOARDS, parseOracleUrl } from './oracle.js';

const suppliedUrl = 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=AttributeChar4&mode=location&selectedFlexFieldsFacets=%22AttributeChar4%7CGraduates%3BTrainees%22';
const seaspanUrl = 'https://hckz.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?mode=job-location';
const nokiaUrl = 'https://jobs.nokia.com/en/sites/CX_1/jobs?lastSelectedFacet=LOCATIONS&selectedFlexFieldsFacets=%22AttributeChar21%7CStudent+or+Intern+or+Trainee%3BGraduate+or+Entry+Level%22&selectedLocationsFacet=300000000471544';

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

test('oracle: supplied Seaspan URL preserves its tenant, locale and site', () => {
  assert.ok(ORACLE_BOARDS.some((board) => board.name === 'Seaspan' && board.url === seaspanUrl));
  assert.deepEqual(parseOracleUrl(seaspanUrl), {
    origin: 'https://hckz.fa.us2.oraclecloud.com',
    language: 'en',
    site: 'CX_1',
  });
});

test('oracle: Seaspan requisition maps its live Canadian response fields', () => {
  const parsed = parseOracleUrl(seaspanUrl);
  assert.ok(parsed);
  const job = mapOracleRequisition({
    Id: '8881',
    Title: 'Director, Contracts & Commercial',
    PrimaryLocation: 'North Vancouver, BC, Canada',
    workLocation: [{ Name: 'VSY - 2 Pemberton' }],
    WorkplaceType: 'On-site',
    ContractType: 'Regular',
    PostedDate: '2026-09-03',
    ShortDescriptionStr: 'Leads contractual and commercial matters for Coast Guard Programs.',
  }, { url: seaspanUrl, name: 'Seaspan' }, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Director, Contracts & Commercial');
  assert.equal(job.company, 'Seaspan');
  assert.equal(job.location, 'North Vancouver, BC, Canada; VSY - 2 Pemberton');
  assert.equal(job.url,
    'https://hckz.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/8881');
  assert.equal(job.source, 'oracle');
  assert.equal(job.postedAt, '2026-09-03T00:00:00.000Z');
  assert.equal(job.remote, false);
  assert.equal(job.type, 'full-time');
  assert.match(job.description ?? '', /Coast Guard Programs/);
});

test('oracle: title substrings do not override regular employment type', () => {
  const parsed = parseOracleUrl(seaspanUrl);
  assert.ok(parsed);
  const contractsJob = mapOracleRequisition({
    Id: '1', Title: 'Director, Contracts & Commercial', ContractType: 'Regular',
  }, { url: seaspanUrl, name: 'Seaspan' }, parsed);
  const internationalJob = mapOracleRequisition({
    Id: '2', Title: 'International Sales Manager', ContractType: 'Regular',
  }, { url: seaspanUrl, name: 'Seaspan' }, parsed);

  assert.equal(contractsJob?.type, 'full-time');
  assert.equal(internationalJob?.type, 'full-time');
});

test('oracle: supplied Nokia URL preserves its custom host and both facets', () => {
  assert.ok(ORACLE_BOARDS.some((board) =>
    board.name === 'Nokia'
    && board.url === nokiaUrl
    && board.apiOrigin === 'https://fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com'));
  assert.deepEqual(parseOracleUrl(nokiaUrl), {
    origin: 'https://jobs.nokia.com',
    language: 'en',
    site: 'CX_1',
    lastSelectedFacet: 'LOCATIONS',
    selectedFlexFieldsFacets: 'AttributeChar21|Student or Intern or Trainee;Graduate or Entry Level',
    selectedLocationsFacet: '300000000471544',
  });
});

test('oracle: Nokia requisition maps its live Canadian co-op fields', () => {
  const parsed = parseOracleUrl(nokiaUrl);
  assert.ok(parsed);
  const job = mapOracleRequisition({
    Id: '40113',
    Title: 'Optical Test Coop/Intern',
    PrimaryLocation: 'Canada',
    workLocation: [{ Name: 'March Rd Tower 1' }],
    WorkplaceType: 'Onsite',
    WorkplaceTypeCode: 'ORA_ON_SITE',
    PostedDate: '2026-09-08',
    ShortDescriptionStr: 'Join the Optical Design Verification Test team.',
  }, { url: nokiaUrl, name: 'Nokia' }, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Optical Test Coop/Intern');
  assert.equal(job.company, 'Nokia');
  assert.equal(job.location, 'Canada; March Rd Tower 1');
  assert.equal(job.url, 'https://jobs.nokia.com/en/sites/CX_1/job/40113');
  assert.equal(job.source, 'oracle');
  assert.equal(job.postedAt, '2026-09-08T00:00:00.000Z');
  assert.equal(job.remote, false);
  assert.equal(job.type, 'co-op');
  assert.match(job.description ?? '', /Optical Design Verification Test/);
});
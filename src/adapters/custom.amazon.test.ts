import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapAmazonSearchResponse,
  parseAmazonUniversityUrl,
} from './custom.js';

const boardUrl = 'https://www.amazon.jobs/content/en/career-programs/university?keyword%5B%5D=intern&team%5B%5D=studentprograms.team-internships-for-students';

test('custom: Amazon University URL preserves the verified internship filters', () => {
  assert.deepEqual(parseAmazonUniversityUrl(boardUrl), {
    origin: 'https://www.amazon.jobs',
    keyword: 'intern',
    labels: ['studentprograms', 'studentprograms.team-internships-for-students'],
  });
  assert.equal(parseAmazonUniversityUrl(
    'https://www.amazon.jobs/content/en/career-programs/university?keyword%5B%5D=manager',
  ), null);
});

test('custom: Amazon structured search maps an internship posting', () => {
  const [job] = mapAmazonSearchResponse({
    found: 1,
    start: 0,
    searchHits: [{ fields: {
      title: ['Software Development Engineer Intern - 2027 (Canada)'],
      icimsJobId: ['3120598'],
      location: ['CA, ON, Toronto'],
      updatedDate: ['1788134400'],
      isIntern: ['1'],
      description: ['Build customer-facing services with a software engineering team.'],
      basicQualifications: ['Currently enrolled in a computer science degree.'],
      locations: ['{"type":"ONSITE","location":"CA, ON, Toronto"}'],
    } }],
  }, {
    kind: 'amazon-university',
    name: 'Amazon',
    url: boardUrl,
  });

  assert.equal(job?.title, 'Software Development Engineer Intern - 2027 (Canada)');
  assert.equal(job?.company, 'Amazon');
  assert.equal(job?.location, 'CA, ON, Toronto');
  assert.equal(job?.url, 'https://www.amazon.jobs/jobs/3120598');
  assert.equal(job?.source, 'custom');
  assert.equal(job?.type, 'intern');
  assert.equal(job?.postedAt, '2026-08-31T00:00:00.000Z');
  assert.match(job?.description ?? '', /computer science degree/);
});

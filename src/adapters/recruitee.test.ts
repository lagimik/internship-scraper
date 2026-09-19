import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapRecruiteePosting,
  parseRecruiteeUrl,
  recruiteeAdapter,
} from './recruitee.js';

test('recruitee: AJ Walter posting URL preserves the verified tenant', () => {
  assert.deepEqual(
    parseRecruiteeUrl('https://ajwalter.recruitee.com/o/stage-genie-mecanique-internship-mechanical-engineering'),
    {
      origin: 'https://ajwalter.recruitee.com',
      tenant: 'ajwalter',
      boardUrl: 'https://ajwalter.recruitee.com/',
      apiUrl: 'https://ajwalter.recruitee.com/api/offers/',
    },
  );
  assert.equal(parseRecruiteeUrl('https://example.com/o/software-intern'), null);
  assert.equal(parseRecruiteeUrl('https://ajwalter.recruitee.com/contactus'), null);
});

test('recruitee: public API offer maps canonical job metadata', () => {
  assert.equal(recruiteeAdapter().name, 'recruitee');
  const job = mapRecruiteePosting({
    title: 'Stage, Génie mécanique - Internship, Mechanical engineering',
    company_name: 'AJ Walter Aviation',
    careers_url: 'https://ajwalter.recruitee.com/o/stage-genie-mecanique-internship-mechanical-engineering',
    published_at: '2026-09-10 14:56:29 UTC',
    city: 'Montréal',
    state_name: 'Quebec',
    country: 'Canada',
    locations: [{ city: 'Montréal', state: 'Quebec', country: 'Canada' }],
    remote: false,
    employment_type_code: 'fulltime_permanent',
    salary: { min: null, max: null, period: null, currency: null },
    description: '<p>Support engineers with tooling design.</p>',
    requirements: '<p>Knowledge of engineering in an aeronautical environment.</p>',
  }, {
    name: 'AJ Walter Aviation',
    url: 'https://ajwalter.recruitee.com/o/stage-genie-mecanique-internship-mechanical-engineering',
  });

  assert.deepEqual(job, {
    title: 'Stage, Génie mécanique - Internship, Mechanical engineering',
    company: 'AJ Walter Aviation',
    location: 'Montréal, Quebec, Canada',
    remote: false,
    url: 'https://ajwalter.recruitee.com/o/stage-genie-mecanique-internship-mechanical-engineering',
    source: 'recruitee',
    postedAt: '2026-09-10T14:56:29.000Z',
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: 'intern',
    sponsorship: null,
    description: 'Support engineers with tooling design.\n\nKnowledge of engineering in an aeronautical environment.',
  });
});
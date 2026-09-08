import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kulaAdapter, mapKulaResponse, parseKulaUrl } from './kula.js';

test('kula: Sanctuary AI URL preserves the exact account name', () => {
  assert.deepEqual(parseKulaUrl('https://careers.kula.ai/sanctuary-ai'), {
    origin: 'https://careers.kula.ai',
    accountName: 'sanctuary-ai',
  });
  assert.deepEqual(parseKulaUrl('https://careers.kula.ai/sanctuary-ai/33158/'), {
    origin: 'https://careers.kula.ai',
    accountName: 'sanctuary-ai',
  });
  assert.equal(parseKulaUrl('https://example.com/sanctuary-ai'), null);
});

test('kula: public API response maps a canonical Sanctuary AI internship', () => {
  const board = {
    url: 'https://careers.kula.ai/sanctuary-ai',
    name: 'Sanctuary AI',
  };
  const parsed = parseKulaUrl(board.url);
  assert.ok(parsed);
  const [job] = mapKulaResponse({
    data: [{
      id: 33158,
      title: 'Machine Learning Research Intern (Reinforcement/Imitation Learning)',
      listed: true,
      is_confidential: false,
      launch_at: '2026-02-11T19:12:37.000Z',
      ats_job: {
        job_description: '<div><b>Your New Role and Team</b></div><div>Build robotic manipulation systems.</div>',
        workplace: 'office',
        employment_type: 'internship',
        offices: [{
          location: 'Vancouver, British Columbia, Canada',
          remote: false,
          workplace: 'office',
        }],
      },
    }],
  }, board, parsed);

  assert.equal(kulaAdapter().name, 'kula');
  assert.ok(job);
  assert.equal(job.title, 'Machine Learning Research Intern (Reinforcement/Imitation Learning)');
  assert.equal(job.company, 'Sanctuary AI');
  assert.equal(job.location, 'Vancouver, British Columbia, Canada');
  assert.equal(job.remote, false);
  assert.equal(job.url, 'https://careers.kula.ai/sanctuary-ai/33158/');
  assert.equal(job.source, 'kula');
  assert.equal(job.postedAt, '2026-02-11T19:12:37.000Z');
  assert.equal(job.type, 'intern');
  assert.equal(job.description, 'Your New Role and TeamBuild robotic manipulation systems.');
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSuccessFactorsApiJob } from './successfactors.js';

test('Hydro-Québec French API job maps to its canonical URL', () => {
  const job = mapSuccessFactorsApiJob({
    unifiedUrlTitle: 'Stages-coll%C3%A9giaux-%C3%A9tudiant%28es%29-Autochtones',
    unifiedStandardStart: '26/01/2026',
    id: '163369',
    unifiedStandardTitle: 'Stages collégiaux étudiant(es) Autochtones',
    filter3: ['Emplois pour les étudiants et étudiantes'],
  }, {
    url: 'https://emploi.hydroquebec.com/search/?q=etudiant',
    name: 'Hydro-Québec',
    apiBrand: 'Hydro-Québec',
    apiLocale: 'fr_FR',
    apiDefaultLocation: 'Québec, Canada',
    apiDateOrder: 'dmy',
    apiJobPathBrand: false,
  });

  assert.ok(job);
  assert.equal(job.title, 'Stages collégiaux étudiant(es) Autochtones');
  assert.equal(job.company, 'Hydro-Québec');
  assert.equal(job.location, 'Québec, Canada');
  assert.equal(job.url,
    'https://emploi.hydroquebec.com/job/Stages-coll%C3%A9giaux-%C3%A9tudiant%28es%29-Autochtones/163369-fr_FR');
  assert.equal(job.source, 'successfactors');
  assert.equal(job.postedAt, '2026-01-26T00:00:00.000Z');
  assert.equal(job.type, 'intern');
});
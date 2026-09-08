import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapSuccessFactorsApiJob,
  parseSuccessFactorsHtml,
  parseSuccessFactorsUrl,
} from './successfactors.js';

test('Celestica search URL resolves to its classic SuccessFactors endpoint', () => {
  assert.deepEqual(parseSuccessFactorsUrl(
    'https://careers.celestica.com/search/?createNewAlert=false&q=&locationsearch=',
  ), {
    origin: 'https://careers.celestica.com',
    searchUrl: 'https://careers.celestica.com/search/',
  });
});

test('Celestica classic result maps title, location, date and canonical URL', () => {
  const [job] = parseSuccessFactorsHtml(`
    <table>
      <tr class="data-row">
        <td><a class="jobTitle-link" href="/job/Toronto-Advisor%2C-Internal-Audit%2C-IT-ON/1395122633/">Advisor, Internal Audit, IT</a></td>
        <td class="jobLocation">Toronto, ON, CA</td>
        <td class="jobDate">Aug 14, 2026</td>
      </tr>
    </table>
  `, {
    url: 'https://careers.celestica.com/search/?createNewAlert=false&q=&locationsearch=',
    name: 'Celestica',
  });

  assert.ok(job);
  assert.equal(job.title, 'Advisor, Internal Audit, IT');
  assert.equal(job.company, 'Celestica');
  assert.equal(job.location, 'Toronto, ON, CA');
  assert.equal(job.postedAt, '2026-08-14T00:00:00.000Z');
  assert.equal(job.url, 'https://careers.celestica.com/job/Toronto-Advisor%2C-Internal-Audit%2C-IT-ON/1395122633/');
  assert.equal(job.source, 'successfactors');
});

test('Babcock category URL maps its classic Canadian result markup', () => {
  const board = {
    url: 'https://jobs.babcockinternational.com/go/View-all-Jobs/4819301/',
    name: 'Babcock International',
  };
  assert.deepEqual(parseSuccessFactorsUrl(board.url), {
    origin: 'https://jobs.babcockinternational.com',
    searchUrl: 'https://jobs.babcockinternational.com/search/',
  });

  const [job] = parseSuccessFactorsHtml(`
    <table>
      <tr class="data-row">
        <td><a class="jobTitle-link" href="/job/Kamloops-Apprentice-AME-Brit-V2B-7X2/1376583333/">Apprentice AME</a></td>
        <td><span class="jobLocation">Kamloops, British Columbia, CA, V2B 7X2</span></td>
      </tr>
    </table>
  `, board);

  assert.ok(job);
  assert.equal(job.title, 'Apprentice AME');
  assert.equal(job.company, 'Babcock International');
  assert.equal(job.location, 'Kamloops, British Columbia, CA, V2B 7X2');
  assert.equal(job.url, 'https://jobs.babcockinternational.com/job/Kamloops-Apprentice-AME-Brit-V2B-7X2/1376583333/');
  assert.equal(job.source, 'successfactors');
  assert.equal(job.postedAt, null);
});

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
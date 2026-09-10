import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EIGHTFOLD_BOARDS,
  parseEightfoldResponse,
  parseEightfoldUrl,
} from './eightfold.js';

test('eightfold: Microsoft branded careers URL resolves to its public API origin', () => {
  assert.deepEqual(parseEightfoldUrl(
    'https://apply.careers.microsoft.com/careers?query=intern&location=Canada',
  ), {
    origin: 'https://apply.careers.microsoft.com',
    tenant: 'microsoft',
  });
  assert.ok(EIGHTFOLD_BOARDS.some((board) => board.name === 'Microsoft'
    && board.domain === 'microsoft.com'
    && board.url === 'https://apply.careers.microsoft.com/careers'));
  assert.equal(parseEightfoldUrl(
    'https://careers.microsoft.com/v2/global/en/home.html',
  ), null);
});

test('eightfold: Microsoft public search position maps to its canonical careers URL', () => {
  const board = {
    url: 'https://apply.careers.microsoft.com/careers',
    domain: 'microsoft.com',
    name: 'Microsoft',
  };
  const parsed = parseEightfoldUrl(board.url);
  assert.ok(parsed);
  const [job] = parseEightfoldResponse({ data: { positions: [{
    id: 1970393556859421,
    name: 'Stagiaire Technicien de Centre de Données / Datacenter Technician Intern',
    locations: ['Canada, Québec, Quebec City'],
    standardizedLocations: ['Québec City, QC, CA'],
    postedTs: 1785348728,
    positionUrl: '/careers/job/1970393556859421',
    workLocationOption: 'onsite',
    department: 'Data Center Technicians',
    efcustomTextCustpayrange: [],
    efcustomTextCustpreferredsalaryV2: ['C$25.90 - C$30.20'],
  }] } }, board, parsed);

  assert.ok(job);
  assert.equal(job.company, 'Microsoft');
  assert.equal(job.location, 'Canada, Québec, Quebec City');
  assert.equal(job.url, 'https://apply.careers.microsoft.com/careers/job/1970393556859421');
  assert.equal(job.source, 'eightfold');
  assert.equal(job.salaryRaw, 'C$25.90 - C$30.20');
  assert.equal(job.salaryCurrency, 'CAD');
});
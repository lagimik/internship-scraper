import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapWorkdayPosting,
  parseWorkdayUrl,
  WORKDAY_BOARDS,
} from './workday.js';

test('workday: supplied Airbus URL preserves its Canadian country facet', () => {
  const url = 'https://ag.wd3.myworkdayjobs.com/Airbus?locationCountry=a30a87ed25634629aa6c3958aa2b91ea';
  assert.ok(WORKDAY_BOARDS.some((board) => board.name === 'Airbus' && board.url === url));
  const parsed = parseWorkdayUrl(url);
  assert.deepEqual(parsed, {
    host: 'ag',
    dc: 'wd3',
    tenant: 'ag',
    site: 'Airbus',
    origin: 'https://ag.wd3.myworkdayjobs.com',
    appliedFacets: {
      locationCountry: ['a30a87ed25634629aa6c3958aa2b91ea'],
    },
  });
  assert.ok(parsed);

  const job = mapWorkdayPosting({
    title: 'Superviseur opération - Atelier Peinture (Jour) / Production supervisor - Paintshop (day)',
    externalPath: '/job/Montreal-Area/Superviseur-opration---Atelier-Peinture--Jour----Production-supervisor---Paintshop--day-_JR10415932',
    locationsText: 'Montreal Area',
    postedOn: 'Posted Yesterday',
    bulletFields: ['JR10415932'],
  }, { url, name: 'Airbus' }, parsed);

  assert.equal(job.company, 'Airbus');
  assert.equal(job.location, 'Montreal Area');
  assert.equal(job.url, 'https://ag.wd3.myworkdayjobs.com/en-US/Airbus/job/Montreal-Area/Superviseur-opration---Atelier-Peinture--Jour----Production-supervisor---Paintshop--day-_JR10415932');
  assert.equal(job.source, 'workday');
});

test('workday: supplied Mosaic URL preserves its Intern/Co-Op facet', () => {
  const url = 'https://mosaic.wd5.myworkdayjobs.com/mosaic?workerSubType=ed8099291cc44a449715a96f49b3b316';
  assert.ok(WORKDAY_BOARDS.some((board) => board.name === 'The Mosaic Company' && board.url === url));
  const parsed = parseWorkdayUrl(url);
  assert.deepEqual(parsed, {
    host: 'mosaic',
    dc: 'wd5',
    tenant: 'mosaic',
    site: 'mosaic',
    origin: 'https://mosaic.wd5.myworkdayjobs.com',
    appliedFacets: {
      workerSubType: ['ed8099291cc44a449715a96f49b3b316'],
    },
  });
  assert.ok(parsed);

  const job = mapWorkdayPosting({
    title: 'Mechanical Integrity Engineer Co-Op/Intern - Summer 2027',
    externalPath: '/job/CA---Esterhazy-SK/Mechanical-Integrity-Engineer-Co-Op-Intern---Summer-2027_64356',
    locationsText: 'CA - Esterhazy, SK',
    postedOn: 'Posted 30+ Days Ago',
    bulletFields: ['64356'],
  }, { url, name: 'The Mosaic Company' }, parsed);

  assert.equal(job.title, 'Mechanical Integrity Engineer Co-Op/Intern - Summer 2027');
  assert.equal(job.company, 'The Mosaic Company');
  assert.equal(job.location, 'CA - Esterhazy, SK');
  assert.equal(job.url, 'https://mosaic.wd5.myworkdayjobs.com/en-US/mosaic/job/CA---Esterhazy-SK/Mechanical-Integrity-Engineer-Co-Op-Intern---Summer-2027_64356');
  assert.equal(job.source, 'workday');
});

test('workday: supplied TC Energy URL maps its board and an open internship', () => {
  const url = 'https://tcenergy.wd3.myworkdayjobs.com/en-US/CAREER_SITE_TC';
  assert.ok(WORKDAY_BOARDS.some((board) => board.name === 'TC Energy' && board.url === url));
  const parsed = parseWorkdayUrl(url);
  assert.deepEqual(parsed, {
    host: 'tcenergy',
    dc: 'wd3',
    tenant: 'tcenergy',
    site: 'CAREER_SITE_TC',
    origin: 'https://tcenergy.wd3.myworkdayjobs.com',
  });
  assert.ok(parsed);

  const job = mapWorkdayPosting({
    title: 'Student Intern, Engineering',
    externalPath: '/job/Calgary-Alberta/Intern---Engineering_JR-10728',
    locationsText: 'Calgary, Alberta',
    postedOn: 'Posted 7 Days Ago',
    bulletFields: ['JR-10728'],
  }, { url, name: 'TC Energy' }, parsed);

  assert.equal(job.title, 'Student Intern, Engineering');
  assert.equal(job.company, 'TC Energy');
  assert.equal(job.location, 'Calgary, Alberta');
  assert.equal(job.url, 'https://tcenergy.wd3.myworkdayjobs.com/en-US/CAREER_SITE_TC/job/Calgary-Alberta/Intern---Engineering_JR-10728');
  assert.equal(job.source, 'workday');
});

test('workday: supplied Shell application URL preserves its Canadian locale', () => {
  const url = 'https://shell.wd3.myworkdayjobs.com/en-CA/ShellCareers/job/Scotford/Shell-Assessed-Internship-Programme--January-May-2027----Programme-de-stages-valus-de-Shell--janvier---mai-2027----Canada_R205117/apply?source=APPLICANT_SOURCE_LinkedIn_Job_Board';
  assert.ok(WORKDAY_BOARDS.some((board) => board.name === 'Shell' && board.url === url));
  const parsed = parseWorkdayUrl(url);
  assert.deepEqual(parsed, {
    host: 'shell',
    dc: 'wd3',
    tenant: 'shell',
    site: 'ShellCareers',
    locale: 'en-CA',
    origin: 'https://shell.wd3.myworkdayjobs.com',
  });
  assert.ok(parsed);

  const job = mapWorkdayPosting({
    title: 'Shell Assessed Internship Programme (January/May 2027) / Programme de stages évalués de Shell (janvier / mai 2027) - Canada',
    externalPath: '/job/Scotford/Shell-Assessed-Internship-Programme--January-May-2027----Programme-de-stages-valus-de-Shell--janvier---mai-2027----Canada_R205117',
    locationsText: '2 Locations',
    postedOn: 'Posted 6 Days Ago',
    bulletFields: ['R205117'],
  }, { url, name: 'Shell' }, parsed);

  assert.equal(job.title, 'Shell Assessed Internship Programme (January/May 2027) / Programme de stages évalués de Shell (janvier / mai 2027) - Canada');
  assert.equal(job.company, 'Shell');
  assert.equal(job.location, '2 Locations');
  assert.equal(job.url, 'https://shell.wd3.myworkdayjobs.com/en-CA/ShellCareers/job/Scotford/Shell-Assessed-Internship-Programme--January-May-2027----Programme-de-stages-valus-de-Shell--janvier---mai-2027----Canada_R205117');
  assert.equal(job.source, 'workday');
});
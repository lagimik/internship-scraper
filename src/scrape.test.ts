import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allAdapters, fastAdapters, optionalAdapters, slowAdapters } from './scrape.js';

const DEFAULT_ADAPTER_NAMES = [
  'github',
  'simplify',
  'greenhouse',
  'lever',
  'ashby',
  'oracle',
  'successfactors',
  'ultipro',
  'custom',
  'dayforce',
  'bamboohr',
  'tesla',
  'stantec',
  'dover',
  'applicantpro',
  'talentbrew',
  'avature',
  'cornerstone',
  'taleo',
  'rippling',
  'cws',
  'adp',
  'kula',
  'workday',
  'eightfold',
  'siemens',
  'apple',
  'smartrecruiters',
  'phenom',
  'paradox',
  'sap-erecruiting',
] as const;

test('scrape registers every default adapter exactly once', () => {
  const fastNames = fastAdapters().map((adapter) => adapter.name);
  const slowNames = slowAdapters().map((adapter) => adapter.name);
  const allNames = allAdapters().map((adapter) => adapter.name);

  assert.deepEqual(allNames, [...fastNames, ...slowNames]);
  assert.deepEqual(allNames, DEFAULT_ADAPTER_NAMES);
  assert.equal(new Set(allNames).size, allNames.length);
});

test('scrape keeps Job Bank available as the only opt-in adapter', () => {
  const optionalNames = optionalAdapters().map((adapter) => adapter.name);
  const everyName = [...DEFAULT_ADAPTER_NAMES, ...optionalNames];

  assert.deepEqual(optionalNames, ['jobbank']);
  assert.equal(new Set(everyName).size, everyName.length);
});
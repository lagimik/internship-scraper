import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dvinciAdapter,
  parseDvinciJob,
  parseDvinciListing,
  parseDvinciUrl,
} from './dvinci.js';

const postingUrl = 'https://doppelmayr.dvinci-hr.com/fr/p/fr/jobs/101438/stagiaire-genie-mecanique-hiver-2027';

test('dvinci: Doppelmayr posting URL preserves locale and portal', () => {
  const parsed = parseDvinciUrl(postingUrl);
  assert.deepEqual(parsed, {
    origin: 'https://doppelmayr.dvinci-hr.com',
    locale: 'fr',
    portal: 'fr',
    boardUrl: 'https://doppelmayr.dvinci-hr.com/fr/p/fr/jobs',
  });
  assert.equal(parseDvinciUrl('https://example.com/fr/p/fr/jobs/101438/example'), null);
  assert.equal(parseDvinciUrl('https://doppelmayr.dvinci-hr.com/fr/contact'), null);
});

test('dvinci: listing extracts unique same-board posting links', () => {
  const parsed = parseDvinciUrl(postingUrl);
  assert.ok(parsed);
  assert.deepEqual(parseDvinciListing(`
    <a href="/fr/p/fr/jobs/101438/stagiaire-genie-mecanique-hiver-2027">Stage</a>
    <a href="/fr/p/fr/jobs/101438/stagiaire-genie-mecanique-hiver-2027">Stage duplicate</a>
    <a href="/en/p/fr/jobs/101438/mechanical-engineering-intern">Other locale</a>
  `, parsed), [postingUrl]);
});

test('dvinci: JobPosting JSON-LD maps canonical job metadata', () => {
  assert.equal(dvinciAdapter().name, 'dvinci');
  const job = parseDvinciJob(`
    <link rel="canonical" href="${postingUrl}">
    <script type="application/ld+json">{
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "datePosted": "2026-07-07T16:06:40.155Z",
      "description": "<p>Participer à la <strong>conception mécanique</strong>.</p>",
      "employmentType": ["PRAKTIKUM"],
      "jobLocation": [{"address": {
        "addressLocality": "Saint-Jérome (Québec)",
        "addressRegion": null,
        "addressCountry": "CA"
      }}],
      "title": "Stagiaire génie mécanique (Hiver 2027)"
    }</script>
  `, postingUrl, { name: 'Doppelmayr Canada', url: postingUrl });

  assert.deepEqual(job, {
    title: 'Stagiaire génie mécanique (Hiver 2027)',
    company: 'Doppelmayr Canada',
    location: 'Saint-Jérome (Québec), CA',
    remote: false,
    url: postingUrl,
    source: 'dvinci',
    postedAt: '2026-07-07T16:06:40.155Z',
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: 'intern',
    sponsorship: null,
    description: 'Participer à la conception mécanique.',
  });
});
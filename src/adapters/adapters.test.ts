/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownTables, dateCellToIso } from './github-md.js';
import { parseWorkdayUrl, parseWorkdayPostedOn } from './workday.js';
import { parseSimplifyListings } from './simplify.js';
import { collectLocations, mapEmploymentType } from './ashby.js';
import { parseDayforceResponse, parseDayforceUrl } from './dayforce.js';
import { parseBambooHrPosting, parseBambooHrUrl } from './bamboohr.js';
import { parseTeslaHtml } from './tesla.js';
import { parseStantecResponse } from './stantec.js';
import { parseSiemensSearchPage, siemensAdapter } from './siemens.js';
import { appleAdapter, parseAppleSearchResponse } from './apple.js';
import {
  parseEightfoldResponse,
  parseEightfoldTimestamp,
  parseEightfoldUrl,
} from './eightfold.js';
import { parseAvatureSearchPage, parseAvatureUrl } from './avature.js';
import {
  discoverCyberRecruiterPages,
  parseConfiguredHtml,
  parseCyberRecruiterJobs,
  parsePrevueJobs,
} from './custom.js';

test('github: angle-bracket markdown links yield a clean URL', () => {
  // hanzili's lists escape URLs as [Apply](<https://…>). Keeping the ">" produced
  // 144 dead apply links in the db.
  const md = [
    '| Title | Company | Location | Apply |',
    '|---|---|---|---|',
    '| Software Developer Intern | RemoteFront | Markham, Ontario | [Apply](<https://ca.linkedin.com/jobs/view/x-4444669950>) |',
  ].join('\n');
  const [job] = parseMarkdownTables(md, 'test');
  assert.ok(job);
  assert.equal(job.url, 'https://ca.linkedin.com/jobs/view/x-4444669950');
  assert.ok(!job.url.endsWith('>'));
});

test('github: column order comes from the header row', () => {
  // Title-first with extra columns (hanzili) vs company-first (speedyapply).
  const titleFirst = [
    '| Title | Company | Role | Location | Apply |',
    '|---|---|---|---|---|',
    '| Backend Intern | Acme Corp | Build things | Toronto, ON | [Apply](https://example.com/1) |',
  ].join('\n');
  const [a] = parseMarkdownTables(titleFirst, 'test');
  assert.ok(a);
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.title, 'Backend Intern');
  assert.equal(a.location, 'Toronto, ON');

  const companyFirst = [
    '| Company | Role | Location | Age |',
    '|---|---|---|---|',
    '| Acme Corp | Backend Intern | Toronto, ON | [Apply](https://example.com/2) |',
  ].join('\n');
  const [b] = parseMarkdownTables(companyFirst, 'test');
  assert.ok(b);
  assert.equal(b.company, 'Acme Corp');
  assert.equal(b.title, 'Backend Intern');
});

test('github: date cells parse as both absolute dates and relative ages', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');
  // Absolute, the Canadian list's format. Only handling relative ages left 173 of
  // 282 rows with no posted_at, which broke "newest first".
  assert.equal(dateCellToIso('Jul 31, 2026', now)?.slice(0, 10), '2026-07-31');
  assert.equal(dateCellToIso('2026-07-31', now)?.slice(0, 10), '2026-07-31');
  // Relative, speedyapply's format.
  assert.equal(dateCellToIso('5d', now)?.slice(0, 10), '2026-07-29');
  assert.equal(dateCellToIso('2mo', now)?.slice(0, 10), '2026-06-04');
  // Junk must not become a date.
  assert.equal(dateCellToIso('', now), null);
  assert.equal(dateCellToIso('Apply', now), null);
  assert.equal(dateCellToIso('4', now), null);
});

test('github: a posting date is read from the table', () => {
  const md = [
    '| Company | Role | Location | Apply | Date Posted |',
    '|---|---|---|---|---|',
    '| InstaLILY | SWE Co-op | Toronto, ON | [Apply](https://example.com/1) | Jul 31, 2026 |',
  ].join('\n');
  const [job] = parseMarkdownTables(md, 'test');
  assert.ok(job);
  assert.equal(job.postedAt?.slice(0, 10), '2026-07-31');
});

test('github: legend tables are not parsed as jobs', () => {
  // hanzili's README opens with an emoji legend; it must not become a posting.
  const md = [
    '| Emoji | Meaning |',
    '|:---:|---|',
    '| 🔥 | Hot Opportunity - Big Tech |',
  ].join('\n');
  assert.equal(parseMarkdownTables(md, 'test').length, 0);
});

test('workday: careers URL decomposes into CXS API parts', () => {
  const p = parseWorkdayUrl('https://harriscomputer.wd3.myworkdayjobs.com/en-US/1/job/Montreal-Quebec/x_R0044820-1');
  assert.ok(p);
  assert.equal(p.host, 'harriscomputer');
  assert.equal(p.tenant, 'harriscomputer');
  assert.equal(p.site, '1');
  assert.equal(p.origin, 'https://harriscomputer.wd3.myworkdayjobs.com');

  // Locale segment is optional.
  assert.equal(parseWorkdayUrl('https://td.wd3.myworkdayjobs.com/TD_Bank_Careers')?.site, 'TD_Bank_Careers');
  assert.equal(parseWorkdayUrl('https://example.com/careers'), null);
});

test('workday: relative postedOn becomes a date', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');
  assert.equal(parseWorkdayPostedOn('Posted Today', now), now.toISOString());
  assert.equal(parseWorkdayPostedOn('Posted 11 Days Ago', now)?.slice(0, 10), '2026-07-23');
  assert.equal(parseWorkdayPostedOn('Posted 30+ Days Ago', now)?.slice(0, 10), '2026-07-04');
  assert.equal(parseWorkdayPostedOn(undefined), null);
});

test('eightfold: careers URL decomposes into public API parts', () => {
  assert.deepEqual(parseEightfoldUrl(
    'https://bostonscientific.eightfold.ai/careers?start=0&pid=563602813456340',
  ), {
    origin: 'https://bostonscientific.eightfold.ai',
    tenant: 'bostonscientific',
  });
  assert.equal(parseEightfoldUrl('https://example.com/careers'), null);
  assert.equal(parseEightfoldUrl('https://example.eightfold.ai/profile'), null);
});

test('eightfold: public search positions map location, salary and URL', () => {
  const board = {
    url: 'https://lockheedmartin.eightfold.ai/careers',
    domain: 'lockheedmartin.com',
    name: 'Lockheed Martin',
  };
  const parsed = parseEightfoldUrl(board.url);
  assert.ok(parsed);
  const [job] = parseEightfoldResponse({ data: { positions: [{
    id: 996476544556,
    name: ' Mechanical Design Engineering Intern ',
    locations: ['Halifax CA-NS, Canada | CA-NS-Halifax'],
    standardizedLocations: ['Halifax, NS, CA'],
    postedTs: 1788134400,
    workLocationOption: 'hybrid',
    positionUrl: '/careers/job/996476544556',
    department: 'Engineering',
    efcustomTextCustpayrange: 'C$55,000 - C$70,000',
  }] } }, board, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Mechanical Design Engineering Intern');
  assert.equal(job.location, 'Halifax CA-NS, Canada');
  assert.equal(job.url, 'https://lockheedmartin.eightfold.ai/careers/job/996476544556');
  assert.equal(job.salaryRaw, 'C$55,000 - C$70,000');
  assert.equal(job.salaryCurrency, 'CAD');
  assert.equal(job.postedAt, parseEightfoldTimestamp(1788134400));
});

test('avature: search URL and result cards map to jobs', () => {
  const board = {
    url: 'https://jobs.siemens.com/en_US/externaljobs/SearchJobs/?42386=%5B812214%5D',
    name: 'Siemens',
    country: 'Canada',
  };
  assert.deepEqual(parseAvatureUrl(board.url), {
    origin: 'https://jobs.siemens.com',
    searchPath: '/en_US/externaljobs/SearchJobs/',
  });
  assert.equal(parseAvatureUrl('https://jobs.siemens.com/en_US/externaljobs/JobDetail/1'), null);

  const html = `<article class="article article--result 1">
    <h3><a href="/en_US/externaljobs/JobDetail/123"> Mechanical Engineering Intern </a></h3>
    <span class="list-item-location"><span class="list-item-jobCity">Oakville</span>,
      <span class="list-item-jobState">Ontario</span>, <span class="list-item-jobCountry">Canada</span></span>
    <span class="list-item-jobId">Job ID: 123</span>
    <span class="list-item-family">Engineering</span>
  </article>
  <a href="/en_US/externaljobs/SearchJobs/?folderRecordsPerPage=6&amp;folderOffset=6">2</a>`;
  const page = parseAvatureSearchPage(html, board);
  assert.equal(page.nextOffset, 6);
  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0]?.title, 'Mechanical Engineering Intern');
  assert.equal(page.jobs[0]?.location, 'Oakville, Ontario, Canada');
  assert.equal(page.jobs[0]?.url, 'https://jobs.siemens.com/en_US/externaljobs/JobDetail/123');
  assert.equal(page.jobs[0]?.description, 'Job family: Engineering');

  const laterPage = parseAvatureSearchPage(
    `${html}<a href="?folderOffset=0">1</a><a href="?folderOffset=12">3</a>`,
    board,
    6,
  );
  assert.equal(laterPage.nextOffset, 12);
});

test('avature: country-filtered multi-location cards retain the country', () => {
  const board = {
    url: 'https://jobs.siemens.com/en_US/externaljobs/SearchJobs/',
    name: 'Siemens',
    country: 'Canada',
  };
  const page = parseAvatureSearchPage(`<article class="article article--result">
    <h3><a href="/en_US/externaljobs/JobDetail/456">Design Engineering Co-op</a></h3>
    <span class="list-item-location">Multiple Locations</span>
  </article>`, board);
  assert.equal(page.jobs[0]?.location, 'Multiple Locations, Canada');
});

test('siemens: dedicated adapter maps live result-card structure and source identity', () => {
  assert.equal(siemensAdapter().name, 'siemens');
  const page = parseSiemensSearchPage(`<article class="article article--result">
    <h3><a href="/en_US/externaljobs/JobDetail/520001">Mechanical Engineering Intern</a></h3>
    <span class="list-item-location"><span class="list-item-jobCity">Wendell</span>,
      <span class="list-item-jobState">North Carolina</span>,
      <span class="list-item-jobCountry">United States of America</span></span>
    <span class="list-item-jobId">Job ID: 520001</span>
    <span class="list-item-family">Engineering</span>
  </article>
  <a href="?folderOffset=6">Next</a>`);
  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0]?.company, 'Siemens');
  assert.equal(page.jobs[0]?.source, 'siemens');
  assert.equal(page.jobs[0]?.location, 'Wendell, North Carolina, United States of America');
  assert.equal(page.jobs[0]?.url, 'https://jobs.siemens.com/en_US/externaljobs/JobDetail/520001');
  assert.equal(page.nextOffset, 6);
});

test('apple: public search response maps location, date, detail URL and source', () => {
  assert.equal(appleAdapter().name, 'apple');
  const [job] = parseAppleSearchResponse({ res: { totalRecords: 1, searchResults: [{
    id: '200680001',
    positionId: '200680001',
    postingTitle: ' Mechanical Engineering Intern ',
    transformedPostingTitle: 'mechanical-engineering-intern',
    postDateInGMT: '2026-08-31T12:30:00Z',
    jobSummary: 'Design and test Apple hardware during a four-month work term.',
    locations: [{
      postLocationId: 'postLocation-3350',
      city: 'Vancouver',
      stateProvince: 'British Columbia',
      countryName: 'Canada',
      name: 'Vancouver',
    }],
    team: { teamName: 'Hardware', teamCode: 'HRDWR' },
    homeOffice: false,
    managedPipelineRole: false,
  }] } }, 'en-ca');

  assert.ok(job);
  assert.equal(job.company, 'Apple');
  assert.equal(job.source, 'apple');
  assert.equal(job.title, 'Mechanical Engineering Intern');
  assert.equal(job.location, 'Vancouver, British Columbia, Canada');
  assert.equal(job.postedAt, '2026-08-31T12:30:00.000Z');
  assert.equal(
    job.url,
    'https://jobs.apple.com/en-ca/details/200680001-3350/mechanical-engineering-intern?team=HRDWR',
  );
  assert.match(job.description ?? '', /Team: Hardware/);
  assert.match(job.description ?? '', /four-month/);
});

test('apple: managed pipeline roles omit the country-level location suffix', () => {
  const [job] = parseAppleSearchResponse({ res: { searchResults: [{
    positionId: '114438004',
    postingTitle: 'CA - Specialist: Seasonal, Part-time',
    transformedPostingTitle: 'ca-specialist-seasonal-part-time',
    postingDate: 'Sep 01, 2026',
    locations: [{ postLocationId: 'postLocation-CANC', name: 'Canada' }],
    team: { teamCode: 'APPST' },
    managedPipelineRole: true,
  }] } }, 'en-ca');
  assert.equal(
    job?.url,
    'https://jobs.apple.com/en-ca/details/114438004/ca-specialist-seasonal-part-time?team=APPST',
  );
});

test('dayforce: careers URL decomposes into public API identifiers', () => {
  const parsed = parseDayforceUrl('https://jobs.dayforcehcm.com/en-CA/eclipse/CANDIDATEPORTAL/jobs/4031');
  assert.deepEqual(parsed, {
    origin: 'https://jobs.dayforcehcm.com',
    cultureCode: 'en-CA',
    clientNamespace: 'eclipse',
    jobBoardCode: 'CANDIDATEPORTAL',
  });
  assert.equal(parseDayforceUrl('https://example.com/en-CA/eclipse/CANDIDATEPORTAL'), null);
});

test('dayforce: structured posting maps location, type, salary and URL', () => {
  const board = {
    url: 'https://jobs.dayforcehcm.com/en-CA/eclipse/CANDIDATEPORTAL',
    name: 'Eclipse Automation',
  };
  const parsed = parseDayforceUrl(board.url);
  assert.ok(parsed);
  const [job] = parseDayforceResponse({ jobPostings: [{
    jobPostingId: 4031,
    jobTitle: ' Software Design Co-op (Nuclear) ',
    jobDescription: 'Job Type: Co-op\nCompensation: $25 - $30/hour\nBuild &amp; test controls.',
    hasVirtualLocation: false,
    postingStartTimestampUTC: '2026-07-13T04:00:00+00:00',
    postingLocations: [{ formattedAddress: 'Cambridge, ON, Canada' }],
  }] }, board, parsed);
  assert.ok(job);
  assert.equal(job.title, 'Software Design Co-op (Nuclear)');
  assert.equal(job.location, 'Cambridge, ON, Canada');
  assert.equal(job.type, 'co-op');
  assert.equal(job.salaryRaw, '$25 - $30/hour');
  assert.match(job.description ?? '', /Build & test controls/);
  assert.equal(job.url, 'https://jobs.dayforcehcm.com/en-CA/eclipse/CANDIDATEPORTAL/jobs/4031');
});

test('bamboohr: careers URL decomposes into tenant API parts', () => {
  assert.deepEqual(parseBambooHrUrl('https://avidbots.bamboohr.com/careers/937'), {
    origin: 'https://avidbots.bamboohr.com',
    tenant: 'avidbots',
  });
  assert.equal(parseBambooHrUrl('https://example.com/careers'), null);
  assert.equal(parseBambooHrUrl('https://avidbots.bamboohr.com/employees'), null);
});

test('bamboohr: detail record maps structured location, date and description', () => {
  const board = { url: 'https://avidbots.bamboohr.com/careers', name: 'Avidbots' };
  const parsed = parseBambooHrUrl(board.url);
  assert.ok(parsed);
  const job = parseBambooHrPosting({
    id: '937',
    jobOpeningName: ' Software Developer Intern ',
    jobOpeningStatus: 'Open',
    employmentStatusLabel: 'Internship',
    location: { city: 'Kitchener', state: 'Ontario', addressCountry: 'Canada' },
    atsLocation: { country: null, state: null, city: null },
    description: '<p>Build &amp; test robots.</p><ul><li>Write software</li></ul>',
    compensation: { displayText: '$25–$30/hour', currency: 'CAD' },
    datePosted: '2026-08-25',
    jobOpeningShareUrl: 'https://avidbots.bamboohr.com/careers/937',
  }, board, parsed);
  assert.ok(job);
  assert.equal(job.location, 'Kitchener, Ontario, Canada');
  assert.equal(job.type, 'intern');
  assert.equal(job.postedAt, '2026-08-25T00:00:00.000Z');
  assert.equal(job.salaryRaw, '$25–$30/hour');
  assert.equal(job.salaryCurrency, 'CAD');
  assert.match(job.description ?? '', /Build & test robots/);
});

test('tesla: saved search HTML returns visible result cards', () => {
  const jobs = parseTeslaHtml(`
    <li class="style_SearchListItem__hash">
      <a class="style_TitleLink__hash" href="/en_CA/careers/search/job/software-developer-intern-123">
        Software Developer <span>Intern</span>
      </a>
      <ul class="style_ListResultItemSublist__hash">
        <li><strong>Engineering &amp; Information Technology</strong> ・ <strong>Intern/Apprentice</strong></li>
        <li class="style_ListResultItemSublistLocation__hash"><strong>Toronto, Ontario</strong></li>
      </ul>
    </li>
  `);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.title, 'Software Developer Intern');
  assert.equal(jobs[0]?.location, 'Toronto, Ontario');
  assert.equal(jobs[0]?.type, 'intern');
  assert.equal(jobs[0]?.url, 'https://www.tesla.com/en_CA/careers/search/job/software-developer-intern-123');
  assert.equal(jobs[0]?.description, 'Job category: Engineering & Information Technology');
});

test('stantec: public search response maps to a normalized adapter job', () => {
  const [job] = parseStantecResponse({ jobs: [{
    company_exact: 'Stantec',
    title_exact: ' Mechanical Co-op Student - Fall 2026 ',
    title_slug: 'mechanical-co-op-student-fall-2026',
    location_exact: 'Dartmouth, NS',
    city_exact: 'Dartmouth',
    state_short_exact: 'NS',
    country_exact: 'Canada',
    date_new: '2026-08-31T20:04:43Z',
    description: 'A four-month mechanical engineering work term.',
    guid: '234BF34DE2B24383A43F82C98B97CB19',
  }] });

  assert.ok(job);
  assert.equal(job.title, 'Mechanical Co-op Student - Fall 2026');
  assert.equal(job.company, 'Stantec');
  assert.equal(job.location, 'Dartmouth, NS, Canada');
  assert.equal(job.source, 'stantec');
  assert.equal(job.postedAt, '2026-08-31T20:04:43.000Z');
  assert.match(job.description ?? '', /four-month/);
  assert.equal(
    job.url,
    'https://stantec.jobs/dartmouth-ns/mechanical-co-op-student-fall-2026/234BF34DE2B24383A43F82C98B97CB19/job/',
  );
});

test('ashby: secondary locations are kept so Canada-remote roles survive', () => {
  // A New York job open to "Remote (Canada)" is a Canadian job; keeping only
  // `location` would drop it.
  const loc = collectLocations({
    id: 'x',
    title: 'Security Engineer',
    location: 'New York, NY (HQ)',
    secondaryLocations: [
      { location: 'Remote (Canada)', address: { postalAddress: { addressCountry: 'Canada' } } },
      { location: 'Miami, FL', address: { postalAddress: { addressCountry: 'USA' } } },
    ],
  });
  assert.match(loc, /Canada/);
  assert.match(loc, /New York/);

  assert.equal(mapEmploymentType('Intern'), 'intern');
  assert.equal(mapEmploymentType('FullTime'), 'full-time');
  assert.equal(mapEmploymentType(undefined), null);
});

test('simplify: closed listings are dropped', () => {
  const jobs = parseSimplifyListings([
    { company_name: 'A', title: 'SWE Intern', url: 'https://x/1', locations: ['Toronto, ON, Canada'], active: true },
    { company_name: 'B', title: 'SWE Intern', url: 'https://x/2', locations: ['Toronto, ON, Canada'], active: false },
    { company_name: 'C', title: 'SWE Intern', url: 'https://x/3', locations: ['Toronto, ON'], is_visible: false },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.company, 'A');
  assert.equal(jobs[0]?.location, 'Toronto, ON, Canada');
});

test('custom: Prevue JSON maps structured jobs', () => {
  const board = { kind: 'prevue-json' as const, name: 'Martinrea', url: 'https://example.com/jobs/', siteId: 596 };
  const [job] = parsePrevueJobs({ data: { jobs: [{
    id: 332542,
    title: 'Mechanical Engineering Intern',
    startDateRef: 'Aug 20, 2026',
    jobLocation: 'Vaughan, ON, Canada',
    workplaceType: 'Onsite',
    employmentType: 'Intern',
    jobUrl: 'https://example.com/jobs/332542',
  }] } }, board);
  assert.equal(job?.title, 'Mechanical Engineering Intern');
  assert.equal(job?.location, 'Vaughan, ON, Canada');
  assert.equal(job?.type, 'intern');
  assert.equal(job?.postedAt?.slice(0, 10), '2026-08-20');
});

test('custom: configured HTML cards map title, location and date', () => {
  const board = {
    kind: 'html' as const,
    name: 'General Dynamics',
    url: 'https://example.com/search/jobs/in/country/canada',
    selectors: {
      card: '.jobs-section__item', titleLink: 'h2 a', location: '.location', postedDate: 'time',
    },
  };
  const [job] = parseConfiguredHtml(`
    <div class="jobs-section__item"><h2><a href="/jobs/123-design-intern">Design Intern</a></h2>
    <div class="location">London, ON, Canada</div><time datetime="2026-08-25">Aug 25</time></div>`, board);
  assert.equal(job?.url, 'https://example.com/jobs/123-design-intern');
  assert.equal(job?.location, 'London, ON, Canada');
  assert.equal(job?.postedAt, '2026-08-25T00:00:00.000Z');
});

test('custom: Cyber Recruiter discovers Canada pages and parses row groups', () => {
  const index = `<a class="JobLink" href="Careers.aspx?groupvalue=ON-KIT&type=GROUP">Kitchener</a>
    <a class="JobLink" href="Careers.aspx?groupvalue=TX-DAL&type=GROUP">Dallas</a>`;
  assert.deepEqual(discoverCyberRecruiterPages(index, 'https://careers.example.com/'), [
    'https://careers.example.com/Careers.aspx?groupvalue=ON-KIT&type=GROUP',
  ]);
  const html = `<table><tr><td><a class="JobLink" href="Careers.aspx?req=1&type=JOBDESCR">Project Intern</a></td></tr>
    <tr><td>FT/PT Status:</td><td>Full Time</td></tr>
    <tr><td>Location:</td><td>Kitchener</td></tr>
    <tr><td>A student project-management placement supporting automation projects.</td></tr>
    <tr><td><hr></td></tr></table>`;
  const [job] = parseCyberRecruiterJobs(html, {
    kind: 'cyber-recruiter', name: 'Brock', url: 'https://careers.example.com/',
  }, 'https://careers.example.com/Careers.aspx');
  assert.equal(job?.location, 'Kitchener, Canada');
  assert.match(job?.description ?? '', /student project-management/);
});

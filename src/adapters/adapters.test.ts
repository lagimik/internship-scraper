/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownTables, dateCellToIso } from './github-md.js';
import { mapWorkdayPosting, parseWorkdayUrl, parseWorkdayPostedOn } from './workday.js';
import { parseSimplifyListings } from './simplify.js';
import { collectLocations, mapEmploymentType } from './ashby.js';
import { mapOracleRequisition, parseOracleUrl } from './oracle.js';
import { parseDayforceResponse, parseDayforceUrl } from './dayforce.js';
import { parseBambooHrPosting, parseBambooHrUrl } from './bamboohr.js';
import { parseTeslaHtml } from './tesla.js';
import { parseStantecResponse } from './stantec.js';
import { parseSiemensSearchPage, siemensAdapter } from './siemens.js';
import { appleAdapter, parseAppleSearchResponse } from './apple.js';
import { doverAdapter, parseDoverJob, parseDoverUrl } from './dover.js';
import {
  applicantProAdapter,
  parseApplicantProJobs,
  parseApplicantProUrl,
} from './applicantpro.js';
import {
  cornerstoneAdapter,
  parseCornerstoneRequisition,
  parseCornerstoneUrl,
} from './cornerstone.js';
import {
  parseEightfoldResponse,
  parseEightfoldTimestamp,
  parseEightfoldUrl,
} from './eightfold.js';
import { avatureAdapter, parseAvatureSearchPage, parseAvatureUrl } from './avature.js';
import {
  parseTalentBrewSearchPage,
  parseTalentBrewUrl,
  talentBrewAdapter,
} from './talentbrew.js';
import {
  parseTaleoDetailHtml,
  parseTaleoRss,
  parseTaleoSearchResponse,
  parseTaleoUrl,
  taleoAdapter,
} from './taleo.js';
import { parsePhenomJob, parsePhenomSitemap, parsePhenomUrl } from './phenom.js';
import {
  discoverCyberRecruiterPages,
  parseConfiguredHtml,
  parseCyberRecruiterJobs,
  parseMelitronJobs,
} from './custom.js';
import {
  mapSmartRecruitersPosting,
  parseSmartRecruitersUrl,
} from './smartrecruiters.js';

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
  assert.deepEqual(
    parseWorkdayUrl('https://aptiv.wd5.myworkdayjobs.com/APTIV_CAREERS/job/CAN-Kanata-2-ON---WR/Engineering-Intern_J000693018/apply?AdCode=LINKEDIN13'),
    {
      host: 'aptiv',
      dc: 'wd5',
      tenant: 'aptiv',
      site: 'APTIV_CAREERS',
      origin: 'https://aptiv.wd5.myworkdayjobs.com',
    },
  );
  assert.equal(parseWorkdayUrl('https://example.com/careers'), null);
});

test('workday: search posting maps to a canonical job', () => {
  const board = {
    url: 'https://aptiv.wd5.myworkdayjobs.com/APTIV_CAREERS',
    name: 'Aptiv',
  };
  const parsed = parseWorkdayUrl(board.url);
  assert.ok(parsed);
  const job = mapWorkdayPosting({
    title: 'Engineering Intern',
    externalPath: '/job/CAN-Kanata-2-ON---WR/Engineering-Intern_J000693018',
    locationsText: 'CAN Kanata (2), ON - WR',
    postedOn: 'Posted 30+ Days Ago',
    bulletFields: ['J000693018'],
  }, board, parsed);

  assert.equal(job.title, 'Engineering Intern');
  assert.equal(job.company, 'Aptiv');
  assert.equal(job.location, 'CAN Kanata (2), ON - WR');
  assert.equal(job.url, 'https://aptiv.wd5.myworkdayjobs.com/en-US/APTIV_CAREERS/job/CAN-Kanata-2-ON---WR/Engineering-Intern_J000693018');
  assert.equal(job.source, 'workday');
});

test('oracle: supplied J.D. Irving detail URL preserves its site alias', () => {
  assert.deepEqual(parseOracleUrl(
    'https://hcpd.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Careers/job/11598?utm_medium=jobshare',
  ), {
    origin: 'https://hcpd.fa.ca2.oraclecloud.com',
    language: 'en',
    site: 'Careers',
  });
  assert.equal(parseOracleUrl('https://example.com/hcmUI/CandidateExperience/en/sites/Careers'), null);
});

test('oracle: J.D. Irving search requisition maps to a canonical job', () => {
  const board = {
    url: 'https://hcpd.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Careers',
    name: 'J.D. Irving',
  };
  const parsed = parseOracleUrl(board.url);
  assert.ok(parsed);
  const job = mapOracleRequisition({
    Id: '11598',
    Title: 'Corporate Quality Co-op Student - Winter 2027 (8-month term)',
    PostedDate: '2026-09-01',
    PrimaryLocation: 'Toronto, ON, Canada',
    ShortDescriptionStr: 'Irving Consumer Products is seeking a Corporate Quality Co-op Student.',
    workLocation: [{
      LocationName: 'Tissue Plant Toronto',
      TownOrCity: 'Toronto',
      Region3: 'ON',
      Country: 'CA',
    }],
  }, board, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Corporate Quality Co-op Student - Winter 2027 (8-month term)');
  assert.equal(job.company, 'J.D. Irving');
  assert.equal(job.location, 'Toronto, ON, Canada; Tissue Plant Toronto');
  assert.equal(job.url, 'https://hcpd.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Careers/job/11598');
  assert.equal(job.source, 'oracle');
  assert.equal(job.postedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(job.type, 'co-op');
});

test('workday: supplied GM detail URL maps its board and posting', () => {
  const board = {
    url: 'https://generalmotors.wd5.myworkdayjobs.com/Careers_GM/job/Markham-Ontario-Canada/XMLNAME-2027-Winter-Co-op-Lighting-Software-Development---Test_JR-202618179?source=LinkedIn',
    name: 'General Motors',
  };
  const parsed = parseWorkdayUrl(board.url);
  assert.ok(parsed);
  assert.equal(parsed.tenant, 'generalmotors');
  assert.equal(parsed.site, 'Careers_GM');

  const job = mapWorkdayPosting({
    title: '2027 Winter Co-op Lighting Software Development & Test',
    externalPath: '/job/Markham-Ontario-Canada/XMLNAME-2027-Winter-Co-op-Lighting-Software-Development---Test_JR-202618179',
    locationsText: 'Markham, Ontario, Canada',
    postedOn: 'Posted 5 Days Ago',
  }, board, parsed);

  assert.equal(job.title, '2027 Winter Co-op Lighting Software Development & Test');
  assert.equal(job.company, 'General Motors');
  assert.equal(job.location, 'Markham, Ontario, Canada');
  assert.equal(job.url, 'https://generalmotors.wd5.myworkdayjobs.com/en-US/Careers_GM/job/Markham-Ontario-Canada/XMLNAME-2027-Winter-Co-op-Lighting-Software-Development---Test_JR-202618179');
  assert.equal(job.source, 'workday');
});

test('workday: shared-host AB InBev URL maps its board and posting', () => {
  const board = {
    url: 'https://wd1.myworkdaysite.com/en-US/recruiting/abinbev/CAN/details/London-Ontario/Packaging-Intern_30102886?source=LinkedIn',
    name: 'Labatt',
  };
  const parsed = parseWorkdayUrl(board.url);
  assert.deepEqual(parsed, {
    host: 'wd1',
    dc: 'wd1',
    tenant: 'abinbev',
    site: 'CAN',
    origin: 'https://wd1.myworkdaysite.com',
  });

  const job = mapWorkdayPosting({
    title: 'Packaging Intern',
    externalPath: '/job/London-Ontario/Packaging-Intern_30102886',
    locationsText: 'London, Ontario',
    postedOn: 'Posted 12 Days Ago',
    bulletFields: ['30102886'],
  }, board, parsed);

  assert.equal(job.title, 'Packaging Intern');
  assert.equal(job.company, 'Labatt');
  assert.equal(job.location, 'London, Ontario');
  assert.equal(job.url, 'https://wd1.myworkdaysite.com/en-US/recruiting/abinbev/CAN/job/London-Ontario/Packaging-Intern_30102886');
  assert.equal(job.source, 'workday');
});

test('workday: relative postedOn becomes a date', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');
  assert.equal(parseWorkdayPostedOn('Posted Today', now), now.toISOString());
  assert.equal(parseWorkdayPostedOn('Posted 11 Days Ago', now)?.slice(0, 10), '2026-07-23');
  assert.equal(parseWorkdayPostedOn('Posted 30+ Days Ago', now)?.slice(0, 10), '2026-07-04');
  assert.equal(parseWorkdayPostedOn(undefined), null);
});

test('taleo: supplied detail URL exposes the career section identifiers', () => {
  assert.deepEqual(parseTaleoUrl(
    'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en&src=SNS-10025',
  ), {
    origin: 'https://hdr.taleo.net',
    section: 'ex',
    language: 'en',
    jobId: '195537',
    searchUrl: 'https://hdr.taleo.net/careersection/rest/jobboard/searchjobs?lang=en',
  });
  assert.equal(parseTaleoUrl('https://example.com/careersection/ex/jobdetail.ftl?job=1'), null);
});

test('taleo: public search response maps the supplied HDR posting', () => {
  const board = {
    url: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en',
    name: 'HDR',
    portal: '101430233',
  };
  const parsed = parseTaleoUrl(board.url);
  assert.ok(parsed);
  const [job] = parseTaleoSearchResponse({ requisitionList: [{
    contestNo: '195537',
    column: ['CFD Co-op (Winter 2027)', '["Canada-Ontario-Toronto"]', 'Aug 25, 2026'],
    linkedColumn: 0,
    locationsColumns: [1],
  }] }, board, parsed);

  assert.ok(job);
  assert.equal(taleoAdapter([board]).name, 'taleo');
  assert.equal(job.title, 'CFD Co-op (Winter 2027)');
  assert.equal(job.company, 'HDR');
  assert.equal(job.location, 'Canada-Ontario-Toronto');
  assert.equal(job.type, 'co-op');
  assert.equal(job.postedAt, '2026-08-25T00:00:00.000Z');
  assert.equal(job.url, 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en');
  assert.equal(job.source, 'taleo');
});

test('taleo: RSS discovery and detail fields map without a browser session', () => {
  const board = {
    url: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en',
    name: 'HDR',
    portal: '101430233',
  };
  const parsed = parseTaleoUrl(board.url);
  assert.ok(parsed);
  const [job] = parseTaleoRss(`<?xml version="1.0"?><rss><channel><item>
    <title>CFD Co-op (Winter 2027)</title>
    <link>http://hdr.taleo.net/careersection/ex/jobdetail.ftl?lang=en&amp;job=195537</link>
    <description>Computational Fluid Dynamics placement.</description>
    <pubDate>Tue, 25 Aug 2026 12:00:00 EDT</pubDate>
  </item></channel></rss>`, board, parsed);
  assert.ok(job);
  assert.equal(job.url, 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=195537&lang=en');
  assert.equal(job.description, 'Computational Fluid Dynamics placement.');

  const state = Array<string>(37).fill('');
  state[0] = 'descRequisition';
  state[12] = encodeURIComponent('<p>The hourly pay range for Toronto, ON: $21.00 - $31.00</p>');
  state[16] = 'Canada-Ontario-Toronto';
  state[36] = 'Aug 25, 2026';
  const detail = parseTaleoDetailHtml(`
    <div class="contentlinepanel"><span class="subtitle">Primary Location</span>
      <span class="text"></span></div>
    <div class="contentlinepanel"><span class="subtitle">Job Posting</span>
      <span class="text"></span></div>
    <script>x!|!${state.join('!|!')}!|!x</script>
  `);
  assert.equal(detail.location, 'Canada-Ontario-Toronto');
  assert.equal(detail.postedAt, '2026-08-25T00:00:00.000Z');
  assert.equal(detail.salaryRaw, '$21.00 - $31.00 per hour');
  assert.equal(detail.salaryCurrency, 'CAD');
});

test('smartrecruiters: public job URL exposes the exact company identifier', () => {
  assert.deepEqual(parseSmartRecruitersUrl(
    'https://jobs.smartrecruiters.com/GDMSI/744000147548151-co-op-winter-2027-systems-engineering-4-8-months',
  ), { companyIdentifier: 'GDMSI' });
  assert.equal(parseSmartRecruitersUrl('https://example.com/GDMSI/jobs'), null);
});

test('smartrecruiters: public API posting maps canonical job fields', () => {
  const job = mapSmartRecruitersPosting({
    id: '744000147549219',
    name: 'Co-op Winter 2027 – Systems Engineering – 4-8-Months',
    company: {
      identifier: 'GDMSI',
      name: 'General Dynamics Missions System International',
    },
    releasedDate: '2026-09-04T15:16:36.118Z',
    location: {
      city: 'Ottawa',
      region: 'ON',
      country: 'ca',
      remote: false,
      hybrid: true,
      fullLocation: 'Ottawa, ON, Canada',
    },
    typeOfEmployment: { id: 'intern', label: 'Intern' },
    postingUrl: 'https://jobs.smartrecruiters.com/GDMSI/744000147549219-co-op-winter-2027-systems-engineering-4-8-months',
    jobAd: {
      sections: {
        additionalInformation: {
          title: 'Additional Information',
          text: '<p>The expected hourly rate is $24.92 - $33.23.</p><p>You must be eligible to work in Canada.</p>',
        },
      },
    },
  }, {
    url: 'https://jobs.smartrecruiters.com/GDMSI',
    name: 'General Dynamics Missions System International',
  }, 'GDMSI');

  assert.equal(job.title, 'Co-op Winter 2027 – Systems Engineering – 4-8-Months');
  assert.equal(job.company, 'General Dynamics Missions System International');
  assert.equal(job.location, 'Ottawa, ON, Canada');
  assert.equal(job.url, 'https://jobs.smartrecruiters.com/GDMSI/744000147549219-co-op-winter-2027-systems-engineering-4-8-months');
  assert.equal(job.source, 'smartrecruiters');
  assert.equal(job.postedAt, '2026-09-04T15:16:36.118Z');
  assert.equal(job.type, 'co-op');
  assert.match(job.salaryRaw ?? '', /\$24\.92 - \$33\.23/);
  assert.match(job.sponsorship ?? '', /eligible to work in Canada/);
});

test('cornerstone: careers URL exposes tenant and site identifiers', () => {
  const url = 'https://trench.csod.com/ux/ats/careersite/1/home/requisition/1558?c=trench&source=LinkedIn';
  assert.deepEqual(parseCornerstoneUrl(url), {
    origin: 'https://trench.csod.com',
    tenant: 'trench',
    careerSiteId: 1,
  });
  assert.equal(parseCornerstoneUrl('https://example.com/careers'), null);
  assert.equal(parseCornerstoneUrl(
    'https://trench.csod.com/ux/ats/careersite/1/home?c=another-tenant',
  ), null);
});

test('cornerstone: search requisition maps structured job fields', () => {
  assert.equal(cornerstoneAdapter().name, 'cornerstone');
  const board = {
    url: 'https://trench.csod.com/ux/ats/careersite/1/home/requisition/1558?c=trench&source=LinkedIn',
    name: 'Trench Group',
  };
  const parsed = parseCornerstoneUrl(board.url);
  assert.ok(parsed);
  const job = parseCornerstoneRequisition({
    requisitionId: 1558,
    postingEffectiveDate: '3/19/2026',
    displayJobTitle: ' Engineering and R&D intern - Mechanical Design (12-month, Fall Start) ',
    locations: [{ city: 'Pickering', state: 'Ontario', country: 'CA' }],
    externalDescription: ' Develop 3D models.  Revise material specifications. ',
  }, board, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Engineering and R&D intern - Mechanical Design (12-month, Fall Start)');
  assert.equal(job.company, 'Trench Group');
  assert.equal(job.location, 'Pickering, Ontario, Canada');
  assert.equal(job.type, 'intern');
  assert.equal(job.postedAt, '2026-03-19T00:00:00.000Z');
  assert.equal(job.url, 'https://trench.csod.com/ux/ats/careersite/1/home/requisition/1558?c=trench');
  assert.equal(job.source, 'cornerstone');
  assert.equal(job.description, 'Develop 3D models. Revise material specifications.');
});

test('dover: careers URL decomposes into public API identifiers', () => {
  const parsed = parseDoverUrl(
    'https://app.dover.com/Fabri/careers/4330a65c-241b-44e3-9524-1f8bb2f514d7',
  );
  assert.deepEqual(parsed, {
    origin: 'https://app.dover.com',
    slug: 'Fabri',
    clientId: '4330a65c-241b-44e3-9524-1f8bb2f514d7',
  });
  assert.equal(parseDoverUrl('https://example.com/Fabri/careers/123'), null);
  assert.equal(parseDoverUrl('https://app.dover.com/apply/Fabri/123'), null);
});

test('dover: detail response maps structured fields', () => {
  assert.equal(doverAdapter().name, 'dover');
  const board = {
    url: 'https://app.dover.com/Fabri/careers/4330a65c-241b-44e3-9524-1f8bb2f514d7',
    name: 'Fabri',
  };
  const parsed = parseDoverUrl(board.url);
  assert.ok(parsed);
  const job = parseDoverJob({
    id: '69e29c52-4577-440e-a08c-e36c42d67a6f',
    client_name: 'Fabri',
    title: ' Mechanical Engineering Intern - Winter 2027 ',
    user_provided_description: '<p>Complete a four-month work term.</p>',
    locations: [{
      name: 'Toronto, ON, Canada',
      location_option: { display_name: 'Toronto, Ontario, Canada' },
    }],
    workplace_type: 'HYBRID',
    compensation: {
      lower_bound: 25,
      upper_bound: 35,
      currency_code: 'CAD',
      salary_range_type: 'HOURLY',
      employment_type: 'INTERNSHIP',
    },
    visa_support: false,
    created: '2026-08-31T20:04:43Z',
    active: true,
    is_private: false,
  }, board, parsed);

  assert.ok(job);
  assert.equal(job.title, 'Mechanical Engineering Intern - Winter 2027');
  assert.equal(job.location, 'Toronto, ON, Canada');
  assert.equal(job.type, 'intern');
  assert.equal(job.salaryRaw, '25 - 35 CAD hourly');
  assert.equal(job.salaryCurrency, 'CAD');
  assert.equal(job.sponsorship, 'No visa sponsorship');
  assert.equal(job.postedAt, '2026-08-31T20:04:43.000Z');
  assert.equal(job.url, 'https://app.dover.com/apply/Fabri/69e29c52-4577-440e-a08c-e36c42d67a6f/');
  assert.equal(job.description, 'Complete a four-month work term.');
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

test('avature: Siemens Energy Jobs template maps the supplied posting shape', () => {
  assert.equal(avatureAdapter().name, 'avature');
  const board = {
    url: 'https://jobs.siemens-energy.com/en_US/jobs/Jobs?29454=964508&29454_format=11381&listFilterMode=1&folderRecordsPerPage=20',
    name: 'Siemens Energy',
    country: 'Canada',
  };
  assert.deepEqual(parseAvatureUrl(board.url), {
    origin: 'https://jobs.siemens-energy.com',
    searchPath: '/en_US/jobs/Jobs',
  });

  const page = parseAvatureSearchPage(`<article class="article article--result">
    <h3><a href="/en_US/jobs/FolderDetail/Field-Service-Representative-Co-op-Student/289506">
      Field Service Representative Co-op Student
    </a></h3>
  </article>`, board);

  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0]?.title, 'Field Service Representative Co-op Student');
  assert.equal(page.jobs[0]?.company, 'Siemens Energy');
  assert.equal(page.jobs[0]?.location, 'Canada');
  assert.equal(page.jobs[0]?.source, 'avature');
  assert.equal(
    page.jobs[0]?.url,
    'https://jobs.siemens-energy.com/en_US/jobs/FolderDetail/Field-Service-Representative-Co-op-Student/289506',
  );
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

test('applicantpro: public API URL decomposes into board identifiers', () => {
  assert.deepEqual(parseApplicantProUrl(
    'https://martinrea.prevueaps.com/core/jobs/596?getParams=%7B%7D',
  ), {
    origin: 'https://martinrea.prevueaps.com',
    tenant: 'martinrea',
    siteId: 596,
    endpoint: 'https://martinrea.prevueaps.com/core/jobs/596?getParams=%7B%7D',
  });
  assert.equal(parseApplicantProUrl('https://example.com/core/jobs/596'), null);
  assert.equal(parseApplicantProUrl('https://martinrea.prevueaps.com/jobs/596'), null);
});

test('applicantpro: structured jobs map location, type, salary and date', () => {
  assert.equal(applicantProAdapter().name, 'applicantpro');
  const board = {
    name: 'Martinrea',
    url: 'https://martinrea.prevueaps.com/core/jobs/596?getParams=%7B%7D',
  };
  const parsed = parseApplicantProUrl(board.url);
  assert.ok(parsed);
  const [job] = parseApplicantProJobs({ data: { jobs: [{
    id: 332542,
    title: 'Mechanical Engineering Intern',
    startDateRef: 'Aug 20, 2026',
    jobLocation: 'Vaughan, ON, Canada',
    workplaceType: 'Onsite',
    employmentType: 'Intern',
    minSalary: '25.50',
    maxSalary: '32.00',
    payTypeFrame: 'per hour',
    iso3: 'CAN',
    classification: 'Engineering',
    jobUrl: 'https://martinrea.prevueaps.com/jobs/332542',
  }] } }, board, parsed);
  assert.equal(job?.title, 'Mechanical Engineering Intern');
  assert.equal(job?.location, 'Vaughan, ON, Canada');
  assert.equal(job?.type, 'intern');
  assert.equal(job?.postedAt?.slice(0, 10), '2026-08-20');
  assert.equal(job?.salaryRaw, '25.50 - 32.00 CAD per hour');
  assert.equal(job?.salaryMin, 25.5);
  assert.equal(job?.salaryMax, 32);
  assert.equal(job?.salaryCurrency, 'CAD');
  assert.equal(job?.source, 'applicantpro');
  assert.equal(job?.description, 'Category: Engineering');
});

test('talentbrew: job URL decomposes into search identifiers', () => {
  assert.deepEqual(parseTalentBrewUrl(
    'https://careers.l3harris.com/en/job/-/-/4832/100087751328?src=SNS-10240',
  ), {
    origin: 'https://careers.l3harris.com',
    locale: 'en',
    organizationId: '4832',
    searchUrl: 'https://careers.l3harris.com/en/search-jobs',
  });
  assert.equal(parseTalentBrewUrl('https://example.com/en/search-jobs'), null);
});

test('talentbrew: search cards map title, location, category and pagination', () => {
  assert.equal(talentBrewAdapter().name, 'talentbrew');
  const board = {
    name: 'L3Harris Technologies',
    url: 'https://careers.l3harris.com/en/job/-/-/4832/100087751328',
  };
  const parsed = parseTalentBrewUrl(board.url);
  assert.ok(parsed);
  const page = parseTalentBrewSearchPage(`<ul><li>
    <a href="/en/job/waterdown/electro-mechanical-technician-co-op/4832/100087751328"
      data-job-id="100087751328">
      <h2> Electro-Mechanical Technician Co-op </h2>
      <span class="results-facet job-category">Engineering</span>
      <span class="results-facet job-location">Waterdown, Ontario</span>
    </a></li></ul><a class="next" href="/en/search-jobs?k=co-op&amp;p=2">Next</a>`,
  board, parsed);

  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0]?.title, 'Electro-Mechanical Technician Co-op');
  assert.equal(page.jobs[0]?.company, 'L3Harris Technologies');
  assert.equal(page.jobs[0]?.location, 'Waterdown, Ontario');
  assert.equal(page.jobs[0]?.url,
    'https://careers.l3harris.com/en/job/waterdown/electro-mechanical-technician-co-op/4832/100087751328');
  assert.equal(page.jobs[0]?.source, 'talentbrew');
  assert.equal(page.jobs[0]?.description, 'Job category: Engineering');
  assert.equal(page.nextPage, 2);
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

test('custom: Melitron WordPress rows map title, location and URL', () => {
  const [job] = parseMelitronJobs(`
    <div><p><a href="/our-job/engineering-co-op-student-2/" class="jobID">
      <strong>Engineering Co-op Student</strong><br><strong>ID 253408</strong></a><br>
      Location:&nbsp; Guelph, ON Canada<br>
      Schedule:&nbsp; Mon-Fri; 8:00am-4:30pm<br>
      <span class="readMore"><a href="/our-job/engineering-co-op-student-2/">Position details</a></span>
    </p></div>`, {
    kind: 'melitron', name: 'Melitron', url: 'https://www.melitron.com/careers/',
  });
  assert.equal(job?.title, 'Engineering Co-op Student');
  assert.equal(job?.location, 'Guelph, ON Canada');
  assert.equal(job?.url, 'https://www.melitron.com/our-job/engineering-co-op-student-2/');
  assert.equal(job?.source, 'custom');
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

test('phenom: supplied Trane URL exposes the locale root and requisition id', () => {
  assert.deepEqual(parsePhenomUrl(
    'https://careers.tranetechnologies.com/global/en/job/JR-15026/2027-Energy-Engineering-Intern?utm_medium=phenom-feeds',
  ), {
    origin: 'https://careers.tranetechnologies.com',
    sitePath: '/global/en',
    jobId: 'JR-15026',
  });
  assert.equal(parsePhenomUrl('https://example.com/not-a-phenom-shape'), null);
});

test('phenom: sitemap and JobPosting JSON-LD map the supplied posting', () => {
  const url = 'https://careers.tranetechnologies.com/global/en/job/JR-15026/2027-Energy-Engineering-Intern';
  assert.deepEqual(parsePhenomSitemap(
    `<urlset><url><loc>${url}</loc></url></urlset>`,
  ), [url]);
  const html = `
    <link rel="canonical" href="${url}">
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: '2027 Energy Engineering Intern',
      datePosted: '2026-09-06',
      employmentType: ['FULL_TIME'],
      description: '<p>Candidates must have the legal right to work in Canada.</p>',
      hiringOrganization: { '@type': 'Organization', name: 'trane technologies' },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Markham',
          addressRegion: 'Ontario',
          addressCountry: 'Canada',
        },
      },
    })}</script>`;
  const job = parsePhenomJob(html, {
    url: 'https://careers.tranetechnologies.com/global/en',
    name: 'Trane Technologies',
    refNum: 'TRTEGLOBAL',
    locale: 'en_global',
  }, url);
  assert.ok(job);
  assert.equal(job.title, '2027 Energy Engineering Intern');
  assert.equal(job.company, 'Trane Technologies');
  assert.equal(job.location, 'Markham, Ontario, Canada');
  assert.equal(job.url, url);
  assert.equal(job.source, 'phenom');
  assert.equal(job.postedAt, '2026-09-06T00:00:00.000Z');
  assert.equal(job.type, 'intern');
  assert.equal(job.sponsorship, 'Candidates must have the legal right to work in Canada.');
});

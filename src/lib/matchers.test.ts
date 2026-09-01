/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocations } from './location.js';
import { matchRole, classifyType } from './roles.js';
import { isFourMonthEligible, matchWorkTerm } from './work-term.js';

const match = (location: string, country: 'CA' | 'US') =>
  matchLocations(location).find((result) => result.country === country);

test('canada: real location strings from live sources', () => {
  // Shapes observed in live Greenhouse + GitHub data.
  assert.ok(match('Toronto', 'CA'));
  assert.equal(match('Toronto, Canada', 'CA')?.confidence, 'confirmed');
  assert.equal(match('Canada', 'CA')?.confidence, 'confirmed');
  assert.equal(match('Toronto, ON', 'CA')?.region, 'ON');
  // Job Bank's parenthesized format, incl. towns not in the city list.
  assert.equal(match('Havelock (ON)', 'CA')?.region, 'ON');
  assert.equal(match('Saint-Bruno (QC)', 'CA')?.region, 'QC');
  assert.equal(match('Vancouver, Canada +1', 'CA')?.region, 'BC');
  assert.equal(match('Montreal, Quebec', 'CA')?.region, 'QC');

  const multi = matchLocations('New York, San Francisco, Seattle, or Remote (US/Canada)');
  assert.deepEqual(new Set(multi.map((result) => result.country)), new Set(['CA', 'US']));
  assert.ok(multi.every((result) => result.remote));
});

test('locations: recognizes US locations and rejects other countries', () => {
  const usLocations: Array<[string, string]> = [
    ['San Francisco, CA', 'CA'], ['Austin, TX', 'TX'],
    ['Seattle, Washington', 'WA'], ['Boston, MA, USA', 'MA'],
  ];
  for (const [location, region] of usLocations) {
    assert.equal(match(location, 'US')?.region, region, `should match ${location}`);
  }
  for (const location of ['Bengaluru, India', 'Sydney, Australia', 'Berlin, Germany',
                           'Dublin, Ireland', 'Cairo, Egypt', 'Riyadh, Saudi Arabia']) {
    assert.equal(matchLocations(location).length, 0, `should reject ${location}`);
  }
});

test('canada: ambiguous city names are kept but flagged', () => {
  // London ON vs London UK; Vancouver BC vs Vancouver WA.
  assert.equal(match('London', 'CA')?.confidence, 'ambiguous');
  assert.equal(match('London, United Kingdom', 'CA'), undefined);
  assert.equal(match('London, Ontario', 'CA')?.confidence, 'confirmed');
  assert.equal(match('Vancouver, WA, United States', 'CA'), undefined);
  assert.equal(match('Vancouver, WA, United States', 'US')?.region, 'WA');
});

test('canada: remote handling', () => {
  assert.equal(match('Remote - Canada', 'CA')?.confidence, 'confirmed');
  assert.deepEqual(matchLocations('Remote - North America').map((result) => result.country).sort(), ['CA', 'US']);
  assert.equal(match('Remote - US only', 'CA'), undefined);
  assert.equal(match('Remote - US only', 'US')?.confidence, 'confirmed');
});

test('work terms: accepts Winter 2027 and Hiver 2027 postings', () => {
  for (const text of [
    'Winter 2027', '2027 Winter', 'Hiver 2027', '2027 Hiver',
    'Starting January 2027', 'Internship beginning January 2027',
    'Débutant en janvier 2027', 'Stage - janvier 2027',
    'January to April 2027', 'Janvier à avril 2027',
  ]) {
    const term = matchWorkTerm(`Mechanical Intern - ${text}`, null);
    assert.equal(isFourMonthEligible(term), true, `should accept ${text}`);
    assert.equal(term.months, 4);
  }
});

test('work terms: rejects other terms and unspecified postings', () => {
  for (const text of [
    'Winter 2026', 'Spring 2027', 'Summer 2027', 'Fall 2027',
    'Hiver 2026', 'Printemps 2027', 'Starting May 2027',
    'Mechanical Intern', '4-month Mechanical Intern',
  ]) {
    assert.equal(isFourMonthEligible(matchWorkTerm(text, null)), false, `should reject ${text}`);
  }
});

test('work terms: incompatible durations override Winter/Hiver 2027 wording', () => {
  for (const text of ['8 months', 'eight-month', '12 months', '32 weeks', 'huit mois']) {
    const term = matchWorkTerm(`Winter 2027 Mechanical Intern - ${text}`, null);
    assert.equal(isFourMonthEligible(term), false, `should reject ${text}`);
  }
  assert.equal(isFourMonthEligible(matchWorkTerm('Hiver 2027 - stage de quatre mois', null)), true);
});

test('roles: target titles match', () => {
  const cases: Array<[string, string]> = [
    ['Mechanical Engineer', 'mechanical-engineering'],
    ['Mechanical Engineering Intern - Summer 2027', 'mechanical-engineering'],
    ['Mechatronics Engineer Co-op', 'mechatronics'],
    ['Electromechanical Engineering Student', 'mechatronics'],
    ['Design for Manufacturing Engineer', 'design-manufacturing'],
    ['Mechanical Design Engineer Intern', 'design-manufacturing'],
    ['Tooling Design Engineer', 'design-manufacturing'],
    ['Product Engineering Intern', 'design-manufacturing'],
    ['Product Engineer Co-op', 'design-manufacturing'],
    ['Design Engineering Intern', 'design-manufacturing'],
    ['Design Engineer Co-op', 'design-manufacturing'],
    ['Materials Engineering Co-op', 'materials-engineering'],
    ['Metallurgical Engineer Intern', 'materials-engineering'],
    ['Manufacturing Engineer Intern', 'manufacturing-engineering'],
    ['Industrial Engineering Student', 'manufacturing-engineering'],
    ['Engineering Project Manager', 'project-management'],
    ['Manufacturing Program Manager', 'program-management'],
  ];
  for (const [title, category] of cases) {
    const m = matchRole(title);
    assert.equal(m.matches, true, `should match: ${title}`);
    assert.equal(m.category, category, `wrong category for: ${title}`);
  }
});

test('roles: common unordered and qualified title permutations match', () => {
  const cases: Array<[string, string]> = [
    ['Summer Intern, Mechanical Systems', 'mechanical-engineering'],
    ['Student - Mechanical Designer', 'design-manufacturing'],
    ['Co-op, Product CAD Design', 'design-manufacturing'],
    ['Intern - Polymer Materials', 'materials-engineering'],
    ['Quality Engineering Co-op', 'manufacturing-engineering'],
    ['Supplier Quality Intern', 'manufacturing-engineering'],
    ['2027 Summer Intern - Manufacturing Controls Engineer', 'manufacturing-engineering'],
    ['Co-op - Process Improvement', 'manufacturing-engineering'],
    ['Industrial Automation Student', 'manufacturing-engineering'],
    ['NPI Engineering Intern', 'manufacturing-engineering'],
    ['Student Project Coordinator - Manufacturing', 'project-management'],
    ['Engineering Services Project Controls Student', 'project-management'],
    ['Co-op, Technical Program Assistant', 'program-management'],
  ];
  for (const [title, category] of cases) {
    const m = matchRole(title);
    assert.equal(m.matches, true, `should match: ${title}`);
    assert.equal(m.category, category, `wrong category for: ${title}`);
  }
});

test('roles: computing and business titles are excluded', () => {
  for (const t of [
    'DevOps Engineer Intern',
    'Site Reliability Engineer Co-op',
    'Computer Science Intern',
    'Computing Science Student',
    'Data Science Intern',
    'Data Engineer Co-op',
    'Software Engineering Project Manager',
    'Machine Learning Engineer Intern',
    'Backend Developer Co-op',
    'Financial Analyst Intern',
  ]) {
    assert.equal(matchRole(t).matches, false, `should exclude: ${t}`);
  }
});

test('roles: false positives excluded', () => {
  const bad = [
    'Sales Engineer',
    'Solutions Engineer',
    'Customer Engineer',
    'Civil Engineer Intern',
    'Electrical Engineer Co-op',
    'Technical Recruiter',
    'Product Manager',
    'Marketing Intern',
    'Quality Assurance Tester Intern',
    'QA Automation Co-op',
    'Test Automation Engineer Intern',
    'Business Operations Intern',
    'Sales Operations Co-op',
    'Product Management Intern',
    'Industrial Solutions Intern',
    'Operations Intern',
    'Logistics Co-op',
  ];
  for (const title of bad) {
    assert.equal(matchRole(title).matches, false, `should exclude: ${title}`);
  }
});

test('roles: job type classification', () => {
  assert.equal(classifyType('Mechanical Engineer Intern'), 'intern');
  // "Intern" beats "Co-op" when a title says both, so internships don't get split
  // across two filter values in the UI.
  assert.equal(classifyType('Mechanical Engineering Intern - Fall-Spring Co-op'), 'intern');
  assert.equal(classifyType('Manufacturing Co-op - Fall 2026'), 'intern');
  // Co-op still fires on its own when nothing says "intern".
  assert.equal(classifyType('Mechatronics Coop'), 'co-op');
  assert.equal(classifyType('Mechanical Engineering CO-OP'), 'co-op');
  assert.equal(classifyType('New Grad Mechanical Engineer'), 'new-grad');
  assert.equal(classifyType('Mechanical Engineer'), 'full-time');
});

test('roles: student-first titles match only target disciplines', () => {
  for (const t of [
    'Intern - Mechanical Engineering',
    'Co-op - Mechatronics',
    'Student, Materials Engineering',
    'Placement - Manufacturing Engineering',
    'Intern - Engineering Project Management',
    'Co-op - Engineering Program Management',
  ]) {
    assert.equal(matchRole(t).matches, true, `should match: ${t}`);
  }
  for (const t of [
    'Engineering Intern',
    'Marketing Intern',
    'Finance Co-op',
    'Sales Engineer Intern',
    'DevOps Intern',
    'Computer Science Co-op',
    'Data Science Student',
    'HR Intern',
  ]) {
    assert.equal(matchRole(t).matches, false, `should exclude: ${t}`);
  }
});

test('roles: design-for-manufacturing phrases match', () => {
  const m = matchRole('DFM Engineering Intern');
  assert.equal(m.matches, true);
  assert.equal(m.category, 'design-manufacturing');
  assert.equal(m.type, 'intern');
  assert.equal(matchRole('Design for Manufacturability Co-op').matches, true);
  assert.equal(matchRole('Student Success Manager').matches, false);
});

test('roles: French titles (Quebec postings)', () => {
  assert.equal(classifyType('Stagiaire en génie mécanique'), 'intern');
  assert.equal(matchRole('Stagiaire en génie mécanique').category, 'mechanical-engineering');
  assert.equal(matchRole('Ingénieure en mécanique').matches, true);
  assert.equal(matchRole('Stage - Conception mécanique').category, 'design-manufacturing');
  assert.equal(matchRole('Stagiaire DevOps - Automne 2026').matches, false);
});

/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCanada } from './canada.js';
import { matchRole, classifyType } from './roles.js';

test('canada: real location strings from live sources', () => {
  // Shapes observed in live Greenhouse + GitHub data.
  assert.equal(matchCanada('Toronto').isCanada, true);
  assert.equal(matchCanada('Toronto, Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Toronto, ON').province, 'ON');
  // Job Bank's parenthesized format, incl. towns not in the city list.
  assert.equal(matchCanada('Havelock (ON)').province, 'ON');
  assert.equal(matchCanada('Saint-Bruno (QC)').province, 'QC');
  assert.equal(matchCanada('Vancouver, Canada +1').province, 'BC');
  assert.equal(matchCanada('Montreal, Quebec').province, 'QC');

  const multi = matchCanada('New York, San Francisco, Seattle, or Remote (US/Canada)');
  assert.equal(multi.isCanada, true);
  assert.equal(multi.remote, true);
});

test('canada: rejects non-Canadian locations', () => {
  for (const loc of ['San Francisco, CA', 'Bengaluru, India', 'Sydney, Australia',
                     'Berlin, Germany', 'Dublin, Ireland', 'Cairo, Egypt', 'Riyadh, Saudi Arabia']) {
    assert.equal(matchCanada(loc).isCanada, false, `should reject ${loc}`);
  }
});

test('canada: ambiguous city names are kept but flagged', () => {
  // London ON vs London UK; Vancouver BC vs Vancouver WA.
  assert.equal(matchCanada('London').confidence, 'ambiguous');
  assert.equal(matchCanada('London, United Kingdom').isCanada, false);
  assert.equal(matchCanada('London, Ontario').confidence, 'confirmed');
  assert.equal(matchCanada('Vancouver, WA, United States').isCanada, false);
});

test('canada: remote handling', () => {
  assert.equal(matchCanada('Remote - Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Remote - North America').confidence, 'ambiguous');
  assert.equal(matchCanada('Remote - US only').isCanada, false);
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

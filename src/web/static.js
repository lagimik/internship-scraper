const data = JSON.parse(document.getElementById('dashboard-data').textContent);
const $ = (id) => document.getElementById(id);
const controls = ['q', 'source', 'category', 'type', 'province', 'sort', 'remote'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function fillSelect(element, items) {
  const first = element.querySelector('option').outerHTML;
  element.innerHTML = first + items.map((item) =>
    `<option value="${esc(item.v)}">${esc(item.v)} (${item.n})</option>`).join('');
}

// Calendar days, not elapsed 24-hour periods.
function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function jobTime(job) {
  const time = Date.parse(job.posted_at || job.first_seen_at);
  return Number.isNaN(time) ? 0 : time;
}

function filteredJobs() {
  const query = $('q').value.trim().toLocaleLowerCase();
  const source = $('source').value;
  const category = $('category').value;
  const type = $('type').value;
  const province = $('province').value;
  const remoteOnly = $('remote').checked;

  const jobs = data.jobs.filter((job) => {
    if (query && ![job.title, job.company, job.location]
      .some((value) => String(value ?? '').toLocaleLowerCase().includes(query))) return false;
    if (source && job.source !== source) return false;
    if (category && job.role_category !== category) return false;
    if (type && job.type !== type) return false;
    if (province && job.province !== province) return false;
    if (remoteOnly && !job.remote) return false;
    return true;
  });

  const direction = $('sort').value === 'oldest' ? 1 : -1;
  jobs.sort((a, b) => direction * (jobTime(a) - jobTime(b)) || a.company.localeCompare(b.company));
  return jobs;
}

function render() {
  const jobs = filteredJobs();
  $('count').textContent = `${jobs.length} of ${data.facets.total} jobs`;
  $('list').innerHTML = jobs.length ? jobs.map((job) => {
    let sources;
    try { sources = JSON.parse(job.sources); } catch { sources = [job.source]; }
    const tags = [
      job.role_category && `<span class="tag ${esc(job.role_category)}">${esc(job.role_category)}</span>`,
      job.type && `<span class="tag">${esc(job.type)}</span>`,
      job.remote ? '<span class="tag">remote</span>' : '',
      job.canada_confidence === 'ambiguous'
        ? `<span class="tag amb" title="Location rule: ${esc(job.canada_matched_by)}">location?</span>` : '',
    ].filter(Boolean).join('');

    return `<article class="job">
      <div>
        <h2><a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a></h2>
        <div class="meta">
          <strong style="color:var(--fg)">${esc(job.company)}</strong>
          <span>·</span><span>${esc(job.location) || '-'}</span>
          ${job.salary_raw ? `<span>·</span><span>${esc(job.salary_raw)}</span>` : ''}
          <span>·</span><span title="${esc(job.posted_at || job.first_seen_at)}">${ago(job.posted_at || job.first_seen_at)}</span>
          <span>·</span><span>${sources.map(esc).join(' + ')}</span>
          ${tags}
        </div>
      </div>
    </article>`;
  }).join('') : '<div class="empty">No jobs match these filters.</div>';
}

fillSelect($('source'), data.facets.sources);
fillSelect($('category'), data.facets.categories);
fillSelect($('type'), data.facets.types);
fillSelect($('province'), data.facets.provinces);

const generated = new Date(data.generatedAt).toLocaleString();
$('runs').innerHTML = `<strong>Static snapshot generated ${esc(generated)}.</strong> ` +
  data.facets.runs.map((run) =>
    `<span class="${run.ok ? 'good' : 'bad'}">${esc(run.source)} ${run.ok ? `✓ ${run.kept} kept` : `✗ ${esc((run.error || '').slice(0, 60))}`}</span>`
  ).join(' · ');

let timer;
for (const id of controls) {
  const element = $(id);
  const event = element.tagName === 'INPUT' && element.type === 'search' ? 'input' : 'change';
  element.addEventListener(event, () => {
    clearTimeout(timer);
    timer = setTimeout(render, event === 'input' ? 220 : 0);
  });
}

render();
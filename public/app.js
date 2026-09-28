// Ziran / Xeno interface. Plain JS, no dependencies. Nodes are events and differences, never persons/concepts.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 3) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(d)) : v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const brief = (v) => { const x = fmt(v); return x.length > 60 ? x.slice(0, 57) + '…' : x; };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const color = (s) => `hsl(${hue(s)} 55% 48%)`;

const S = { presets: [], preset: null, params: {}, perts: [], runs: [], run: null, analysis: null, evFrom: 0, evKinds: '', types: [] };

// ------------------------------------------------------------------ theme & tabs
(() => {
  try { const t = localStorage.getItem('zx-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
  $('#theme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = nx; try { localStorage.setItem('zx-theme', nx); } catch {}
  };
  $$('.tabs button').forEach((b) => b.onclick = () => {
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b)); $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'compare') fillCompare();
    if (b.dataset.tab === 'bench') loadBench();
    if (b.dataset.tab === 'meta') loadMeta();
  });
})();

// ------------------------------------------------------------------ presets
async function init() {
  [S.presets, S.types] = await Promise.all([api('/api/presets'), api('/api/perturbation-types')]);
  renderPresets();
  await refreshRuns();
  $('#preset-filter').oninput = renderPresets;
}
// Representative public demos: a small set chosen for conceptual clarity. All other presets stay available below.
const FEATURED = [
  ['observation.hidden-phase', 'Observation aliasing and revision', 'Analyses → Observation revisions'],
  ['timing.too-late-correction', 'Too-late correction', 'Analyses → Timing / corrections'],
  ['fragility.shared-load', 'Fragility transfer', 'Compare a baseline with a perturbed run'],
  ['open.relation-spread', 'Relation-valued vs scalar-valued representation', 'Domain analysis; benchmark F'],
  ['science.delayed-law', 'Grammar-bounded vs grammar morphogenesis', 'Analyses → Domain (grammar lineage); benchmark B'],
  ['observation.sensor-budget', 'Pareto-axis sensitivity', 'Analyses → Observation revisions; MB4'],
  ['market.synthetic', 'Trace-schema sensitivity', 'Analyses → Operational bundles → run trace-schema sensitivity; MB3'],
  ['thought.reignition', 'Historically constrained operational reconstruction', 'Analyses → Domain'],
  ['market.synthetic', 'Trader-category necessity: unresolved case', 'Analyses → Domain; benchmark D'],
];
function renderPresets() {
  const q = $('#preset-filter').value.toLowerCase();
  const byArea = {};
  for (const p of S.presets) if (!q || (p.id + p.title + p.area).toLowerCase().includes(q)) (byArea[p.area] ??= []).push(p);
  const box = $('#presets'); box.innerHTML = '';
  if (!q) {
    box.append(el('div', { class: 'area' }, 'representative demos'));
    FEATURED.forEach(([id, focus, where], i) => {
      const p = S.presets.find((x) => x.id === id); if (!p) return;
      const b = el('button', { class: 'preset featured', title: `${p.title} — ${where}` }, `<span class="L">${i + 1}</span>${esc(focus)}<span class="hint" style="display:block;font-size:10.5px">${esc(p.id)} · ${esc(where)}</span>`);
      b.onclick = () => selectPreset(p); box.append(b);
    });
    box.append(el('div', { class: 'area' }, `all presets (${S.presets.length})`));
  }
  for (const [area, ps] of Object.entries(byArea)) {
    box.append(el('div', { class: 'area' }, esc(area)));
    for (const p of ps.sort((a, b) => (a.layer ?? 99) - (b.layer ?? 99))) {
      const b = el('button', { class: 'preset' + (S.preset?.id === p.id ? ' on' : ''), title: p.summary }, `<span class="L">L${p.layer ?? '–'}</span>${esc(p.title)}`);
      b.onclick = () => selectPreset(p); box.append(b);
    }
  }
}
function selectPreset(p) {
  S.preset = p; S.params = structuredClone(p.defaults); S.perts = [];
  renderPresets(); renderConfig();
}

function renderConfig() {
  const p = S.preset, box = $('#config');
  box.innerHTML = `
    <div class="panel-h"><h2>${esc(p.title)}</h2><span class="hint mono">${esc(p.id)}</span></div>
    <div>${esc(p.summary)}</div>
    ${p.questions?.length ? `<ul class="questions">${p.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    <div class="cfg-grid" id="params"></div>
    <div class="panel-h"><h3>Perturbations</h3><span class="hint">experiment types — applied before the run, or at time <code>at</code> as traced reorganizations</span></div>
    <div class="row">
      <label>type <select id="pt-type">${S.types.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="grow">JSON <textarea id="pt-json" rows="2"></textarea></label>
      <button id="pt-add" class="ghost">Add</button>
    </div>
    ${p.perturbations?.length ? `<div class="hint" style="margin-top:6px">Suggested: ${p.perturbations.map((x, i) => `<button class="ghost" data-sug="${i}">${esc(x.label)}</button>`).join(' ')}</div>` : ''}
    <div class="pert-list" id="pert-list"></div>
    <div class="row" style="margin-top:10px">
      <button id="btn-run">Run</button>
      <label>parallel seeds <input id="n-seeds" type="number" value="3" min="2" max="12" style="width:70px"></label>
      <button id="btn-seeds" class="ghost">Run seeds in parallel</button>
      <button id="btn-ab" class="ghost" title="baseline and perturbed, side by side">Run with / without perturbations</button>
      <span id="run-status" class="hint"></span>
    </div>`;
  const grid = $('#params');
  for (const [k, v] of Object.entries(S.params)) {
    const opts = p.options?.[k];
    const lab = el('label', {}, esc(k));
    let inp;
    if (Array.isArray(v) && opts) {
      inp = el('div', { class: 'chips' }, opts.map((o) => `<span class="chip${v.includes(o) ? ' on' : ''}" data-o="${esc(o)}">${esc(o)}</span>`).join(''));
      inp.onclick = (e) => { const o = e.target.dataset?.o; if (!o) return; const arr = S.params[k]; const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1); else arr.push(o); e.target.classList.toggle('on'); };
      lab.style.gridColumn = '1 / -1';
    } else if (opts) {
      inp = el('select', {}, opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')); inp.onchange = () => (S.params[k] = inp.value);
    } else if (typeof v === 'boolean') {
      inp = el('input', { type: 'checkbox' }); inp.checked = v; inp.onchange = () => (S.params[k] = inp.checked);
    } else if (typeof v === 'number') {
      inp = el('input', { type: 'number', step: 'any', value: v }); inp.oninput = () => (S.params[k] = Number(inp.value));
    } else {
      inp = el('input', { type: 'text', value: Array.isArray(v) ? JSON.stringify(v) : v });
      inp.oninput = () => { try { S.params[k] = Array.isArray(v) ? JSON.parse(inp.value) : inp.value; } catch {} };
    }
    lab.append(inp); grid.append(lab);
  }
  const tpl = () => { $('#pt-json').value = JSON.stringify(TEMPLATES[$('#pt-type').value] ?? { type: $('#pt-type').value }); };
  $('#pt-type').onchange = tpl; tpl();
  $('#pt-add').onclick = () => { try { S.perts.push(JSON.parse($('#pt-json').value)); renderPerts(); } catch (e) { alert('Invalid JSON: ' + e.message); } };
  $$('[data-sug]').forEach((b) => b.onclick = () => { S.perts.push(...structuredClone(p.perturbations[b.dataset.sug].list)); renderPerts(); });
  renderPerts();
  $('#btn-run').onclick = () => go([{ preset: p.id, params: S.params, perturbations: S.perts }]);
  $('#btn-seeds').onclick = () => { const n = Number($('#n-seeds').value) || 3; const s0 = Number(S.params.seed ?? 1); go(Array.from({ length: n }, (_, i) => ({ preset: p.id, params: { ...S.params, seed: s0 + i }, seed: s0 + i, perturbations: S.perts, label: `${p.id} · seed ${s0 + i}` }))); };
  $('#btn-ab').onclick = () => go([{ preset: p.id, params: S.params, perturbations: [], label: `${p.id} · baseline` }, { preset: p.id, params: S.params, perturbations: S.perts, label: `${p.id} · ${S.perts.length} perturbation(s)` }]);
}
function renderPerts() {
  const box = $('#pert-list'); box.innerHTML = '';
  S.perts.forEach((x, i) => { const d = el('div', { class: 'pert' }, `<code>${esc(JSON.stringify(x))}</code>`); const b = el('button', { class: 'ghost' }, '×'); b.onclick = () => { S.perts.splice(i, 1); renderPerts(); }; d.append(b); box.append(d); });
}
const TEMPLATES = {
  configuration: { type: 'configuration', key: 'environment', patch: { value: 'windy', status: 'partial' } },
  observation: { type: 'observation', apparatus: 'A', channel: 'x', patch: { resolution: 0.25 } },
  boundary: { type: 'boundary', apparatus: 'A', boundary: ['in/'], at: 20 },
  scale: { type: 'scale', apparatus: 'A', channel: 'x', aggregate: 'sum' },
  'temporal-window': { type: 'temporal-window', clock: 'sense', period: 4 },
  resource: { type: 'resource', address: 'r', value: 2 },
  'medium-substitution': { type: 'medium-substitution', to: 'chemical', table: { electrical: { gain: 1, delay: 0.1 }, chemical: { gain: 0.8, delay: 2.5 } } },
  'sensor-replacement': { type: 'sensor-replacement', apparatus: 'A', channel: 'x', with: { id: 'x', clock: 'w', reads: ['x', 'h'], aggregate: 'sum', resolution: 1 } },
  'memory-removal': { type: 'memory-removal', prefix: 'archive/', at: 100 },
  'address-reassignment': { type: 'address-reassignment', from: 'phone/', to: 'cloud/', at: 50 },
  'goal-insertion': { type: 'goal-insertion', goal: { id: 'hold-x', clock: 'w', address: 'x', target: 1, gain: 0.3 } },
  'goal-removal': { type: 'goal-removal', rule: 'arist.sufficiency' },
  'institutional-rule': { type: 'institutional-rule', rule: 'policy.subsidy', enabled: false },
  'physical-implementation': { type: 'physical-implementation', coupling: 'codify', patch: { delay: 20 } },
  'counterfactual-removal': { type: 'counterfactual-removal', rule: 'b.ignite', occurrence: 0 },
  'delayed-intervention': { type: 'delayed-intervention', intervention: 'heat-pulse', dt: 100 },
  'feedback-interruption': { type: 'feedback-interruption', couplings: ['a→c'] },
  'reconstruction-transfer': { type: 'reconstruction-transfer', note: 'needs code: use preset parameters such as market participants' },
  hybridization: { type: 'hybridization', note: 'needs code: use preset parameters (participants, organizations, config)' },
  'reorganization-trigger': { type: 'reorganization-trigger', note: 'needs code: use the CLI/API from TypeScript' },
};

async function go(experiments) {
  $('#run-status').textContent = 'running…';
  try {
    const out = experiments.length === 1 ? [await api('/api/run', { method: 'POST', body: experiments[0] })] : await api('/api/batch', { method: 'POST', body: { experiments } });
    $('#run-status').textContent = `${out.length} run(s) · ${out.map((r) => r.events + ' events').join(', ')}`;
    await refreshRuns(); await openRun(out[out.length - 1].id);
  } catch (e) { $('#run-status').textContent = 'error: ' + e.message; }
}

async function refreshRuns() {
  S.runs = await api('/api/runs');
  const box = $('#runs'); box.innerHTML = S.runs.length ? '' : '<div class="hint">no runs yet</div>';
  for (const r of S.runs) {
    const d = el('div', { class: 'run' + (S.run?.id === r.id ? ' on' : ''), title: r.meta.runHash }, `<span class="mono">${esc(r.id)}</span><span>${esc(r.label)}</span>`);
    d.onclick = () => openRun(r.id); box.append(d);
  }
}

// ------------------------------------------------------------------ run view
async function openRun(id) {
  S.run = S.runs.find((r) => r.id === id) ?? await api('/api/runs/' + id);
  $('#result').classList.remove('hidden');
  $$('.runs .run').forEach((d) => d.classList.toggle('on', d.querySelector('.mono').textContent === id));
  $('#run-title').textContent = S.run.label;
  const m = S.run.meta;
  const lv = S.run.summary.levels ?? {};
  $('#meta').innerHTML = `spec <b>${m.specId}</b> seed <b>${m.seed}</b> horizon <b>${m.horizon}</b> specHash <b>${m.specHash.slice(0, 12)}</b> runHash <b>${m.runHash.slice(0, 12)}</b> events <b>${S.run.events}</b> engine <b>${m.engine}</b>
    <span title="A: operation within C · B: C_t → C_{t+1} · C: S_t → S_{t+1} · D: M_t → M_{t+1}">levels <span class="tag">A ${lv.A ?? 0}</span><span class="tag">B ${lv.B ?? 0}</span><span class="tag">C ${lv.C ?? 0}</span><span class="tag">D ${lv.D ?? 0}</span></span>
    <span class="tag warn" title="claim status">${esc(m.claimStatus ?? 'synthetic-world result')}</span><span class="tag">${esc(m.evidence ?? 'synthetic')}</span>
    value kinds ${(S.run.summary.valueKinds ?? []).map((k) => `<span class="tag ${k === 'scalar' ? '' : 'unk'}">${esc(k)}</span>`).join('')}`;
  $('#btn-export').href = `/api/runs/${id}/trace`; $('#btn-tii').href = `/api/runs/${id}/tii`;
  $('#btn-rerun').onclick = async () => { const r = await api(`/api/runs/${id}/rerun`, { method: 'POST' }); $('#btn-rerun').textContent = r.equal ? 'Exact rerun ✓ identical hash' : 'Rerun differs ✗'; };
  $('#btn-rerun').textContent = 'Verify exact rerun';
  const [an, tl] = await Promise.all([api(`/api/runs/${id}/analysis`), api(`/api/runs/${id}/timeline`)]);
  S.analysis = an; S.timeline = tl;
  renderPipeline(); renderTimeline(); renderReach(); renderEmergent(); renderLineage(); renderEpistemic(); renderLoops(); renderAnalysis('revisions');
  const kinds = Object.keys(S.run.summary.counts).sort();
  $('#ev-kind').innerHTML = '<option value="">all kinds</option>' + kinds.map((k) => `<option>${k}</option>`).join('');
  S.evFrom = 0; S.evKinds = ''; $('#ev-kind').value = ''; $('#ev-q').value = '';
  loadEvents();
  $('#replay').max = S.run.events - 1; $('#replay').value = S.run.events - 1; loadReplay();
}

function renderPipeline() {
  const c = S.run.summary.counts, an = S.analysis;
  const undet = c.undetermined ?? 0;
  const stages = [
    { k: 'configuration', n: (an.config.initial ?? []).length, x: `${(an.config.final ?? []).length} dims at end`, kinds: 'reorganization', q: 'dimension' },
    { k: 'detected difference', n: c.detection ?? 0, x: `${undet} undetermined · ${c.aliasing ?? 0} aliasing`, kinds: 'detection,undetermined,aliasing' },
    { k: 'ignition', n: c.ignition ?? 0, x: `${c.suppression ?? 0} suppressions`, kinds: 'ignition,suppression,interaction' },
    { k: 'operation', n: c.operation ?? 0, x: `${c.blocked ?? 0} blocked`, kinds: 'operation,blocked' },
    { k: 'real effect', n: c.effect ?? 0, x: `${c['no-effect'] ?? 0} without real effect`, kinds: 'effect,no-effect' },
    { k: 'penetration', n: S.run.summary.penetrating ?? 0, x: `${c.loss ?? 0} losses · effect → report`, kinds: 'effect,loss', q: 'coupling:' },
    { k: 'feedback', n: c.feedback ?? 0, x: `${(an.loops ?? []).length} loop signatures`, kinds: 'feedback' },
    { k: 'reorganization', n: c.reorganization ?? 0, x: `${an.revisions.length} observation revisions`, kinds: 'reorganization,note' },
  ];
  $('#pipeline').innerHTML = stages.map((s, i) => `<div class="stage" data-i="${i}"><div class="k">${s.k}</div><div class="n">${s.n}</div><div class="x">${esc(s.x)}</div></div>`).join('');
  $$('#pipeline .stage').forEach((d) => d.onclick = () => {
    const s = stages[d.dataset.i]; $$('#pipeline .stage').forEach((x) => x.classList.toggle('on', x === d));
    S.evKinds = s.kinds; S.evFrom = 0; $('#ev-kind').value = ''; $('#ev-q').value = s.q ?? ''; loadEvents();
    $('#events').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function renderTimeline() {
  const { clocks, ignitions, horizon } = S.timeline;
  const W = 640, lh = 26, pad = 110, H = clocks.length * lh + 22;
  const x = (t) => pad + (t / Math.max(1e-9, horizon)) * (W - pad - 10);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="ignitions per clock">`;
  clocks.forEach((c, i) => { const y = i * lh + 14; s += `<text x="4" y="${y + 3}" class="lane-label">${esc(c.id)}</text><text x="4" y="${y + 13}">${esc(c.label ?? '')} · T=${fmt(c.period, 2)}</text><line class="axis" x1="${pad}" x2="${W - 10}" y1="${y}" y2="${y}"/>`; });
  const lane = Object.fromEntries(clocks.map((c, i) => [c.id, i]));
  for (const [t, ck, rule, seq] of ignitions) { const y = (lane[ck] ?? 0) * lh + 14; s += `<rect x="${x(t) - 1}" y="${y - 6}" width="2.2" height="12" fill="${color(rule)}" data-seq="${seq}"><title>${esc(rule)} @ ${fmt(t, 2)} (#${seq})</title></rect>`; }
  for (let k = 0; k <= 4; k++) { const t = (horizon * k) / 4; s += `<text x="${x(t)}" y="${H - 2}" text-anchor="middle">${fmt(t, 0)}</text>`; }
  s += '</svg>';
  $('#timeline').innerHTML = s;
  $$('#timeline rect').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
}

function renderReach() {
  const R = S.analysis.probeRelativeReachability ?? [], box = $('#reach');
  const probes = Object.keys(S.analysis.probes ?? {});
  if (!R.length) { box.innerHTML = `<div class="hint">No probe-relative reachability configured for this preset.</div>${probeTable()}`; return; }
  const rel = R[0].relativeTo ?? {};
  const W = 300, H = 42, tMax = S.run.meta.horizon;
  let html = '<div class="legend"><span><i style="background:var(--accent)"></i>fraction of option forks reaching the probe</span><span><i style="background:var(--bad)"></i>became unreachable</span><span><i style="background:var(--good)"></i>became reachable</span></div><table><tr><th>probe</th><th>over time</th><th>last</th></tr>';
  for (const p of probes) {
    const pts = R.map((r) => [r.t, r.probes[p]?.fraction ?? 0]);
    const x = (t) => 4 + (t / tMax) * (W - 8), y = (f) => H - 4 - f * (H - 10);
    let path = ''; pts.forEach(([t, f], i) => { path += (i ? `H${x(t)}V${y(f)}` : `M${x(t)},${y(f)}`); });
    let marks = '';
    for (const r of R) for (const c of r.changes) if (c.probe === p) marks += `<circle cx="${x(r.t)}" cy="${y(r.probes[p].fraction)}" r="3" fill="${c.change.includes('unreach') ? 'var(--bad)' : c.change.includes('reachable') ? 'var(--good)' : 'var(--warn)'}"><title>${esc(c.change)} @ ${r.t}</title></circle>`;
    const last = R[R.length - 1].probes[p];
    html += `<tr><td class="mono">${esc(p)}</td><td><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><line class="axis" x1="4" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>${marks}</svg></td><td><span class="tag ${last.status === 'unreachable' ? 'bad' : last.status === 'reachable' ? 'good' : 'warn'}">${esc(last.status)}</span></td></tr>`;
  }
  html += '</table>';
  const br = R.map((r) => r.branches);
  html += `<div class="hint">branches (distinct probe signatures across forks): ${br.join(' → ')}</div>
    <div class="hint">relative to — probes: ${(rel.probes ?? []).map((x) => `<span class="tag">${esc(x)}</span>`).join('')} options: ${esc((rel.options ?? []).join(', '))} · horizon ${rel.horizon} · observation: ${esc((rel.observation ?? []).join(' '))}</div>`;
  const irr = S.run.summary.horizonRelativeClosure ?? [];
  if (irr.length) html += `<div style="margin-top:6px">${irr.map((x) => `<span class="tag bad">${esc(x.probe)}: ${esc(x.kind)}${x.t !== undefined ? ' @' + x.t : ''}</span>`).join(' ')}</div>`;
  box.innerHTML = html + probeTable();
}
function renderEmergent() {
  const E = S.analysis.emergentReachability ?? [], box = $('#emergent');
  if (!E.length) { box.innerHTML = '<div class="hint">No reachability forks configured for this preset.</div>'; return; }
  const cats = (o) => Object.entries(o ?? {}).map(([c, v]) => `<span class="tag" title="${esc(v.join(', '))}">${esc(c)} ${v.length}</span>`).join('') || '<span class="hint">—</span>';
  box.innerHTML = `<table><tr><th>t</th><th>expansion</th><th>contraction</th><th>branch grammar</th><th>new / lost grammar</th></tr>${E.map((e) => `<tr><td>${fmt(e.t, 1)}</td><td>${cats(e.expansion)}</td><td>${cats(e.contraction)}</td><td class="mono">${e.branchGrammar.map((g) => esc(g || '∅ (no change)')).join('<br>')}</td><td>${e.newBranchGrammar.map((g) => `<span class="tag good">+ ${esc(g || '∅')}</span>`).join('')}${e.lostBranchGrammar.map((g) => `<span class="tag bad">− ${esc(g || '∅')}</span>`).join('')}</td></tr>`).join('')}</table>
    <div class="hint">Emergent reachability records how the description space itself expands or contracts in each fork; a new state need not be expressible in the probe set.</div>`;
}

const DIST = (d) => !d ? '' : `<div class="dist">${(d.new ?? []).map((x) => `<span class="tag good">+ ${esc(x)}</span>`).join('')}${(d.lost ?? []).map((x) => `<span class="tag bad">− ${esc(x)}</span>`).join('')}${(d.unknown ?? []).map((x) => `<span class="tag unk">? ${esc(x)}</span>`).join('')}${(d.retained ?? []).map((x) => `<span class="tag">= ${esc(x)}</span>`).join('')}</div>`;
let LVL = 'all';
$$('#lvl-filter button').forEach((b) => b.onclick = () => { LVL = b.dataset.lvl; $$('#lvl-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderLineage(); });
function renderLineage() {
  const E = S.analysis.levelEvents ?? [], box = $('#lineage');
  const lv = S.run.summary.levels ?? {}, sc = S.run.summary.spaceChange ?? {};
  const sz = (sp) => Object.values(sp ?? {}).reduce((a, v) => a + v.length, 0);
  let h = `<div class="hint">A ${lv.A ?? 0} · B ${lv.B ?? 0} · C ${lv.C ?? 0} · D ${lv.D ?? 0} · description space ${sz(S.analysis.space?.initial)} → ${sz(S.analysis.space?.final)} descriptors · expansion ${sc.expansion ?? 0} / contraction ${sc.contraction ?? 0}</div>`;
  if (LVL === 'A') { h += `<div class="hint" style="margin-top:6px">${lv.A ?? 0} operations within C (real effects). <button class="ghost" id="lvl-a-go">show in trace</button></div>`; box.innerHTML = h; $('#lvl-a-go').onclick = () => { S.evKinds = 'effect'; S.evFrom = 0; loadEvents(); $('#events').scrollIntoView({ block: 'center' }); }; return; }
  const rows = E.filter((e) => LVL === 'all' || e.level === LVL);
  h += rows.length ? `<table><tr><th>t</th><th>level</th><th>event</th><th>change</th><th>distinctions</th></tr>${rows.slice(0, 120).map((x) => `<tr data-seq="${x.seq}"><td>${fmt(x.t, 2)}</td><td><span class="tag">${esc(x.level)}</span></td><td class="hint">${esc(x.kind)}</td><td class="mono">${esc(x.what)}</td><td>${DIST(x.distinctions)}</td></tr>`).join('')}</table>` : `<div class="hint">No level-${esc(LVL)} change in this run${LVL === 'D' ? ' (the meta-configuration stayed as supplied)' : LVL === 'C' ? ' (the description space did not change)' : ''} — a legitimate result.</div>`;
  box.innerHTML = h;
  $$('#lineage tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
}

function probeTable() {
  const P = S.analysis.probes ?? {}; if (!Object.keys(P).length) return '';
  return `<table style="margin-top:8px"><tr><th>probe (main run)</th><th>first satisfied</th><th>now</th><th>flips</th></tr>${Object.entries(P).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${fmt(v.first, 2)}</td><td>${v.satisfied ? '<span class="tag good">yes</span>' : '<span class="tag">no</span>'}</td><td>${v.flips}</td></tr>`).join('')}</table>`;
}

const STATUS_COLORS = { detected: 'var(--good)', pending: 'var(--line)', 'not-measured': '#8f96a3', 'boundary-hidden': 'var(--unk)', 'below-resolution': '#c9a227', 'scale-incompatible': '#d0782a', 'temporal-window-incompatible': '#3f8fd2', 'apparatus-incompatible': 'var(--bad)', inaccessible: '#555' };
function renderEpistemic() {
  const E = S.run.summary.epistemic ?? {}, box = $('#epistemic');
  const apps = Object.keys(E);
  if (!apps.length) { box.innerHTML = '<div class="hint">No observation apparatus in this configuration.</div>'; $('#obs-chart').innerHTML = ''; return; }
  let h = `<div class="legend">${Object.entries(STATUS_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}</div>`;
  for (const a of apps) {
    const tot = Object.values(E[a]).reduce((x, y) => x + y, 0) || 1;
    h += `<div class="bar-row"><span class="nm" title="${esc(a)}">${esc(a)}</span><div class="bar">${Object.entries(E[a]).map(([k, n]) => `<span style="width:${(100 * n) / tot}%;background:${STATUS_COLORS[k] ?? '#999'}" title="${k}: ${n}"></span>`).join('')}</div><span class="hint">${tot}</span></div>`;
  }
  h += '<div class="hint">Share of world differences per apparatus by epistemic status. Nothing is ever classified as absent.</div>';
  box.innerHTML = h;
  const O = S.timeline.observations ?? {}; const chans = Object.entries(O).flatMap(([a, cs]) => Object.keys(cs).map((c) => a + '/' + c));
  if (!chans.length) { $('#obs-chart').innerHTML = ''; return; }
  $('#obs-chart').innerHTML = `<div class="row" style="margin-top:8px"><label>channel <select id="obs-ch">${chans.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label></div><div id="obs-svg"></div>`;
  const draw = () => {
    const [a, ...rest] = $('#obs-ch').value.split('/'); const series = O[a][rest.join('/')] ?? [];
    const vals = series.map((r) => r[1]).filter((v) => v !== null); if (!vals.length) { $('#obs-svg').innerHTML = '<div class="hint">no readings</div>'; return; }
    const W = 600, H = 110, tMax = S.run.meta.horizon, lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
    const x = (t) => 30 + (t / tMax) * (W - 36), y = (v) => H - 14 - ((v - lo) / sp) * (H - 24);
    let d = '', pen = false, gaps = '';
    for (const [t, v, st] of series) { if (v === null) { pen = false; gaps += `<line x1="${x(t)}" x2="${x(t)}" y1="${H - 12}" y2="${H - 6}" stroke="${STATUS_COLORS[st] ?? 'var(--unk)'}"><title>${st}</title></line>`; continue; } d += (pen ? 'L' : 'M') + x(t) + ',' + y(v); pen = true; }
    $('#obs-svg').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%"><text x="2" y="12">${fmt(hi, 2)}</text><text x="2" y="${H - 14}">${fmt(lo, 2)}</text><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.3"/>${gaps}</svg><div class="hint">ticks under the axis mark samples with no reading (colored by status)</div>`;
  };
  $('#obs-ch').onchange = draw; draw();
}

function renderLoops() {
  const L = S.analysis.loops ?? [], R = S.analysis.reorganizations ?? [];
  let h = L.length ? `<table><tr><th>origin rule</th><th>returns to</th><th>kind</th><th>count</th><th>mean latency</th></tr>${L.slice(0, 40).map((l) => `<tr><td class="mono">${esc(l.originRule)}</td><td class="mono">${esc(l.key)}</td><td><span class="tag ${l.kind === 'world' ? '' : 'warn'}">${esc(l.kind)}</span></td><td>${l.count}</td><td>${fmt(l.meanLatency, 2)}</td></tr>`).join('')}</table>` : '<div class="hint">No feedback loop detected.</div>';
  h += `<h3 style="margin-top:10px">Reorganizations (${R.length})</h3>` + (R.length ? `<table><tr><th>t</th><th>target</th><th>op</th><th>key</th><th>via</th></tr>${R.slice(0, 60).map((e) => `<tr data-seq="${e.seq}"><td>${fmt(e.t, 2)}</td><td>${esc(e.target)}</td><td>${esc(e.op)}</td><td class="mono">${esc(e.key)}</td><td class="mono">${esc(e.via)}</td></tr>`).join('')}</table>` : '<div class="hint">none</div>');
  $('#loops').innerHTML = h;
  $$('#loops tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
}

$$('#an-tabs button').forEach((b) => b.onclick = () => { $$('#an-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderAnalysis(b.dataset.an); });
function renderAnalysis(which) {
  const A = S.analysis, box = $('#an-body');
  const json = (x) => `<pre class="json">${esc(JSON.stringify(x, null, 2))}</pre>`;
  if (which === 'revisions') {
    box.innerHTML = (A.revisions.length ? A.revisions.map((r) => `<div class="check"><b>${esc(r.note)}</b> @ t=${fmt(r.t, 2)}
      <div class="kv"><div>previously unavailable</div><div class="mono">${esc(JSON.stringify(r.data.previouslyUnavailable))}</div>
      <div>apparatus change</div><div class="mono">${esc(JSON.stringify(r.data.apparatusChange))}</div>
      <div>evaluation</div><div>${esc(r.data.evaluation)}</div>
      <div>stages</div><div>${r.data.stages ? `generated ${r.data.stages.generated} → evaluated ${r.data.stages.evaluated} → Pareto set ${r.data.stages.paretoSet.length} → selected ${r.data.stages.selected.length} → ${r.data.stages.executed ? 'executed' : 'not executed'}` : '—'}</div>
      <div>axes</div><div>${(r.data.axes ?? []).map((a) => `<span class="tag" title="${esc(a.assumptions + ' · window ' + a.window + ' · comparable: ' + a.comparability)}">${esc(a.id)} (${a.prefer}, ${esc(a.preferenceOrigin)})</span>`).join('')}</div>
      <div>selection policy</div><div><span class="tag">${esc(r.data.policy ?? '—')}</span> origin <span class="tag">${esc(r.data.policyOrigin ?? 'unknown')}</span> — not theoretically privileged · lookahead ${esc(r.data.lookaheadHorizon ?? '—')}</div><div>reachability</div><div>${esc(JSON.stringify(r.data.altersLaterReachability))}</div></div>
      ${r.data.tradeoff ? `<div class="scroll-x"><table style="margin-top:6px"><tr><th>candidate</th><th>resolves</th><th>other aliases</th><th>lost observability</th><th>new observability</th><th>resource cost</th><th>fragility</th><th>delayed</th><th>reachability</th><th></th></tr>${r.data.tradeoff.map((c) => `<tr><td>${esc(c.description)}</td><td>${c.resolves === true ? '<span class="tag good">yes</span>' : c.resolves === null ? '<span class="tag unk">untestable</span>' : '<span class="tag">no</span>'}</td><td>${fmt(c.aliasesResolved, 2)}</td><td>${c.lostObservability.map((a) => `<span class="tag bad">${esc(a)}</span>`).join('') || '—'}</td><td>${c.newObservability.map((a) => `<span class="tag good">${esc(a)}</span>`).join('') || '—'}</td><td>${fmt(c.resourceCost, 2)}</td><td>${c.fragility.resourcesDepleted.map((a) => `<span class="tag bad">depletes ${esc(a)}</span>`).join('') || (c.fragility.blockedDelta ? 'blocked ' + c.fragility.blockedDelta : '—')}</td><td>${c.delayedConsequences.map((a) => `<span class="tag warn">${esc(a)}</span>`).join('') || '—'}</td><td class="mono">${esc(c.reachabilityChange.join('; ') || '—')}</td><td>${c.pareto ? '<span class="tag">Pareto</span>' : ''}${c.selected ? '<span class="tag good">selected</span>' : ''}${DIST(c.distinctions)}</td></tr>`).join('')}</table></div><div class="hint">The trade-off is exposed: the cheapest resolving revision is not assumed best.</div>` : ''}
      <details><summary class="hint">candidates tested</summary>${json(r.data.candidatesTested)}</details></div>`).join('') : '<div class="hint">No observation revision in this run.</div>')
      + `<h3 style="margin-top:8px">Aliasing records (${A.aliasing.length})</h3>` + (A.aliasing.length ? `<table><tr><th>t</th><th>apparatus</th><th>observation key</th><th>under</th><th>diverged into</th></tr>${A.aliasing.map((e) => `<tr><td>${fmt(e.t, 2)}</td><td>${esc(e.apparatus)}</td><td class="mono">${esc(e.key)}</td><td class="mono">${esc(e.sig || '∅')}</td><td class="mono">${esc(e.next.join('  |  '))}</td></tr>`).join('')}</table>` : '<div class="hint">none</div>');
  } else if (which === 'timing') {
    const C = A.corrections;
    box.innerHTML = `<div>${Object.entries(A.correctionSummary).map(([k, v]) => `<span class="tag ${k.includes('late') ? 'bad' : k === 'incorrect' ? 'warn' : k.includes('in-time') ? 'good' : 'unk'}">${esc(k)}: ${v}</span>`).join(' ') || '<span class="hint">No correction rules in this configuration.</span>'}</div>`
      + (C.length ? `<table style="margin-top:6px"><tr><th>ignition</th><th>label</th><th>detection</th><th>ignition</th><th>intervention</th><th>correction</th><th>env. reconfig.</th></tr>${C.slice(0, 80).map((c) => `<tr data-seq="${c.ignition}"><td class="mono">#${c.ignition}</td><td>${esc(c.label)}</td><td>${fmt(c.latency.detection, 2)}</td><td>${fmt(c.latency.ignition, 2)}</td><td>${fmt(c.latency.intervention, 2)}</td><td>${fmt(c.latency.correction, 2)}</td><td>${fmt(c.reconfiguration, 2)}</td></tr>`).join('')}</table>` : '')
      + `<h3 style="margin-top:8px">Detection latency</h3>${json(A.detectionLatencies)}`;
    $$('#an-body tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
  } else if (which === 'rates') {
    box.innerHTML = `<p class="hint">No universal rates: a local rate is reported only when this configuration makes it available and non-redundant. Every rate is indexed by window and configuration state.</p><table><tr><th>rate</th><th>available</th><th>per window</th><th>config states</th></tr>${A.rates.map((r) => `<tr><td class="mono">${esc(r.kind)}</td><td>${r.available ? '<span class="tag good">yes</span>' : `<span class="tag">no</span> <span class="hint">${esc(r.why)}</span>`}</td><td class="mono">${r.windows.map((w) => fmt(w.rate, 2)).join(' · ')}</td><td class="mono">${new Set(r.windows.map((w) => w.config)).size}</td></tr>`).join('')}</table>`;
  } else if (which === 'interactions') {
    const I = A.interactions;
    box.innerHTML = I.length ? `<table><tr><th>address</th><th>simultaneous operations</th><th>mode</th><th>count</th></tr>${I.map((x) => `<tr><td class="mono">${esc(x.address)}</td><td class="mono">${esc(x.rules.join(' , '))}</td><td><span class="tag ${x.mode === 'cooperation' ? 'good' : 'bad'}">${esc(x.mode)}</span></td><td>${x.count}</td></tr>`).join('')}</table>` : '<div class="hint">No simultaneous writes to the same address.</div>';
  } else if (which === 'notes') {
    box.innerHTML = `<h3>Goal timeline</h3>${A.goals.length ? json(A.goals) : '<div class="hint">no goal notes (goals are never assumed)</div>'}<h3>Notes</h3>${A.notes.length ? `<table><tr><th>t</th><th>note</th><th>data</th><th>via</th></tr>${A.notes.map((n) => `<tr data-seq="${n.seq}"><td>${fmt(n.t, 2)}</td><td>${esc(n.note)}</td><td class="mono">${esc(JSON.stringify(n.data)).slice(0, 200)}</td><td class="mono">${esc(n.via)}</td></tr>`).join('')}</table>` : '<div class="hint">none</div>'}`;
    $$('#an-body tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
  } else if (which === 'tii') {
    box.innerHTML = `<p class="hint">Content-addressed, deterministic Transition-Ignition Identifiers for selected ignitions (test status). An exact rerun issues the same identifiers.</p>` + (A.tii.length ? `<table><tr><th>TII</th><th>rule</th><th>occurrence</th><th>t</th></tr>${A.tii.map((r) => `<tr data-seq="${r.content.seq}"><td class="mono">${esc(r.tii)}</td><td class="mono">${esc(r.content.rule)}</td><td>${r.content.occurrence}</td><td>${fmt(r.content.t, 2)}</td></tr>`).join('')}</table>` : '<div class="hint">No rule in this configuration requests a TII.</div>');
    $$('#an-body tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
  } else if (which === 'domain') {
    box.innerHTML = A.domain ? renderDomain(A.domain) : '<div class="hint">No domain-specific analysis for this preset.</div>';
  } else if (which === 'categories') {
    box.innerHTML = '<div class="hint">recovering provisional bundles from the unlabeled trace…</div>';
    api(`/api/runs/${S.run.id}/emergence`).then((E) => {
      box.innerHTML = `<p class="hint">Discovery uses opaque tokens only (${esc(E.method)}). Labels are applied <em>afterwards</em> and compared; no category is forced to emerge.</p>
        <div class="scroll-x"><table><tr><th>bundle</th><th>members</th><th>mean features</th></tr>${E.bundles.map((b) => `<tr><td class="mono">${esc(b.id)}</td><td class="mono">${b.members.length}: ${esc(b.members.slice(0, 8).join(' '))}${b.members.length > 8 ? ' …' : ''}</td><td class="mono">${esc(Object.entries(b.features).map(([k, v]) => `${k}=${fmt(v, 2)}`).join(' '))}</td></tr>`).join('')}</table></div>
        <h3 style="margin-top:8px">Later labels: ${esc(E.laterLabels.labelling)}</h3>
        <table><tr><th>label</th><th>members</th><th>best bundle</th><th>Jaccard</th><th>verdict</th></tr>${E.laterLabels.comparison.map((c) => `<tr><td class="mono">${esc(c.label)}</td><td>${c.members}</td><td>${esc(c.bestBundle ?? '—')}</td><td>${fmt(c.jaccard, 2)}</td><td><span class="tag ${c.isolatesBundle ? 'good' : 'unk'}">${esc(c.verdict)}</span></td></tr>`).join('')}</table>
        ${A.domain?.reasonVocabularyProfile ? `<h3 style="margin-top:8px">Vocabulary non-redundancy profile: ${esc(A.domain.reasonVocabularyProfile.vocabulary)}</h3>${profileTable(A.domain.reasonVocabularyProfile)}` : ''}
        <h3 style="margin-top:8px">Provisional status of recovered bundles</h3><p class="hint">Bundle ids are neutral. Each bundle carries its source trace schema, feature constructors, window, procedure, resampling / perturbation stability and a downstream profile.</p>
        <div class="scroll-x"><table><tr><th>bundle</th><th>schema</th><th>features</th><th>resampling</th><th>perturbation</th><th>downstream (bundle vs rule level)</th></tr>${E.bundles.map((b) => `<tr><td class="mono">${esc(b.id)}</td><td>${esc(b.provisional.sourceSchema)}</td><td class="hint">${esc(b.provisional.featureConstructors.join(', '))}</td><td>${fmt(b.provisional.stabilityResampling, 2)}</td><td>${fmt(b.provisional.stabilityPerturbation, 2)}</td><td class="mono">${b.provisional.downstreamProfile ? `pen ${fmt(b.provisional.downstreamProfile.penetration, 2)} / ${fmt(b.provisional.downstreamProfile.ruleLevelPenetration, 2)}` : '—'}</td></tr>`).join('')}</table></div>
        <button class="ghost" id="sens-go" style="margin-top:8px">Run trace-schema and feature-set sensitivity</button><div id="sens-out"></div>`;
      $('#sens-go').onclick = async () => {
        $('#sens-out').innerHTML = '<div class="hint">running…</div>';
        const R = await api(`/api/runs/${S.run.id}/schema-sensitivity`);
        const s2 = R.sensitivity, me = R.multiEmergence;
        $('#sens-out').innerHTML = `<p class="mono">${esc(s2.statement)}</p>
          <div class="scroll-x"><table><tr><th>schema</th><th>events</th><th>dropped</th><th>bundles</th></tr>${s2.schemas.map((x) => `<tr><td>${esc(x.schema)}</td><td>${x.events}</td><td>${x.droppedEvents} ev / ${x.droppedCauseEdges} edges</td><td>${x.bundles.length}</td></tr>`).join('')}</table></div>
          <h3 style="margin-top:6px">Later-label correspondence across schemas</h3><table>${Object.entries(s2.labelStability).map(([l, v]) => `<tr><td class="mono">${esc(l)}</td><td>${esc(v.verdict)}</td></tr>`).join('')}</table>
          <h3 style="margin-top:6px">Bundle stability (no grouping is canonical)</h3><table><tr><th>members</th><th>stability</th><th>feature runs</th><th>schema runs</th></tr>${me.bundles.filter((b) => b.members.length > 1).map((b) => `<tr><td>${b.members.length}</td><td><span class="tag ${b.stability === 'stable' ? 'good' : b.stability === 'unstable' ? 'bad' : 'warn'}">${esc(b.stability)}</span></td><td>${b.presentInFeatureRuns}/${b.totalFeatureRuns}</td><td>${b.presentInSchemaRuns}/${b.totalSchemaRuns}</td></tr>`).join('')}</table><div class="hint">${me.bundles.filter((b) => b.members.length === 1).length} singleton groupings not listed (${me.bundles.filter((b) => b.members.length === 1 && b.stability === 'stable').length} stable)</div>`;
      };
    }).catch((e) => { box.innerHTML = esc(e.message); });
  } else if (which === 'addresses') {
    const O = A.operationalAddresses ?? [];
    box.innerHTML = `<p class="hint">Storage keys are implementation identity. Operational addresses are revisable relations to storage: they may span several nodes, share nodes, split, merge, become unavailable or unresolved, and re-ignite under a new address.</p>` + (O.length ? `<table><tr><th>operational address</th><th>status</th><th>storage</th><th>domains</th><th>lineage</th></tr>${O.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td><span class="tag ${o.status === 'resolved' ? 'good' : o.status === 'unavailable' ? 'bad' : 'unk'}">${esc(o.status)}</span></td><td class="mono">${esc(o.storage.join(', '))}</td><td>${esc(o.domains.join(', '))}</td><td class="mono">${esc(o.lineage.join(' → '))}</td></tr>`).join('')}</table>` : '<div class="hint">No operational addresses are declared; this run uses storage keys only.</div>');
  } else if (which === 'runmeta') {
    const M = A.meta ?? {}, L = A.metaLineage ?? [];
    const groups = {}; for (const e of M.final ?? []) (groups[e.registry] ??= []).push(e);
    box.innerHTML = `<p class="hint">Meta-configuration in force for this run (value kinds, description facets, transition-class constructors, trace schema). Level-D changes during the run: ${L.length}.</p>
      ${L.length ? `<table><tr><th>t</th><th>op</th><th>registry</th><th>id</th><th>origin</th><th>M</th></tr>${L.map((m) => `<tr><td>${fmt(m.t, 2)}</td><td>${esc(m.op)}</td><td>${esc(m.registry)}</td><td class="mono">${esc(m.id)}</td><td><span class="tag">${esc(m.origin)}</span></td><td class="mono">${esc(m.from.slice(0, 6))}→${esc(m.to.slice(0, 6))}</td></tr>`).join('')}</table>` : ''}
      ${Object.entries(groups).map(([g, es]) => `<h3 style="margin-top:8px">${esc(g)}</h3><div>${es.map((e) => `<span class="tag ${e.retired ? 'bad' : e.origin === 'supplied' ? '' : 'good'}" title="${esc(e.description ?? '')}">${esc(e.id)} · ${esc(e.retired ? 'retired' : e.origin)}</span>`).join('')}</div>`).join('')}
      <h3 style="margin-top:8px">Meta-time</h3>${(A.metaLatencies ?? []).length ? `<table><tr><th>revision</th><th>trigger</th><th>revised</th><th>latency</th></tr>${A.metaLatencies.map((x) => `<tr><td>${esc(x.kind)}</td><td>${fmt(x.trigger, 2)}</td><td>${fmt(x.revised, 2)}</td><td>${fmt(x.latency, 2)}</td></tr>`).join('')}</table>` : '<div class="hint">no meta-level revision in this run</div>'}`;
  } else if (which === 'config') {
    box.innerHTML = `<div class="grid2"><div><h3>Configuration (initial)</h3>${json(A.config.initial)}</div><div><h3>Configuration (final)</h3>${json(A.config.final)}</div></div><div class="grid2"><div><h3>Apparatus (initial)</h3>${json(A.apparatus.initial)}</div><div><h3>Apparatus (final)</h3>${json(A.apparatus.final)}</div></div><h3>Clocks</h3>${json(A.clocks)}`;
  }
}

function profileTable(P) {
  return `<table><tr><th>axis</th><th>evaluable</th><th>gain</th><th>beyond base</th><th>non-redundant</th><th>target</th></tr>${Object.entries(P.axes).map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.evaluable ? 'yes' : '<span class="hint">no (n=' + a.n + ')</span>'}</td><td>${fmt(a.gain, 3)}</td><td>${fmt(a.beyondBase, 3)}</td><td>${a.nonRedundant === null ? '—' : a.nonRedundant ? '<span class="tag good">non-redundant</span>' : '<span class="tag">redundant</span>'}</td><td class="hint">${esc(a.target)}</td></tr>`).join('')}</table><div class="hint">applied fraction ${fmt(P.appliedFraction, 2)} · shorthand (derived view only): ${esc(P.summary)}</div>`;
}

function renderDomain(D) {
  const json = (x) => `<pre class="json">${esc(JSON.stringify(x, null, 2))}</pre>`;
  if (D.kind === 'variables') {
    const G = D.grammarBounded, M = D.morphogenesis;
    let h = '';
    if (G) h += `<h3>Grammar-bounded variable discovery <span class="tag">supplied grammar</span></h3><p class="hint">${esc(G.claim ?? '')}</p>
      <div>${(G.grammar?.unary ?? []).concat(G.grammar?.binary ?? []).map((o) => `<span class="tag">supplied: ${esc(o)}</span>`).join('')}</div>
      <table style="margin-top:6px"><tr><th>variable</th><th>expression</th><th>origin</th><th>prediction gain</th></tr>${G.accepted.map((a) => `<tr><td class="mono">${esc(a.id)}</td><td class="mono">${esc(a.expr)}</td><td><span class="tag">constructed from supplied grammar</span></td><td>${fmt(a.predictionGain, 3)}</td></tr>`).join('')}</table>
      ${(G.claims ?? []).map((c) => `<div class="mono">${esc(c)}</div>`).join('')}${G.claimStrength ? `<div class="hint">claim strength: ${esc(G.claimStrength)}</div>` : ''}`;
    if (M) h += `<h3 style="margin-top:10px">Operator-grammar morphogenesis</h3><p class="hint">${esc(M.claim)}</p>
      <table><tr><th>G version</th><th>operators</th></tr>${M.grammarLineage.map((g) => `<tr><td>G${g.version}</td><td>${g.operators.map((o) => `<span class="tag ${o.origin === 'supplied' ? '' : 'good'}" title="${esc(o.family)}">${esc(o.id)}${o.origin === 'supplied' ? '' : ' · ' + esc(o.origin)}</span>`).join('')}</td></tr>`).join('')}</table>
      <h3 style="margin-top:6px">Grammar changes</h3><div class="scroll-x"><table><tr><th>change</th><th>operator</th><th>retained</th><th>because</th><th>best variable</th></tr>${M.changes.map((c) => `<tr><td>${esc(c.change)}</td><td class="mono">${esc(c.op)}</td><td>${c.retained ? '<span class="tag good">retained</span>' : '<span class="tag">not retained</span>'}</td><td>${c.retainedBecause.map((x) => `<span class="tag">${esc(x)}</span>`).join('') || `<span class="hint">${esc(c.why ?? '')}</span>`}</td><td class="mono">${esc(c.bestExpr ?? '')}</td></tr>`).join('')}</table></div>
      <h3 style="margin-top:6px">Held variables</h3><table><tr><th>variable</th><th>expression</th><th>operators</th><th>retained because</th></tr>${M.accepted.map((a) => `<tr><td class="mono">${esc(a.id)}</td><td class="mono">${esc(a.expr)}</td><td>${Object.entries(a.operatorOrigins).map(([k, o]) => `<span class="tag ${o === 'supplied' ? '' : 'good'}">${esc(k)}: ${o === 'supplied' ? 'supplied' : 'generated (' + esc(o) + ')'}</span>`).join('')}</td><td>${a.retainedBecause.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</td></tr>`).join('')}</table>`;
    return h;
  }
  if (D.kind === 'market') {
    const P = D.participants;
    const row = (lab, f) => `<tr><th>${lab}</th>${P.map((p) => `<td>${f(p)}</td>`).join('')}</tr>`;
    return `<p class="hint">Compared by detection, unavailability, ignition, timing, penetration, feedback, observation change and goal transformation — wealth is one row among many.</p>
      <div class="scroll-x"><table><tr><th></th>${P.map((p) => `<th title="${esc(p.display ?? '')}">${esc(p.participant)}${p.reconstructionUncertainty ? ' <span class="tag warn">reconstruction</span>' : ''}</th>`).join('')}</tr>
      ${row('configuration', (p) => `<span class="hint">${esc(p.display ?? '')}</span>`)}
      ${row('reconstruction uncertainty', (p) => (p.reconstructionUncertainty ? `<span class="tag warn">${esc(p.reconstructionUncertainty.level)}</span> <span class="hint">${esc(p.reconstructionUncertainty.notes.join(' '))}</span>` : '—'))}
      ${row('detects', (p) => `<span class="mono">${esc(p.detects.channels.map((c) => c.split('/').pop()).join(', '))}</span>`)}
      ${row('hidden fundamental', (p) => Object.entries(p.unavailable['mkt/fundamental']).map(([k, v]) => `<span class="tag unk">${k} ${v}</span>`).join(''))}
      ${row('trades / blocked', (p) => `${p.trades} / ${p.blocked}`)}
      ${row('regime-switch latency', (p) => `${fmt(p.timing.meanLatency, 1)} (${p.timing.responded}/${p.timing.regimeSwitches})`)}
      ${row('feedback via market', (p) => `<span class="mono">${esc(p.feedback.throughMarket.join(', ') || '—')}</span>`)}
      ${row('penetrates into', (p) => esc(p.penetration?.otherParticipantsReached.join(', ') || '—'))}
      ${row('goal transformation', (p) => p.goalTransformations.map((g) => `<span class="tag warn">t=${fmt(g.t, 1)}</span>`).join('') || '—')}
      ${row('rule changes', (p) => p.ruleChanges.map((r) => `<span class="mono">${esc(r.op + ' ' + r.key)}</span>`).join('<br>') || '—')}
      ${row('wealth', (p) => fmt(p.wealth, 0))}
      </table></div>
      <h3 style="margin-top:8px">Historically constrained operational reconstruction — statements (simulation-internal)</h3>${P.flatMap((p) => p.reconstructionStatements).map((s) => `<div class="mono">${esc(s)}</div>`).join('') || '<div class="hint">none</div>'}
      <details><summary class="hint">Reconstruction record (source evidence · configuration · model · inference rules · uncertainty)</summary>${json(D.reconstruction)}</details>`;
  }
  return json(D);
}

// ------------------------------------------------------------------ trace table
$('#ev-kind').onchange = () => { S.evKinds = $('#ev-kind').value; S.evFrom = 0; loadEvents(); };
let qT; $('#ev-q').oninput = () => { clearTimeout(qT); qT = setTimeout(() => { S.evFrom = 0; loadEvents(); }, 250); };
$('#ev-prev').onclick = () => { S.evFrom = Math.max(0, S.evFrom - 200); loadEvents(); };
$('#ev-next').onclick = () => { S.evFrom += 200; loadEvents(); };
async function loadEvents() {
  const q = new URLSearchParams({ from: S.evFrom, limit: 200 }); if (S.evKinds) q.set('kinds', S.evKinds); if ($('#ev-q').value) q.set('q', $('#ev-q').value);
  const r = await api(`/api/runs/${S.run.id}/events?${q}`);
  $('#ev-count').textContent = `${r.total} events · showing ${r.total ? S.evFrom + 1 : 0}–${Math.min(r.total, S.evFrom + 200)}`;
  $('#events').innerHTML = `<table><tr><th>#</th><th>t</th><th>kind</th><th>what</th><th>detail</th><th>via / cause</th></tr>${r.events.map((e) => `<tr data-seq="${e.seq}"><td>${e.seq}</td><td>${fmt(e.t, 2)}</td><td class="k-${e.kind}">${e.kind}</td><td>${esc(what(e))}</td><td>${esc(detail(e))}</td><td>${esc(e.via ?? '')}${e.cause?.length ? ' ← ' + e.cause.slice(0, 4).join(',') + (e.cause.length > 4 ? '…' : '') : ''}</td></tr>`).join('')}</table>`;
  $$('#events tr[data-seq]').forEach((r) => r.onclick = () => inspect(Number(r.dataset.seq)));
}
function what(e) { return e.rule ?? e.address ?? (e.apparatus ? `${e.apparatus}/${e.channel ?? ''}` : '') ?? ''; }
function detail(e) {
  switch (e.kind) {
    case 'effect': return e.valueKind ? `[${e.valueKind}] ${brief(e.difference)}${e.representationChange ? ' · representation ' + e.representationChange.from + '→' + e.representationChange.to : ''}${e.medium ? ' [' + e.medium + ']' : ''}` : `${fmt(e.before)} → ${fmt(e.after)} (Δ${fmt(e.delta)})${e.medium ? ' [' + e.medium + ']' : ''}`;
    case 'state-space': return `S ${e.from.slice(0, 6)}→${e.to.slice(0, 6)}: ${e.signature}`;
    case 'reachability.emergent': return `expansion ${Object.keys(e.expansion).join(',') || '—'} · grammar ${e.branchGrammar.length}`;
    case 'ignition': return `${e.onset ? 'onset' : 'sustained'} · clock ${e.clock} · reads ${e.reads.length}${e.suppressed ? ' · SUPPRESSED' : ''}${e.tii ? ' · ' + e.tii : ''}`;
    case 'operation': return `delay ${e.delay} · ${e.intents} intents · ${e.realEffects ?? 0} real effects`;
    case 'detection': return `${fmt(e.prev)} → ${fmt(e.value)}${e.spurious ? ' (no world difference: noise)' : ''}`;
    case 'undetermined': return Object.entries(e.statuses ?? {}).map(([k, v]) => `${k}×${v}`).join(', ');
    case 'feedback': return `${e.originRule} → ${e.key} (${e.loop}, latency ${fmt(e.latency, 2)})`;
    case 'reorganization': return `${e.target}.${e.op} ${e.key}${e.level ? ' · level ' + e.level : ''}`;
    case 'blocked': return `${e.resource}: need ${fmt(e.needed)} have ${fmt(e.available)}`;
    case 'loss': return `${e.coupling}: ${e.why} (${fmt(e.value, 4)})`;
    case 'interaction': return `${e.mode}: ${e.rules.join(', ')}`;
    case 'suppression': return `${e.rule} suppressed by ${e.by.join(', ')}`;
    case 'note': return `${e.note} ${JSON.stringify(e.data ?? '')}`.slice(0, 120);
    case 'reachability.probe-relative': return e.changes.map((c) => `${c.probe}:${c.change}`).join(', ') || `branches ${e.branches}`;
    case 'correction': return `${e.label} (latency ${fmt(e.correctionLatency, 2)})`;
    case 'aliasing': return `${e.key} under ${e.sig || '∅'} → ${e.next.join(' | ')}`;
    case 'probe': return `${e.probe} ${e.satisfied ? 'satisfied' : 'released'}`;
    default: return '';
  }
}

// ------------------------------------------------------------------ inspector
$('#insp-close').onclick = () => $('#inspector').classList.add('hidden');
async function inspect(seq) {
  const r = await api(`/api/runs/${S.run.id}/event/${seq}`);
  const e = r.event;
  const tree = (xs) => xs.length ? xs.map((n) => `<div class="node" data-seq="${n.seq}" style="padding-left:${n.depth * 12}px" title="${esc(n.via ?? '')}"><span class="k-${n.kind}">${n.kind}</span> #${n.seq} t=${fmt(n.t, 2)} ${esc(n.label ?? '')}${n.delta !== undefined ? ' Δ' + fmt(n.delta) : ''}</div>`).join('') : '<div class="hint">none</div>';
  const fields = Object.entries(e).filter(([k]) => !['seq', 't', 'kind', 'cause'].includes(k));
  $('#insp-body').innerHTML = `<div class="kv"><div>event</div><div class="mono">#${e.seq} · ${e.kind} · t=${fmt(e.t, 3)}</div>${fields.map(([k, v]) => `<div>${esc(k)}</div><div class="mono">${esc(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 400)}</div>`).join('')}</div>
    ${Object.keys(r.epistemic).length ? `<h3 style="margin-top:8px">Epistemic status per apparatus</h3>${Object.entries(r.epistemic).map(([a, s]) => `<span class="tag ${s === 'detected' ? 'good' : 'unk'}">${esc(a)}: ${esc(s)}</span>`).join(' ')}` : ''}
    ${e.kind === 'effect' ? '<button id="pen-go" style="margin-top:8px">Penetration report</button><div id="pen-out"></div>' : ''}
    <h3 style="margin-top:10px">Upstream (what made this happen)</h3><div class="tree">${tree(r.upstream)}</div>
    <h3 style="margin-top:10px">Downstream (what it changed)</h3><div class="tree">${tree(r.downstream)}</div>`;
  $('#inspector').classList.remove('hidden');
  $$('#insp-body .node').forEach((n) => n.onclick = () => inspect(Number(n.dataset.seq)));
  const pg = $('#pen-go'); if (pg) pg.onclick = async () => {
    const p = await api(`/api/runs/${S.run.id}/penetration/${seq}`);
    $('#pen-out').innerHTML = `<div class="kv" style="margin-top:6px">
      <div>reached</div><div class="mono">${esc(p.reached.join(', '))}</div><div>media</div><div>${p.media.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>
      <div>scales</div><div>${p.scales.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div><div>address domains</div><div>${p.domains.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>
      <div>clocks</div><div>${p.clocks.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>
      <div>crossings</div><div>medium ${p.crossMedium} · scale ${p.crossScale} · domain ${p.crossDomain} · clock ${p.crossClock}</div>
      <div>transformation</div><div>amplified ${p.amplified} · attenuated ${p.attenuated} · transformed ${p.transformed}</div>
      <div>structure</div><div>branching ${p.branching} · closures ${p.closures} · losses ${p.losses.length} · reappearances ${p.reappearances.length}</div>
      <div>ignitions / reorg / feedback</div><div>${p.ignitionsTriggered} / ${p.reorganizations} / ${p.feedbacks}</div><div>max delay</div><div>${fmt(p.maxDelay, 2)}</div></div>`;
  };
}

// ------------------------------------------------------------------ replay
let rT; $('#replay').oninput = () => { clearTimeout(rT); rT = setTimeout(loadReplay, 60); };
async function loadReplay() {
  const r = await api(`/api/runs/${S.run.id}/replay?upto=${$('#replay').value}`);
  $('#replay-t').textContent = `after event #${r.upto} · t=${fmt(r.t, 2)}`;
  const ch = new Set(r.changed);
  $('#replay-state').innerHTML = Object.entries(r.state).sort().map(([k, v]) => `<div class="${ch.has(k) ? 'chg' : ''}" title="${esc(fmt(v))}">${esc(k)} = ${esc(brief(v))}</div>`).join('');
}

// ------------------------------------------------------------------ compare
async function fillCompare() {
  await refreshRuns();
  const opts = S.runs.map((r) => `<option value="${r.id}">${esc(r.id + ' · ' + r.label)}</option>`).join('');
  $('#cmp-a').innerHTML = opts; $('#cmp-b').innerHTML = opts; if (S.runs[1]) $('#cmp-b').value = S.runs[0].id, $('#cmp-a').value = S.runs[1].id;
}
$('#cmp-go').onclick = async () => {
  const regions = $('#cmp-regions').value.split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [id, pf] = s.split(':'); return { id: id.trim(), prefixes: (pf ?? id).split(',').map((x) => x.trim()) }; });
  try {
    const r = await api('/api/compare', { method: 'POST', body: { a: $('#cmp-a').value, b: $('#cmp-b').value, regions, target: $('#cmp-target').value || regions[0]?.id } });
    const L = r.levels.levels, D = r.diff;
    let h = `<div class="panel"><h3>Eight levels (${r.levels.matched} matched ignitions by rule and occurrence)</h3>${Object.entries(L).map(([k, v]) => `<div class="bar-row"><span class="nm" style="width:190px">${esc(k)}</span><div class="bar"><span style="width:${(v ?? 0) * 100}%;background:var(--accent)"></span></div><span class="mono" style="width:50px">${v === null ? 'n/a' : (v * 100).toFixed(0) + '%'}</span></div>`).join('')}<p class="hint">Agreement at one level never implies agreement at another.</p></div>`;
    h += `<div class="panel"><h3>Divergence</h3>${D.identical ? '<span class="tag good">identical event logs</span>' : `<div class="kv"><div>first divergence</div><div class="mono">#${D.divergence.seq} at t=${fmt(D.divergence.t, 2)} · A: ${esc(D.divergence.a)} · B: ${esc(D.divergence.b)}</div><div>scalar distance</div><div>${fmt(D.scalarDistance)} <span class="hint">(scalar storage only — not a universal metric)</span></div></div>`}
      <div style="margin-top:6px">${D.probeIdentical ? '<span class="tag">probe-identical</span>' : '<span class="tag warn">probe results differ</span>'} ${D.operationallyDifferent ? '<span class="tag bad">operationally different</span>' : '<span class="tag good">operationally identical</span>'} ${D.stateSpace.identical ? '<span class="tag">same description space</span>' : '<span class="tag warn">description space differs</span>'}</div>
      ${!D.stateSpace.identical ? `<div class="kv" style="margin-top:4px"><div>only in A</div><div class="mono">${esc(JSON.stringify(D.stateSpace.finalOnlyA))}</div><div>only in B</div><div class="mono">${esc(JSON.stringify(D.stateSpace.finalOnlyB))}</div><div>emergent grammar A / B</div><div class="mono">${esc(JSON.stringify(D.emergent))}</div></div>` : ''}
      <table style="margin-top:6px"><tr><th>address</th><th>A</th><th>B</th><th>Δ</th></tr>${Object.entries(D.perAddress).slice(0, 60).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${brief(v.a)}</td><td>${brief(v.b)}</td><td>${v.d === null ? `<span class="tag unk">${esc(v.kind)}</span>` : fmt(v.d)}</td></tr>`).join('')}</table>
      <h3 style="margin-top:6px">Probes</h3><table><tr><th>probe</th><th>A first</th><th>B first</th></tr>${Object.entries(D.probes).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${fmt(v.aFirst, 2)}</td><td>${fmt(v.bFirst, 2)}</td></tr>`).join('')}</table>
      <h3 style="margin-top:6px">Ignition counts that differ</h3><table>${Object.entries(D.ignitions).slice(0, 40).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${v.a}</td><td>${v.b}</td></tr>`).join('')}</table></div>`;
    if (r.fragility) {
      const F = r.fragility;
      h += `<div class="panel"><h3>Fragility transfer (A → B, target ${esc(F.target)})</h3><div><span class="tag ${F.verdict.includes('with') ? 'bad' : 'good'}">${esc(F.verdict)}</span> failure concentration ${fmt(F.failureConcentration.base, 2)} → ${fmt(F.failureConcentration.variant, 2)} (${F.failureConcentration.change})</div>
        <div style="margin-top:4px">fate: ${F.fates.map((x) => `<span class="tag warn">${esc(x)}</span>`).join('')}</div>
        <table style="margin-top:6px"><tr><th>region</th><th>kind</th><th>A</th><th>B</th></tr>${F.transfers.map((t) => `<tr><td>${esc(t.region)}</td><td>${esc(t.kind)}</td><td>${fmt(t.base)}</td><td>${fmt(t.variant)}</td></tr>`).join('') || '<tr><td colspan=4 class="hint">no transfer detected</td></tr>'}</table>
        <h3 style="margin-top:6px">Dependency changes</h3><div class="scroll-x"><table><tr><th>region</th><th>category</th><th>added</th><th>removed</th></tr>${Object.entries(F.dependencyChanges).flatMap(([r, cs]) => Object.entries(cs).map(([c, d]) => `<tr><td>${esc(r)}</td><td>${esc(c)}</td><td class="mono">${esc(d.added.join(', '))}</td><td class="mono">${esc(d.removed.join(', '))}</td></tr>`)).join('') || '<tr><td colspan=4 class="hint">none</td></tr>'}</table></div></div>`;
    }
    $('#cmp-out').innerHTML = h;
  } catch (e) { $('#cmp-out').innerHTML = `<div class="panel">${esc(e.message)}</div>`; }
};

// ------------------------------------------------------------------ bench
let BENCH_RENDERED = false;
async function loadBench() { const b = await api('/api/bench'); if (BENCH_RENDERED) return; if (b) renderBench(b); else { const L = await api('/api/bench/layers'); if (BENCH_RENDERED) return; $('#bench-out').innerHTML = L.map((l) => `<div class="panel layer"><h3>Layer ${l.layer} — ${esc(l.title)}</h3>${l.checks.map((c) => `<div class="check">${esc(c.claim)}</div>`).join('')}</div>`).join(''); } }
$('#bench-go').onclick = async () => { $('#bench-go').disabled = true; $('#bench-go').textContent = 'running…'; try { renderBench(await api('/api/bench', { method: 'POST' })); } finally { $('#bench-go').disabled = false; $('#bench-go').textContent = 'Run all suites'; } };

// ------------------------------------------------------------------ meta-configuration
async function loadMeta() {
  const M = await api('/api/meta');
  $('#meta-evidence').textContent = M.evidenceStatus;
  const groups = {}; for (const e of M.entries) (groups[e.registry] ??= []).push(e);
  const ORDER = ['value-kind', 'description-facet', 'transition-class', 'observation-revision-candidate', 'grammar-mutation', 'comparison-metric', 'emergence-feature', 'pareto-axis', 'trace-schema', 'benchmark-predicate'];
  $('#meta-out').innerHTML = ORDER.filter((g) => groups[g]).map((g) => `<div class="panel"><h3>${esc(g)} <span class="hint">(${groups[g].length})</span></h3>
    <div class="scroll-x"><table>${groups[g].map((e) => `<tr><td class="mono">${esc(e.id)}</td><td><span class="tag ${e.origin === 'supplied' ? '' : 'good'}">${esc(e.retired ? 'retired' : e.origin)}</span></td><td class="hint">${esc(e.description ?? '')}${e.provenance ? ' · ' + esc(e.provenance) : ''}</td></tr>`).join('')}</table></div></div>`).join('')
    + `<div class="panel"><h3>Trace schemas</h3><div class="scroll-x"><table><tr><th>schema</th><th>event kinds</th><th>fields</th><th>aggregation</th><th>cause edges</th><th>values</th><th>relations</th></tr>${M.traceSchemas.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(String(s.detail.kinds))}</td><td>${esc(s.detail.fields)}</td><td>${s.detail.aggregation}</td><td>${esc(s.detail.edges)}</td><td>${s.detail.values ? 'kept' : '<span class="tag bad">discarded</span>'}</td><td>${s.detail.relations ? 'kept' : '<span class="tag bad">flattened</span>'}</td></tr>`).join('')}</table></div></div>`
    + `<div class="panel"><h3>Benchmark predicates — what would make each benchmark fail?</h3><div class="scroll-x"><table><tr><th>id</th><th>kind</th><th>success predicate</th><th>would count against</th></tr>${M.benchmarks.map((b) => `<tr><td class="mono">${esc(b.id)}</td><td>${esc(b.kind ?? '')}</td><td>${esc(b.successPredicate ?? '')}</td><td>${esc(b.counterEvidence ?? '')}</td></tr>`).join('')}</table></div></div>`;
}
function renderBench(b) {
  BENCH_RENDERED = true;
  const n = b.layers.reduce((a, l) => a + l.checks.length, 0), f = b.layers.reduce((a, l) => a + l.checks.filter((c) => !c.pass).length, 0);
  const T = b.theory ?? [];
  $('#bench-out').innerHTML = `<h2>Theory-Discriminating Benchmarks</h2><p class="hint">Competing model classes or ablations on the same environment. Results are simulation-internal.</p>` + T.map((t) => `<div class="panel layer"><h3>${esc(t.id)} — ${esc(t.title)} <span class="st ${t.discriminates ? 'pass' : 'fail'}">${t.discriminates ? 'discriminates' : 'does not discriminate'}</span></h3>
    <div class="hint">${esc(t.question)}</div>
    <div class="kv" style="margin-top:4px"><div>kind</div><div><span class="tag">${esc(t.definition?.kind ?? '')}</span> outcome <span class="tag ${t.outcomeType === 'positive' ? 'good' : t.outcomeType === 'negative' ? 'bad' : 'unk'}">${esc(t.outcomeType ?? '')}</span> <span class="tag warn">${esc(t.claimStatus ?? '')}</span> <span class="tag">${esc(t.evidence ?? '')}</span></div>
    <div>model classes</div><div>${t.modelClasses.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>
    ${t.definition ? `<div>initial configuration</div><div>${esc(t.definition.initialConfiguration)}</div><div>perturbation</div><div>${esc(t.definition.perturbation)}</div><div>measured</div><div>${esc(t.definition.measuredOutcomes.join('; '))}</div><div>success predicate</div><div class="mono">${esc(t.definition.successPredicate)}</div><div>uncertainty</div><div>${esc(t.definition.uncertainty)}</div><div><b>What would make this benchmark fail?</b></div><div>${esc(t.definition.counterEvidence)}</div>` : ''}
    <div>hypothesis</div><div>${t.hypothesis === null ? '<span class="hint">none — no winner predefined</span>' : `${esc(t.hypothesis)} <span class="tag ${t.hypothesisHolds ? 'good' : 'bad'}">${t.hypothesisHolds ? 'holds here' : 'does not hold here'}</span>`}</div><div>verdict</div><div>${esc(t.verdict)}</div></div>
    <details class="check"><summary class="hint">axes</summary><pre class="json">${esc(JSON.stringify(t.axes, null, 2))}${t.error ? '\n' + esc(t.error) : ''}</pre></details></div>`).join('')
    + `<h2 style="margin-top:14px">Meta-Boundedness Benchmarks</h2><p class="hint">Which results depend on the supplied meta-configuration? Stated as stability under a perturbation — never as escape from priors.</p>` + (b.meta ?? []).map((m) => `<div class="panel layer"><h3>${esc(m.id)} — ${esc(m.question)} <span class="st ${m.stableOverall ? 'pass' : 'untrusted'}">${m.stableOverall ? 'stable' : 'meta-dependent'}</span></h3><div class="mono">${esc(m.statement)}</div>
      ${m.definition ? `<div class="kv" style="margin-top:4px"><div>setup</div><div>${esc(m.definition.setup)}</div><div>compared</div><div>${esc(m.definition.compared.join('; '))}</div><div>stability predicate</div><div class="mono">${esc(m.definition.stabilityPredicate)}</div><div><b>What would make this benchmark fail?</b></div><div>${esc(m.definition.counterEvidence)}</div><div>claim status</div><div><span class="tag warn">${esc(m.claimStatus)}</span></div></div>` : ''}
      <details class="check"><summary class="hint">perturbations (${m.perturbations.length})</summary><table>${m.perturbations.map((p) => `<tr><td>${esc(p.meta)}</td><td>${p.stable ? '<span class="tag good">stable</span>' : '<span class="tag warn">changes</span>'}</td><td class="mono">${esc(typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail ?? '')).slice(0, 300)}</td></tr>`).join('')}</table>${m.error ? `<pre class="json">${esc(m.error)}</pre>` : ''}</details></div>`).join('')
    + `<div class="hint" style="margin-top:8px">${esc(b.evidenceStatus ?? '')}</div>`
    + `<h2 style="margin-top:14px">Implementation Conformance Benchmarks</h2><div class="hint">${esc(b.at)} · ${n} checks · ${f} failed · conformance to the specification, not theory validation</div>` + b.layers.map((l) => `<div class="panel layer"><h3>Layer ${l.layer} — ${esc(l.title)}<span class="st ${l.status}">${l.status}</span></h3>${l.checks.map((c) => `<details class="check"><summary><span class="st ${c.status}">${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '?'}</span> <span class="mono">${esc(c.id)}</span> — ${esc(c.claim)} <span class="hint">${c.ms}ms</span></summary><pre class="json">${esc(JSON.stringify(c.evidence, null, 2))}${c.error ? '\n' + esc(c.error) : ''}</pre></details>`).join('')}</div>`).join('');
}

init().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<div class="panel">Failed to load: ${esc(e.message)}</div>`); });

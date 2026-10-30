import { runBacktest } from './backtest.mjs';

const $ = s => document.querySelector(s);
const state = { result: null, recorded: false, presets: [], live: false, lastLedger: [], map: null, proveMap: null };

// Tiny DOM helper. All data goes in via textContent, never innerHTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const money = n => (n ? '$'.repeat(Math.round(n)) : '—');
const STATUS_LABEL = { ok: 'Qloo data', empty: 'No Qloo signal', needs_input: 'Needs your input', partial: 'Partial: budget reached', degraded: 'Reduced confidence', error: 'Qloo unavailable', running: 'Working…', not_run: 'Not run' };
const statusChip = (s, extra = '') => h('span', { class: `st st-${s}` }, STATUS_LABEL[s] || s, extra);

// Same formula as lib/twin.mjs scoreArea. Re-scored in the browser when the slider moves (no new Qloo calls).
function scoreArea({ tastePct, sameCategoryCount, weight }) {
  const crowding = Math.min(100, Math.round((sameCategoryCount / 12) * 100));
  const headroom = 100 - crowding;
  const w = weight / 100;
  return { crowding, headroom, score: Math.round(w * tastePct + (1 - w) * headroom), formula: `${weight}% × taste ${tastePct} + ${100 - weight}% × headroom ${headroom}` };
}

/* ---------- views ---------- */
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t === b); t.setAttribute('aria-pressed', t === b); });
  for (const v of ['explore', 'proof', 'receipts']) $('#' + v).hidden = b.dataset.view !== v;
  $('#intro').hidden = b.dataset.view !== 'explore';
  if (b.dataset.view === 'proof') loadProof();
  if (b.dataset.view === 'receipts') renderLedger();
  if (b.dataset.view === 'explore') state.map?.invalidateSize();
}));

/* ---------- health ---------- */
async function loadHealth() {
  try {
    const r = await (await fetch('/api/health')).json();
    state.live = r.status === 'ok';
    $('#health').textContent = state.live ? '● Live Qloo data' : r.results?.live === false && r.note?.includes('not set') ? '● Qloo key not set · recorded data only' : '● Qloo degraded · recorded data fallback';
    $('#health').className = 'status ' + (state.live ? 'live' : 'down');
    $('#health').title = r.note || `Checked ${r.checkedAt}`;
  } catch { $('#health').textContent = '● Server unreachable'; $('#health').className = 'status down'; }
}

/* ---------- presets ---------- */
async function loadPresets() {
  try { state.presets = await (await fetch('/api/presets')).json(); } catch { state.presets = []; }
  $('#presets').replaceChildren(...state.presets.map(p => h('button', { type: 'button', title: p.for, onclick: () => usePreset(p) }, `${p.icon} ${p.label}`)));
}
function fill(p) {
  for (const k of ['shop', 'homeCity', 'targetCity', 'vibes']) $('#' + k).value = p[k] || '';
  $('#price').value = p.price ? String(p.price) : '';
}
async function usePreset(p) {
  fill(p);
  if (!state.live) return loadRecorded(p, 'Live Qloo is unavailable right now, so this is a recorded run.');
  await find({ presetId: p.id, entityId: p.entityId });
}
async function loadRecorded(p, why) {
  resetResults();
  const res = await fetch(`/api/recorded/${p.id}`);
  if (!res.ok) return showError(`${why} No recording exists for "${p.label}" yet.`);
  const r = await res.json();
  state.recorded = true;
  render(r, `RECORDED ${new Date(r.recordedAt).toLocaleDateString()}`);
}

/* ---------- run ---------- */
function formInput(extra = {}) {
  return { shop: $('#shop').value, homeCity: $('#homeCity').value, targetCity: $('#targetCity').value, price: $('#price').value, vibes: $('#vibes').value, weight: Number($('#weight').value), ...extra };
}
function resetResults() {
  $('#steps').replaceChildren(); $('#confirm').hidden = true; $('#resultHead').hidden = true; $('#cards').replaceChildren();
  $('#panels').hidden = true; $('#disclosures').replaceChildren(); $('#legend').hidden = true; $('#formError').hidden = true; $('#emptyState').hidden = true;
}
function showError(msg) { $('#formError').textContent = msg; $('#formError').hidden = false; $('#emptyState').hidden = false; }

async function streamJSON(url, payload, onStep) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok || !res.body) { let m = 'Request failed.'; try { m = (await res.json()).message || m; } catch {} return { status: 'error', message: m }; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'step') onStep(msg); else if (msg.type === 'result') result = msg;
    }
  }
  return result || { status: 'error', message: 'No result.' };
}

function stepRow(list, s) {
  let li = list.querySelector(`[data-id="${CSS.escape(s.id || s.label)}"]`);
  const row = h('li', { 'data-id': s.id || s.label, class: `step step-${s.status}` }, h('b', {}, s.label), s.detail ? h('span', {}, s.detail) : '', statusChip(s.status));
  if (li) li.replaceWith(row); else list.append(row);
}

async function find(extra = {}) {
  const btn = $('#find');
  resetResults(); btn.disabled = true; btn.textContent = 'Working…'; state.recorded = false;
  const preset = extra.presetId && state.presets.find(p => p.id === extra.presetId);
  try {
    const r = await streamJSON('/api/twin', formInput(extra), s => stepRow($('#steps'), s));
    state.lastLedger = r.ledger || [];
    if (r.status === 'needs_input' && r.candidates?.length) return showCandidates(r);
    if (r.status === 'needs_input') return showError(r.message);
    if ((r.status === 'error' || !r.areas?.length) && preset) return loadRecorded(preset, r.message || 'Live run failed.');
    if (r.status === 'error' || !r.areas?.length) return showError(r.message || 'No result.');
    render(r, r.status === 'ok' ? 'LIVE QLOO DATA' : STATUS_LABEL[r.status].toUpperCase());
  } catch (e) {
    if (preset) return loadRecorded(preset, 'Live run failed.');
    showError('Could not reach the server.');
  } finally { btn.disabled = false; btn.textContent = 'Find my twin blocks →'; }
}

function showCandidates(r) {
  const box = $('#confirm');
  box.replaceChildren(h('h3', {}, r.message), h('p', { class: 'hint' }, 'We never guess which place you mean. Pick yours:'),
    ...r.candidates.map(c => h('button', { class: 'candidate', type: 'button', onclick: () => find({ entityId: c.id }) }, h('b', {}, c.name), h('span', {}, c.address || c.type || ''))));
  box.hidden = false;
}

/* ---------- render result ---------- */
function render(r, mode) {
  state.result = r; state.lastLedger = r.ledger || state.lastLedger;
  $('#emptyState').hidden = true;
  if (!$('#steps').children.length) (r.steps || []).forEach(s => stepRow($('#steps'), s));
  $('#resultHead').hidden = false;
  $('#resultTitle').textContent = `${r.shop.name} energy. ${r.input.targetCity} address.`;
  $('#modeChip').textContent = mode;
  $('#modeChip').className = 'chip ' + (state.recorded ? 'recorded' : r.status === 'ok' ? 'live' : 'warn');
  rescore();
  drawMap(r);
  renderPanels(r);
  $('#disclosures').replaceChildren(h('li', { class: 'dis-head' }, 'What this does NOT establish'), ...r.disclosures.map(d => h('li', {}, d)), ...(r.degraded?.length ? [h('li', { class: 'warn' }, `Reduced confidence: ${r.degraded.join(', ')}.`)] : []));
}

function rescore() {
  const r = state.result; if (!r) return;
  const weight = Number($('#weight').value);
  r.areas.forEach(a => Object.assign(a, scoreArea({ tastePct: a.cell.tastePct, sameCategoryCount: a.sameCategoryCount, weight })));
  r.areas.sort((a, b) => b.score - a.score);
  $('#cards').replaceChildren(...r.areas.map((a, i) => areaCard(a, i)));
}

function evidence(text, receipts, kind = 'qloo') {
  return h('span', { class: `ev ev-${kind}`, title: receipts?.length ? `Receipts ${receipts.join(', ')}` : 'Derived' }, kind === 'qloo' ? 'Qloo says ' : kind === 'calc' ? 'We calculated ' : 'Our read ', h('b', {}, text), receipts?.length ? h('sup', {}, receipts.slice(0, 2).join(',')) : '');
}

function areaCard(a, i) {
  const trend = a.trend?.direction && a.trend.direction !== 'unknown' ? `${a.trend.of} is ${a.trend.direction}` : null;
  return h('article', { class: 'card', tabindex: 0, onclick: () => focusArea(a), onkeydown: e => e.key === 'Enter' && focusArea(a) },
    h('span', { class: 'rank' }, `0${i + 1}`),
    h('div', { class: 'card-body' },
      h('h3', {}, a.name),
      h('div', { class: 'chips' },
        evidence(`taste match ${a.cell.tastePct}/100 in this city`, a.receipts.slice(0, 1)),
        evidence(`${a.sameCategoryCount} same-category places within 800 m`, a.receipts, 'qloo'),
        a.priceFit?.label !== 'unknown' ? evidence(a.priceFit.note, a.receipts, 'qloo') : h('span', { class: 'ev ev-none' }, 'No Qloo price signal'),
        a.shared?.length ? evidence(`shared taste: ${a.shared.slice(0, 3).map(t => t.name).join(', ')}`, a.receipts) : h('span', { class: 'ev ev-none' }, `Audience compare: ${STATUS_LABEL[a.compareStatus] || 'n/a'}`),
        trend ? evidence(trend, a.receipts) : null,
      ),
      a.saturationWarning ? h('p', { class: 'warn' }, '⚠ ', a.saturationWarning) : null,
      h('p', { class: 'anchors' }, 'Anchor neighbours: ', a.anchors.length ? a.anchors.map(x => x.name).join(' · ') : 'none returned'),
      h('p', { class: 'formula' }, 'Score = ', a.formula),
      h('button', { class: 'brief-link', type: 'button', onclick: e => { e.stopPropagation(); brief(a); } }, 'Open Lease Brief ↗')),
    h('div', { class: 'score' }, a.score, h('small', {}, 'TWIN SCORE')));
}

function renderPanels(r) {
  const dna = $('#dnaPanel');
  dna.replaceChildren(h('h3', {}, 'Your crowd, according to Qloo'),
    r.dna.tags.length ? h('div', { class: 'tags' }, ...r.dna.tags.map(t => h('span', { class: 'tag' }, t.name))) : statusChip(r.dna.status),
    r.crowd.skews.length ? h('p', {}, 'Skews: ', r.crowd.skews.map(s => `${s.band} (${s.value.toFixed(2)})`).join(' · ')) : h('p', { class: 'hint' }, `Age/gender skew: ${STATUS_LABEL[r.crowd.status]}`),
    r.homeTwins.length ? h('p', {}, `Taste neighbours back in ${r.input.homeCity}: `, r.homeTwins.slice(0, 4).map(t => t.name).join(' · ')) : null,
    r.dna.vibeTags.length ? h('p', {}, 'Your vibe words matched: ', r.dna.vibeTags.map(t => t.name).join(' · ')) : null);
  const w = r.withoutQloo;
  $('#withoutPanel').replaceChildren(h('h3', {}, 'Without Qloo'),
    h('p', {}, `"Just go where it's busy" picks: `, w.busiest.map(b => b.name || `cell ${b.id}`).join(' · ') || '—'),
    h('p', { class: w.overlap ? '' : 'strong' }, `${w.overlap} of 3 busy-area picks overlap with your taste picks. `, w.overlap < 2 ? 'Busy and right for you are not the same thing.' : 'Here busy and taste agree.'),
    w.llm?.status === 'ok' ? h('p', {}, 'A plain LLM (no Qloo) would say: ', h('b', {}, w.llm.neighbourhoods.join(', ')), h('br'), h('small', {}, w.llm.why)) : h('p', { class: 'hint' }, w.llm?.note || 'LLM baseline not run.'));
  $('#panels').hidden = false;
}

/* ---------- map ---------- */
function makeMap(el, existing) {
  if (!window.L) { el.replaceChildren(h('p', { class: 'hint' }, 'Map library failed to load.')); return null; }
  if (existing) { existing.remove(); }
  el.hidden = false;
  const m = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors © CARTO' }).addTo(m);
  return m;
}
function heatColor(p) { return p > 85 ? '#1f6b4f' : p > 65 ? '#4f9a6e' : p > 40 ? '#a6cf7c' : '#dfe9c4'; }
function drawMap(r) {
  state.map = makeMap($('#map'), state.map);
  if (!state.map) return;
  const pts = [];
  for (const c of r.map.cells) {
    pts.push([c.lat, c.lon]);
    L.circle([c.lat, c.lon], { radius: r.map.boundary === 'neighborhood' ? 450 : 330, stroke: false, fillColor: heatColor(c.tastePct), fillOpacity: 0.55 }).bindTooltip(escapeHtml(`${c.name || c.id}: taste ${c.tastePct}, busy ${c.busyPct}`)).addTo(state.map);
  }
  for (const b of r.withoutQloo.busiest) L.circleMarker([b.lat, b.lon], { radius: 9, color: '#b65a2c', weight: 2, fill: false, dashArray: '3 3' }).bindTooltip(escapeHtml(`Busiest (no taste): ${b.name || b.id}`)).addTo(state.map);
  r.areas.forEach((a, i) => {
    L.marker([a.cell.lat, a.cell.lon], { icon: L.divIcon({ className: 'tb-pin', html: `<span>${i + 1}</span>`, iconSize: [30, 30] }), title: a.name, keyboard: true }).bindPopup(`<b>${escapeHtml(a.name)}</b><br>Twin score ${a.score}`).on('click', () => brief(a)).addTo(state.map);
    for (const x of a.anchors) if (Number.isFinite(x.lat)) L.circleMarker([x.lat, x.lon], { radius: 4, color: '#193a2f', weight: 1, fillOpacity: 1 }).bindTooltip(escapeHtml(x.name)).addTo(state.map);
  });
  if (pts.length) state.map.fitBounds(pts, { padding: [20, 20] });
  $('#legend').hidden = false;
}
function focusArea(a) { state.map?.flyTo([a.cell.lat, a.cell.lon], 14, { duration: 0.6 }); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* ---------- lease brief ---------- */
function brief(a) {
  const r = state.result;
  const el = $('#briefContent');
  const sec = (title, ...body) => h('div', { class: 'brief-section' }, h('h3', {}, title), ...body);
  el.replaceChildren(
    h('div', { class: 'eyebrow' }, 'TWIN BLOCK · LEASE BRIEF'),
    h('h1', { id: 'briefTitle' }, `${a.name}, ${r.input.targetCity}`),
    h('p', {}, `For ${r.shop.name} (${r.input.homeCity}) · ${money(r.input.price)} · ${state.recorded ? `recorded ${new Date(r.recordedAt).toLocaleDateString()}` : `generated ${new Date(r.generatedAt).toLocaleString()}`}`),
    h('p', { class: 'brief-meta' }, `TWIN SCORE ${a.score} · ${a.formula}`),
    sec('Why it fits', h('p', {}, `Qloo ranks this area ${a.cell.tastePct}/100 for your crowd's taste among ${r.map.cells.length} ${r.map.boundary === 'neighborhood' ? 'neighbourhoods' : 'areas'} in ${r.input.targetCity}.`), a.shared?.length ? h('p', {}, `Shared taste between your crowd and this area's places: ${a.shared.map(t => t.name).join(', ')}.`) : h('p', { class: 'hint' }, 'Audience comparison returned no shared tags.')),
    sec('Three taste-matched neighbours', a.anchors.length ? h('ol', {}, ...a.anchors.map(x => h('li', {}, h('b', {}, x.name), x.address ? ` · ${x.address}` : '', x.priceLevel ? ` · ${money(x.priceLevel)}` : ''))) : h('p', { class: 'hint' }, 'Qloo returned no anchors here.')),
    sec('Price fit', h('p', {}, a.priceFit.note)),
    sec('Crowding', h('p', {}, `${a.sameCategoryCount} places in your category within 800 m${a.sameCategory.length ? `: ${a.sameCategory.join(', ')}` : ''}.`), a.saturationWarning ? h('p', { class: 'warn' }, a.saturationWarning) : null),
    sec('Momentum', h('p', {}, a.trend?.direction && a.trend.direction !== 'unknown' ? `${a.trend.of} is ${a.trend.direction} over the last 6 months.` : 'No trend signal returned.')),
    sec('Before you sign', h('ul', {}, h('li', {}, 'Broker: available units, asking rent, permitted use, lease terms.'), h('li', {}, 'Owner: walk the block at your peak hour; visit the three anchors; count real competitors.'), h('li', {}, 'Test demand: a pop-up or market stall before a 10-year lease.'))),
    sec('What this does NOT establish', h('ul', {}, ...r.disclosures.map(d => h('li', {}, d)))),
    sec('Evidence', h('p', { class: 'hint' }, `Qloo receipts: ${[...new Set(a.receipts)].join(', ')}. Full parameters in the Receipts tab.`)));
  $('#brief').showModal();
}
$('#closeBrief').addEventListener('click', () => $('#brief').close());
$('#printBrief').addEventListener('click', () => window.print());

/* ---------- receipts ---------- */
function renderLedger() {
  const rows = state.lastLedger || [];
  $('#budget').textContent = rows.length ? `${rows.length} calls · ${rows.filter(r => r.cache !== 'miss').length} from cache · ${state.result?.budget ? `${state.result.budget.used}/${state.result.budget.limit} budget used` : ''}` : 'Run a search first.';
  $('#ledger tbody').replaceChildren(...rows.map(r => h('tr', {}, h('td', {}, r.id), h('td', {}, r.tool), h('td', {}, h('code', {}, r.endpoint)), h('td', {}, h('code', { class: 'params' }, Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join('\n'))), h('td', {}, statusChip(r.status), r.error ? h('small', {}, ' ', r.error) : ''), h('td', {}, r.count), h('td', {}, r.cache), h('td', {}, r.ms))));
}

/* ---------- prove it ---------- */
const pc = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
let proofLoaded = false;
async function loadProof() {
  if (proofLoaded) return; proofLoaded = true;
  const d = await (await fetch('/api/backtest')).json();
  if (d.status !== 'ok') { $('#proofSummary').replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '◌'), h('h3', {}, 'No precomputed backtest yet'), h('p', {}, d.message), h('p', {}, 'Run one live on the right.'))); return; }
  const s = d.summary;
  $('#proofSummary').replaceChildren(
    stat('Taste (Qloo)', pc(s.taste), 'hits in top 5', 'hero'), stat('Busy areas', pc(s.busy), 'popularity only'), stat('Random', pc(s.random), '500 seeded draws'),
    stat('Plain LLM', pc(s.llm), s.llm === null ? 'not run' : 'knows store locations'), stat('Chains', `${s.tasteWins}/${s.chains}`, `taste beat busy${s.ties ? ` · ${s.ties} ties` : ''}`),
    h('p', { class: 'hint wide' }, `${d.method} Ran ${new Date(d.ranAt).toLocaleString()}.`));
  $('#proofTable').replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Chain', 'Learn → hide', 'Hidden stores', 'Taste', 'Busy', 'Random', 'LLM'].map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...d.results.map(r => h('tr', {}, h('td', {}, r.brand), h('td', {}, `${r.train} → ${r.test}`), ...(r.status === 'ok' ? [h('td', {}, r.counts.heldOut), h('td', { class: r.taste.precisionAtK > r.busy.precisionAtK ? 'win' : '' }, pc(r.taste.precisionAtK)), h('td', {}, pc(r.busy.precisionAtK)), h('td', {}, pc(r.random.meanPrecisionAtK)), h('td', {}, pc(r.llm?.precisionAtK))] : [h('td', { colspan: 5 }, statusChip(r.status), ' ', r.message || '')])))))));
}
function stat(label, value, sub, cls = '') { return h('div', { class: `stat ${cls}` }, h('small', {}, label), h('b', {}, value), h('span', {}, sub)); }

$('#proveForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#proveSteps').replaceChildren(); $('#proveResult').replaceChildren(h('p', {}, 'Running live… about 6–8 Qloo calls.'));
  const r = await streamJSON('/api/backtest/run', { brand: $('#pBrand').value, train: $('#pTrain').value, test: $('#pTest').value }, s => stepRow($('#proveSteps'), s));
  state.lastLedger = r.ledger || state.lastLedger;
  if (r.status !== 'ok') { $('#proveResult').replaceChildren(statusChip(r.status), ' ', r.message || ''); return; }
  $('#proveResult').replaceChildren(h('div', { class: 'proof-summary' }, stat('Taste', pc(r.taste.precisionAtK), `${r.taste.hitCells}/${r.config.k} picks hit`, 'hero'), stat('Busy', pc(r.busy.precisionAtK), 'popularity only'), stat('Random', pc(r.random.meanPrecisionAtK), 'mean of 500'), stat('LLM', pc(r.llm?.precisionAtK), r.llm ? 'upper bound' : 'not run')),
    h('p', { class: 'hint' }, `${r.counts.heldOut} hidden ${r.brand} stores in ${r.test}. Signal: places like ${r.signalSample.join(', ')} in ${r.train}. ${r.llmNote}`));
  state.proveMap = makeMap($('#proveMap'), state.proveMap);
  if (!state.proveMap) return;
  const pts = [];
  for (const s of r.hidden) { pts.push([s.lat, s.lon]); L.circleMarker([s.lat, s.lon], { radius: 6, color: '#193a2f', fillColor: '#d8ec8f', fillOpacity: 1, weight: 2 }).bindTooltip(escapeHtml(`Hidden store: ${s.name}`)).addTo(state.proveMap); }
  for (const c of r.tastePicks) { pts.push([c.lat, c.lon]); L.circle([c.lat, c.lon], { radius: 1000, color: '#1f6b4f', weight: 2, fillOpacity: 0.1 }).bindTooltip(escapeHtml('Taste pick (1 km hit radius)')).addTo(state.proveMap); }
  for (const c of r.busyPicks) L.circle([c.lat, c.lon], { radius: 1000, color: '#b65a2c', weight: 1, dashArray: '4 4', fill: false }).bindTooltip(escapeHtml('Busy-area pick')).addTo(state.proveMap);
  state.proveMap.fitBounds(pts, { padding: [20, 20] });
});

$('#runImport').addEventListener('click', async () => {
  try {
    const f = $('#benchmark').files[0];
    if (!f) throw Error('Choose a benchmark JSON file first.');
    if (f.size > 2e6) throw Error('Please use a dataset under 2 MB.');
    const r = runBacktest(JSON.parse(await f.text()));
    $('#importStatus').textContent = `Taste ${pc(r.taste.precisionAtK)} · busy ${pc(r.busy.precisionAtK)} · random ${pc(r.random.meanPrecisionAtK)}${r.llm ? ` · LLM ${pc(r.llm.precisionAtK)}` : ''} (imported data, not verified).`;
  } catch (e) { $('#importStatus').textContent = e.message; }
});

/* ---------- wire up ---------- */
$('#form').addEventListener('submit', e => { e.preventDefault(); find(); });
$('#weight').addEventListener('input', () => { $('#weightValue').textContent = `${$('#weight').value}% taste`; rescore(); });
loadHealth();
loadPresets();

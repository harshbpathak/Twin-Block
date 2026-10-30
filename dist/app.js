import { runBacktest } from './backtest.mjs';

const $ = s => document.querySelector(s);
const state = { result: null, recorded: false, presets: [], live: false, ledger: [], map: null, proveMap: null, layers: {} };
const TOOL_NAMES = ['capabilities', 'describe', 'find_tags', 'entity_tags', 'audience_demographics', 'recommend', 'where_popular', 'compare_audiences', 'rank', 'trends'];

/* Tiny DOM helper: all data goes in via textContent, never innerHTML. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false && kid !== '') el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => (n ? '$'.repeat(Math.round(n)) : '—');
const uniq = xs => [...new Set(xs.filter(Boolean))];
const STATUS = { ok: 'Qloo data', empty: 'No Qloo signal', needs_input: 'Needs your input', partial: 'Partial: budget reached', degraded: 'Reduced confidence', error: 'Qloo unavailable', running: 'Working…', not_run: 'Not run' };
const chip = s => h('span', { class: `st st-${s}` }, STATUS[s] || s);
const cite = ids => (ids?.length ? h('span', { class: 'cite', title: 'Qloo receipts (see Receipts tab)' }, uniq(ids).slice(0, 3).join(' ')) : null);
function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200); }
function download(name, data) { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); a.remove(); }

/* Same formula as lib/twin.mjs scoreArea; re-scored here when the slider moves (no new Qloo calls). */
function scoreArea({ tastePct, sameCategoryCount, weight }) {
  const crowding = Math.min(100, Math.round((sameCategoryCount / 12) * 100));
  const headroom = 100 - crowding;
  const w = weight / 100;
  return { crowding, headroom, score: Math.round(w * tastePct + (1 - w) * headroom), formula: `${weight}% × taste ${tastePct} + ${100 - weight}% × headroom ${headroom}` };
}
function stability(areas) {
  const winners = [30, 50, 70, 90].map(weight => [...areas].map(a => ({ n: a.name, s: scoreArea({ tastePct: a.cell.tastePct, sameCategoryCount: a.sameCategoryCount, weight }).score })).sort((x, y) => y.s - x.s)[0].n);
  return new Set(winners).size === 1;
}

/* ---------- views ---------- */
function show(view) {
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.view === view; t.classList.toggle('active', on); t.setAttribute('aria-pressed', on); });
  for (const v of ['explore', 'proof', 'receipts']) $('#' + v).hidden = v !== view;
  $('#intro').hidden = view !== 'explore';
  if (view === 'proof') loadProof();
  if (view === 'receipts') renderLedger();
  if (view === 'explore') setTimeout(() => state.map?.invalidateSize(), 50);
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); show(b.dataset.goto); }));

/* ---------- health ---------- */
async function loadHealth() {
  try {
    const r = await (await fetch('/api/health')).json();
    state.live = r.status === 'ok';
    $('#health').textContent = state.live ? '● Live Qloo' : r.note?.includes('not set') ? '● Qloo key not set · recordings only' : '● Qloo degraded · recordings fallback';
    $('#health').className = 'status ' + (state.live ? 'live' : 'down');
    $('#health').title = r.note || `Checked ${new Date(r.checkedAt).toLocaleTimeString()}`;
  } catch { $('#health').textContent = '● Server unreachable'; $('#health').className = 'status down'; }
}

/* ---------- presets ---------- */
async function loadPresets() {
  try { state.presets = await (await fetch('/api/presets')).json(); } catch { state.presets = []; }
  $('#presets').replaceChildren(...state.presets.map(p => h('button', { type: 'button', class: 'preset', onclick: () => usePreset(p) }, h('span', { class: 'ic', 'aria-hidden': 'true' }, p.icon), h('b', {}, `${p.label} · ${p.homeCity} → ${p.targetCity}`), h('span', {}, p.for))));
}
function fill(p) {
  for (const k of ['shop', 'homeCity', 'targetCity', 'vibes']) $('#' + k).value = p[k] || '';
  $('#price').value = p.price ? String(p.price) : '';
}
async function usePreset(p) {
  fill(p);
  if (!state.live) return loadRecorded(p, 'Live Qloo is unavailable right now.');
  await find({ presetId: p.id, entityId: p.entityId });
}
async function loadRecorded(p, why) {
  resetResults();
  let res;
  try { res = await fetch(`/api/recorded/${p.id}`); } catch { return showError('Could not reach the server.'); }
  if (!res.ok) return showError(`${why} No recording exists for "${p.label}" yet.`);
  const r = await res.json();
  state.recorded = true;
  (r.steps || []).forEach(s => stepRow($('#steps'), s));
  $('#trace').hidden = false;
  render(r, `RECORDED ${new Date(r.recordedAt).toLocaleDateString()}`);
  toast(`${why} Showing a recorded run.`);
}
$('#ctaDemo').addEventListener('click', () => { const p = state.presets[0]; if (p) { usePreset(p); $('#explore').scrollIntoView({ behavior: 'smooth' }); } });

/* ---------- run ---------- */
const formInput = (extra = {}) => ({ shop: $('#shop').value, homeCity: $('#homeCity').value, targetCity: $('#targetCity').value, price: $('#price').value, vibes: $('#vibes').value, weight: Number($('#weight').value), ...extra });
function resetResults() {
  $('#steps').replaceChildren(); $('#pick').hidden = true; $('#resultBlock').hidden = true; $('#formError').hidden = true; $('#emptyState').hidden = true; $('#trace').hidden = true; $('#trace').open = true;
}
function showError(msg) { $('#loading').hidden = true; $('#formError').textContent = msg; $('#formError').hidden = false; $('#emptyState').hidden = false; }

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
  const key = s.id || s.label;
  const row = h('li', { 'data-id': key, class: `step step-${s.status}` }, h('b', {}, s.label), h('span', {}, s.detail || ''), chip(s.status));
  const old = [...list.children].find(li => li.dataset.id === key);
  if (old) old.replaceWith(row); else list.append(row);
}

async function find(extra = {}) {
  const btn = $('#find');
  resetResults(); btn.disabled = true; btn.textContent = 'Agent working…'; state.recorded = false;
  $('#trace').hidden = false; $('#loading').hidden = false; $('#traceSummary').textContent = '';
  const preset = extra.presetId && state.presets.find(p => p.id === extra.presetId);
  const input = formInput(extra);
  try {
    const r = await streamJSON('/api/twin', input, s => stepRow($('#steps'), s));
    $('#loading').hidden = true;
    state.ledger = r.ledger || [];
    if (r.status === 'needs_input' && r.mode === 'cities') return showCities(r);
    if (r.status === 'needs_input' && r.candidates?.length) return showCandidates(r);
    if (r.status === 'needs_input') return showError(r.message);
    if ((r.status === 'error' || !r.areas?.length) && preset) return loadRecorded(preset, r.message || 'Live run failed.');
    if (r.status === 'error' || !r.areas?.length) return showError(r.message || 'No result.');
    history.replaceState(null, '', '#' + new URLSearchParams(Object.entries({ ...input, entityId: r.shop.id, presetId: '' }).filter(([, v]) => v !== '' && v !== undefined)).toString());
    render(r, r.status === 'ok' ? 'LIVE QLOO' : STATUS[r.status].toUpperCase());
  } catch {
    $('#loading').hidden = true;
    if (preset) return loadRecorded(preset, 'Live run failed.');
    showError('Could not reach the server.');
  } finally { btn.disabled = false; btn.textContent = 'Find my twin blocks →'; }
}

function showCandidates(r) {
  $('#pick').replaceChildren(h('h3', {}, r.message), h('p', { class: 'hint' }, 'We never guess which place you mean. Pick yours:'),
    h('div', { class: 'candidates' }, ...r.candidates.map(c => h('button', { class: 'candidate', type: 'button', onclick: () => find({ entityId: c.id }) }, h('b', {}, c.name), h('span', {}, c.address || c.type || '')))));
  $('#pick').hidden = false;
}
function showCities(r) {
  $('#pick').replaceChildren(h('h3', {}, `Where ${r.shop.name}'s crowd over-indexes`), h('p', { class: 'hint' }, 'Ranked by Qloo locality affinity for your crowd. Pick one to map it.'),
    h('div', {}, ...r.cities.map((c, i) => h('button', { class: 'city', type: 'button', onclick: () => { $('#targetCity').value = c.name; find({ entityId: r.shop.id }); } }, `${i + 1}. ${c.name}`, Number.isFinite(c.affinity) ? h('small', {}, `${Math.round(c.affinity * 100)}`) : ''))),
    r.cities.length ? cite(r.cities[0].receipts) : h('p', {}, r.message));
  $('#pick').hidden = false;
}

/* ---------- render result ---------- */
function render(r, mode) {
  state.result = r; state.ledger = r.ledger || state.ledger;
  $('#emptyState').hidden = true; $('#loading').hidden = true;
  $('#resultBlock').hidden = false;
  const calls = r.ledger?.length || 0;
  $('#traceSummary').textContent = `${new Set((r.steps || []).map(s => s.id)).size} steps · ${calls} Qloo calls · ${r.ledger?.filter(x => x.cache !== 'miss').length || 0} cached`;
  $('#trace').open = false;
  $('#resultTitle').textContent = `${r.shop.name} energy. ${r.input.targetCity} address.`;
  $('#modeChip').textContent = mode;
  $('#modeChip').className = 'chip ' + (state.recorded ? 'recorded' : r.status === 'ok' ? 'live' : 'warn');
  $('#note').replaceChildren(h('h3', {}, "Agent's note"), ...(r.note || []).map(n => h('p', {}, n.text, cite(n.receipts))));
  rescore();
  drawMap(r);
  renderPanels(r);
  $('#disclosures').replaceChildren(h('li', { class: 'dis-head' }, 'WHAT THIS DOES NOT ESTABLISH'), ...r.disclosures.map(d => h('li', {}, d)), ...(r.degraded?.length ? [h('li', { class: 'warn' }, `Reduced confidence: ${r.degraded.join(', ')}.`)] : []));
  $('#resultBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rescore() {
  const r = state.result; if (!r) return;
  const weight = Number($('#weight').value);
  r.areas.forEach(a => Object.assign(a, scoreArea({ tastePct: a.cell.tastePct, sameCategoryCount: a.sameCategoryCount, weight })));
  r.areas.sort((a, b) => b.score - a.score);
  const stable = stability(r.areas);
  $('#stableChip').textContent = stable ? '✓ STABLE PICK' : '≈ EXPLORATORY';
  $('#stableChip').className = 'chip ' + (stable ? 'stable' : 'unstable');
  $('#stableChip').title = stable ? 'The #1 area stays #1 at 30%, 50%, 70% and 90% taste weight.' : 'The #1 area changes as you move the slider. Treat the shortlist as exploratory.';
  $('#cards').replaceChildren(...r.areas.map((a, i) => areaCard(a, i)));
  r.areas.forEach((a, i) => state.layers.pins?.[a.name]?.setIcon(pinIcon(i + 1)));
}

function metric(label, value, sub, cls = '') { return h('div', { class: `metric ${cls}` }, h('small', {}, label), h('b', {}, value), h('span', {}, sub)); }
function areaCard(a, i) {
  const crowd = a.sameCategoryCount;
  const trend = a.trend?.direction || 'unknown';
  const pf = a.priceFit || { label: 'unknown' };
  return h('article', { class: 'card' + (i === 0 ? ' top' : '') },
    h('div', {},
      h('div', { class: 'card-title' }, h('span', { class: 'rank' }, `#${i + 1}`), h('h3', {}, a.name), i === 0 ? h('span', { class: 'chip live' }, 'BEST TWIN') : ''),
      h('p', { class: 'hint', style: 'margin:4px 0 0' }, a.anchors[0] ? `Near ${a.anchors.slice(0, 2).map(x => x.name).join(' and ')}` : 'No anchors returned')),
    h('div', { class: 'ring', style: `--p:${a.score}`, role: 'img', 'aria-label': `Twin score ${a.score} out of 100` }, h('div', {}, String(a.score), h('small', {}, 'TWIN SCORE'))),
    h('div', { class: 'metrics' },
      metric('Taste match', `${a.cell.tastePct}/100`, 'vs. rest of city', a.cell.tastePct >= 80 ? 'good' : ''),
      metric('Crowding', crowd >= 8 ? 'High' : crowd >= 4 ? 'Medium' : 'Low', `${crowd} similar within 800 m`, crowd >= 8 ? 'bad' : crowd < 4 ? 'good' : ''),
      metric('Price fit', pf.label === 'unknown' ? 'No signal' : pf.label === 'match' ? 'Match' : pf.label === 'info' ? money(pf.avg) : pf.label === 'pricier' ? 'Pricier' : 'Cheaper', pf.avg ? `nearby avg ${money(pf.avg)}` : 'no price data', pf.label === 'match' ? 'good' : pf.label === 'pricier' || pf.label === 'cheaper' ? 'bad' : ''),
      metric('Momentum', trend === 'rising' ? '↑ Rising' : trend === 'fading' ? '↓ Fading' : trend === 'steady' ? '→ Steady' : 'No signal', a.trend?.of ? `lead anchor, 6 mo` : 'trend data', trend === 'rising' ? 'good' : trend === 'fading' ? 'bad' : '')),
    a.shared?.length ? h('div', { class: 'card-row' }, h('b', {}, 'Shared taste'), h('span', { class: 'tags' }, ...a.shared.slice(0, 5).map(t => h('span', { class: 'tag light' }, t.name)))) : h('div', { class: 'card-row' }, h('b', {}, 'Shared taste'), STATUS[a.compareStatus] || 'n/a'),
    h('div', { class: 'card-row' }, h('b', {}, 'Anchors'), a.anchors.length ? a.anchors.map(x => `${x.name}${x.priceLevel ? ` (${money(x.priceLevel)})` : ''}`).join(' · ') : 'none returned'),
    a.saturationWarning ? h('div', { class: 'warnline' }, '⚠ ', a.saturationWarning) : '',
    h('div', { class: 'formula' }, `Twin score = ${a.formula}`),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn small dark', type: 'button', onclick: () => brief(a) }, 'Lease Brief ↗'),
      h('button', { class: 'btn small', type: 'button', onclick: () => visitPlan(a) }, '🚶 Visit plan'),
      h('button', { class: 'btn small', type: 'button', onclick: () => landlordPitch(a) }, '✉ Landlord pitch'),
      h('button', { class: 'btn small', type: 'button', onclick: () => focusArea(a) }, '◎ Map'),
      h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(isSaved(a)), onclick: e => { toggleSave(a); e.currentTarget.setAttribute('aria-pressed', String(isSaved(a))); e.currentTarget.textContent = isSaved(a) ? '★ Saved' : '☆ Save'; } }, isSaved(a) ? '★ Saved' : '☆ Save'),
      h('span', { class: 'receipts' }, `receipts ${uniq(a.receipts).slice(0, 6).join(' ')}`)));
}

function renderPanels(r) {
  $('#dnaPanel').replaceChildren(h('h3', {}, 'Your crowd, per Qloo'),
    r.dna.tags.length ? h('div', { class: 'tags' }, ...r.dna.tags.map(t => h('span', { class: 'tag' }, t.name))) : chip(r.dna.status),
    cite(r.dna.receipts),
    r.crowd.skews.length ? h('p', {}, h('b', {}, 'Over-indexes: '), r.crowd.skews.map(s => `${s.band}`).join(' · '), cite(r.crowd.receipts)) : h('p', { class: 'hint' }, `Age/gender skew: ${STATUS[r.crowd.status]}`),
    r.homeTwins.length ? h('p', {}, h('b', {}, `Same crowd in ${r.input.homeCity}: `), r.homeTwins.slice(0, 4).map(t => t.name).join(' · ')) : '',
    r.dna.vibeTags.length ? h('p', {}, h('b', {}, 'Vibe words matched: '), r.dna.vibeTags.map(t => t.name).join(' · ')) : '');
  const w = r.withoutQloo;
  $('#withoutPanel').replaceChildren(h('h3', {}, 'Without Qloo'),
    h('p', {}, '"Just go where it\'s busy" would pick: ', h('b', {}, w.busiest.map(b => b.name || `cell ${b.id}`).join(', ') || '—')),
    h('p', {}, `${w.overlap} of 3 overlap with your taste picks. `, w.overlap < 2 ? 'Busy is not the same as right for you.' : 'Here busy and taste agree.'),
    w.llm?.status === 'ok' ? h('p', {}, 'A plain LLM, no Qloo: ', h('b', {}, w.llm.neighbourhoods.join(', ')), h('br'), h('span', { class: 'hint' }, w.llm.why)) : h('p', { class: 'hint' }, w.llm?.note || 'LLM baseline not run.'));
  $('#citiesPanel').replaceChildren(h('h3', {}, 'Other cities for this crowd'),
    r.cities?.length ? h('div', {}, ...r.cities.slice(0, 6).map(c => h('button', { class: 'city', type: 'button', onclick: () => { $('#targetCity').value = c.name; find({ entityId: r.shop.id }); } }, c.name, Number.isFinite(c.affinity) ? h('small', {}, `${Math.round(c.affinity * 100)}`) : ''))) : h('p', { class: 'hint' }, 'No locality ranking returned.'),
    r.cities?.length ? h('p', { class: 'hint' }, 'Qloo locality affinity for your crowd. Click to map one.', cite(r.cities[0].receipts)) : '');
}

/* ---------- map ---------- */
const pinIcon = n => L.divIcon({ className: 'tb-pin', html: `<span>${Number(n)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
function makeMap(el, existing) {
  if (!window.L) { el.replaceChildren(h('p', { class: 'hint', style: 'padding:16px' }, 'Map library failed to load.')); return null; }
  if (existing) existing.remove();
  el.hidden = false;
  const m = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(m);
  return m;
}
const heatColor = p => (p > 85 ? '#1f6b4f' : p > 65 ? '#4f9a6e' : p > 40 ? '#a6cf7c' : '#dfe9c4');
function drawMap(r) {
  state.map = makeMap($('#map'), state.map);
  if (!state.map) return;
  state.layers = { pins: {} };
  const pts = [];
  for (const c of r.map.cells) {
    pts.push([c.lat, c.lon]);
    L.circle([c.lat, c.lon], { radius: r.map.boundary === 'neighborhood' ? 520 : 360, stroke: false, fillColor: heatColor(c.tastePct), fillOpacity: 0.55 }).bindTooltip(esc(`${c.name || c.id} · taste ${c.tastePct} · busy ${c.busyPct}`)).addTo(state.map);
  }
  for (const b of r.withoutQloo.busiest) L.circleMarker([b.lat, b.lon], { radius: 11, color: '#b65a2c', weight: 2, fill: false, dashArray: '3 3' }).bindTooltip(esc(`Busiest, no taste signal: ${b.name || b.id}`)).addTo(state.map);
  r.areas.forEach((a, i) => {
    const m = L.marker([a.cell.lat, a.cell.lon], { icon: pinIcon(i + 1), title: a.name, keyboard: true, zIndexOffset: 1000 }).bindTooltip(esc(`${a.name} · twin score ${a.score}`)).on('click', () => brief(a)).addTo(state.map);
    state.layers.pins[a.name] = m;
    for (const x of a.anchors) if (Number.isFinite(x.lat)) L.circleMarker([x.lat, x.lon], { radius: 4, color: '#16332a', weight: 1, fillOpacity: 1 }).bindTooltip(esc(`Anchor: ${x.name}`)).addTo(state.map);
  });
  if (pts.length) state.map.fitBounds(pts, { padding: [24, 24] });
}
function focusArea(a) { $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }); state.map?.flyTo([a.cell.lat, a.cell.lon], 14, { duration: 0.6 }); state.layers.pins?.[a.name]?.openTooltip(); }

/* ---------- dialogs: lease brief + visit plan ---------- */
const sec = (title, ...body) => h('div', { class: 'brief-section' }, h('h3', {}, title), ...body);
function openDialog(...content) { $('#dialogContent').replaceChildren(...content); $('#dialog').showModal(); }
function nameFor(id) {
  const r = state.result;
  if (id === r.shop.id) return r.shop.name;
  return r.homeTwins.find(t => t.id === id)?.name || id.slice(0, 8);
}
function explainRows(ex) {
  const list = ex?.['signal.interests.entities'] || (Array.isArray(ex) ? ex : null);
  if (!Array.isArray(list)) return [];
  return list.map(e => ({ name: nameFor(String(e.entity_id || e.id || '')), v: Number(e.score ?? e.contribution ?? e.value) })).filter(e => Number.isFinite(e.v)).slice(0, 5);
}
function bars(rows, max) { return h('div', { class: 'bars' }, ...rows.map(r => h('div', { class: 'bar' }, h('span', {}, r.label), h('div', { class: 'track' }, ...r.values.map((v, i) => h('i', { class: i ? 'b' : '', style: `width:${Math.max(2, Math.round((Math.abs(v) / max) * 100))}%`, title: v.toFixed(2) })))))); }

function brief(a) {
  const r = state.result;
  const ex = explainRows(a.explainability);
  const shared = (a.shared || []).filter(t => Number.isFinite(t.a) || Number.isFinite(t.b));
  const maxShared = Math.max(0.01, ...shared.flatMap(t => [t.a || 0, t.b || 0]));
  openDialog(
    h('div', { class: 'eyebrow' }, 'TWIN BLOCK · LEASE BRIEF'),
    h('h1', { id: 'dialogTitle' }, `${a.name}, ${r.input.targetCity}`),
    h('p', { class: 'sub' }, `For ${r.shop.name} (${r.input.homeCity}) · your price ${money(Number(r.input.price))} · ${state.recorded ? `recorded ${new Date(r.recordedAt).toLocaleDateString()}` : `generated ${new Date(r.generatedAt).toLocaleString()}`}`),
    h('div', { class: 'brief-score' }, h('div', { class: 'ring', style: `--p:${a.score}` }, h('div', {}, String(a.score), h('small', {}, 'TWIN'))), h('div', {}, h('b', {}, `Taste ${a.cell.tastePct}/100 · Headroom ${a.headroom}/100`), h('br'), h('code', {}, a.formula))),
    sec('Why it fits', h('p', {}, `Qloo ranks this area ${a.cell.tastePct}/100 for your crowd's taste among ${r.map.cells.length} ${r.map.boundary === 'neighborhood' ? 'neighbourhoods' : 'map cells'} in ${r.input.targetCity}.`, cite(a.receipts.slice(0, 1))),
      shared.length ? [h('p', {}, 'Taste your crowd shares with this area (dark = your crowd, light = this area):', cite(a.receipts)), bars(shared.slice(0, 5).map(t => ({ label: t.name, values: [t.a || 0, t.b || 0] })), maxShared)] : a.shared?.length ? h('p', {}, `Shared taste: ${a.shared.map(t => t.name).join(', ')}.`) : h('p', { class: 'hint' }, 'Audience comparison returned no shared tags.')),
    ex.length ? sec('What drove this match', h('p', { class: 'hint' }, "Qloo's explainability: which of your signals most influenced the places found here."), bars(ex.map(e => ({ label: e.name, values: [e.v] })), Math.max(...ex.map(e => Math.abs(e.v))))) : '',
    sec('Three taste-matched neighbours', a.anchors.length ? h('ol', {}, ...a.anchors.map(x => h('li', {}, h('b', {}, x.name), x.address ? ` · ${x.address}` : '', x.priceLevel ? ` · ${money(x.priceLevel)}` : '', x.rank ? ` · ranked #${x.rank} for your crowd` : ''))) : h('p', { class: 'hint' }, 'Qloo returned no anchors here.')),
    sec('Price fit', h('p', {}, a.priceFit.note)),
    sec('Crowding', h('p', {}, `${a.sameCategoryCount} places in your category within 800 m${a.sameCategory.length ? `: ${a.sameCategory.join(', ')}` : ''}.`), a.saturationWarning ? h('p', { class: 'warnline' }, a.saturationWarning) : ''),
    sec('Momentum', h('p', {}, a.trend?.direction && a.trend.direction !== 'unknown' ? `${a.trend.of} is ${a.trend.direction} over the last 6 months.` : 'No trend signal returned.')),
    sec('Before you sign', h('ul', {}, h('li', {}, 'Broker: available units, asking rent, permitted use, lease terms.'), h('li', {}, 'You: walk the block at your peak hour and visit the three anchors (see Visit plan).'), h('li', {}, 'Test demand cheaply first: a pop-up, market stall or collab night with an anchor.'))),
    sec('What this does NOT establish', h('ul', {}, ...r.disclosures.map(d => h('li', {}, d)))),
    sec('Evidence', h('p', { class: 'hint' }, `Qloo receipts: ${uniq(a.receipts).join(', ')}. Full parameters in the Receipts tab.`)));
}

function visitPlan(a) {
  const r = state.result;
  const maps = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  openDialog(
    h('div', { class: 'eyebrow' }, 'TWIN BLOCK · VISIT PLAN'),
    h('h1', { id: 'dialogTitle' }, `Scout ${a.name}`),
    h('p', { class: 'sub' }, `A half-day field check before you call a broker. ${r.input.targetCity}.`),
    sec('Stops', h('ol', {}, ...a.anchors.map(x => h('li', {}, h('b', {}, x.name), x.address ? ` · ${x.address} ` : ' ', h('a', { href: maps(`${x.name} ${x.address || r.input.targetCity}`), target: '_blank', rel: 'noreferrer' }, 'Open in Maps ↗'))), h('li', {}, h('b', {}, 'The block itself'), ' ', h('a', { href: maps(`${a.cell.lat},${a.cell.lon}`), target: '_blank', rel: 'noreferrer' }, 'Open in Maps ↗')))),
    sec('At each anchor, note', h('ul', {}, h('li', {}, 'Who is in the room at your peak hour: does it look like your regulars back home?'), h('li', {}, 'What they order and spend, versus your price level.'), h('li', {}, 'Empty storefronts within two blocks (and their "for lease" phone numbers).'), h('li', {}, 'Parking, foot traffic, transit, and the evening vs. daytime feel.'))),
    sec('Competitors to look at', h('p', {}, a.sameCategory.length ? a.sameCategory.join(' · ') : 'Qloo returned no same-category places nearby.')),
    sec('Questions for the broker', h('ul', {}, h('li', {}, 'Which units near the anchors are coming available in the next 6 months?'), h('li', {}, 'Asking rent per sq ft and typical tenant improvement allowance?'), h('li', {}, 'Is my use permitted (hours, alcohol, venting, music)?'))));
}
function landlordPitch(a) {
  const r = state.result;
  const shared = (a.shared || []).slice(0, 3).map(t => t.name);
  const dna = r.dna.tags.slice(0, 3).map(t => t.name);
  const lines = [
    `Hello,`,
    '',
    `I run ${r.shop.name} in ${r.input.homeCity} and I'm looking for space in ${a.name}, ${r.input.targetCity}${a.anchors[0] ? `, ideally near ${a.anchors[0].name}` : ''}.`,
    '',
    `Why this block: our customers' tastes overlap with the people who already come here.${shared.length ? ` Qloo's taste data shows our crowd and this area share an interest in ${shared.join(', ')}.` : ''}${dna.length ? ` Our regulars over-index on ${dna.join(', ')}.` : ''}`,
    a.anchors.length ? `We'd complement your current neighbours (${a.anchors.map(x => x.name).join(', ')}) rather than compete with them.` : '',
    '',
    `Could you share units coming available in the next 6 months, asking rent, and whether our use is permitted?`,
    '',
    `Thank you,`,
    `[Your name]`,
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '');
  const text = lines.join(String.fromCharCode(10));
  openDialog(
    h('div', { class: 'eyebrow' }, 'TWIN BLOCK · LANDLORD PITCH'),
    h('h1', { id: 'dialogTitle' }, `Pitch for ${a.name}`),
    h('p', { class: 'sub' }, 'A first email to a leasing agent, built only from the evidence above. Edit before sending.'),
    h('textarea', { id: 'pitchText', 'aria-label': 'Pitch email text', rows: 16, style: 'width:100%;font:13px/1.6 var(--body);padding:14px;border:1px solid var(--line);border-radius:10px' }, text),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn dark', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText($('#pitchText').value); toast('Pitch copied.'); } catch { toast('Select the text and copy it.'); } } }, 'Copy text')));
}

/* ---------- saved blocks (this browser only) ---------- */
const SAVE_KEY = 'twinblock.saved.v1';
function loadSaved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; } }
function storeSaved(list) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 20))); } catch {} renderSaved(); }
const saveId = a => `${state.result?.shop?.id}|${state.result?.input?.targetCity}|${a.name}`;
function isSaved(a) { return loadSaved().some(x => x.id === saveId(a)); }
function toggleSave(a) {
  const list = loadSaved(); const id = saveId(a);
  if (list.some(x => x.id === id)) return storeSaved(list.filter(x => x.id !== id));
  const r = state.result;
  storeSaved([{ id, shop: r.shop.name, from: r.input.homeCity, city: r.input.targetCity, name: a.name, score: a.score, taste: a.cell.tastePct, crowd: a.sameCategoryCount, link: location.hash, at: Date.now() }, ...list]);
  toast(`Saved ${a.name}.`);
}
function renderSaved() {
  const list = loadSaved();
  $('#saved').hidden = !list.length;
  $('#savedList').replaceChildren(...list.map(x => h('li', {},
    h('a', { href: x.link || '#', onclick: () => setTimeout(() => location.reload(), 0) }, h('b', {}, `${x.name}, ${x.city}`), h('span', {}, `${x.shop} · score ${x.score} · taste ${x.taste} · ${x.crowd} similar nearby`)),
    h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${x.name}`, onclick: () => storeSaved(loadSaved().filter(y => y.id !== x.id)) }, '×'))));
}

$('#closeDialog').addEventListener('click', () => $('#dialog').close());
$('#printDialog').addEventListener('click', () => window.print());

/* ---------- share + receipts ---------- */
$('#shareBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied. It re-runs this search.'); } catch { toast(location.href); } });
$('#receiptsBtn').addEventListener('click', () => show('receipts'));
$('#downloadLedger').addEventListener('click', () => download('twin-block-receipts.json', { input: state.result?.input, generatedAt: state.result?.generatedAt, ledger: state.ledger }));
function renderLedger() {
  const rows = state.ledger || [];
  const used = new Set(rows.map(r => r.tool));
  $('#toolgrid').replaceChildren(...TOOL_NAMES.map(t => h('div', { class: 'tool' + (used.has(t) ? ' used' : '') }, h('b', {}, t), `${rows.filter(r => r.tool === t).length} calls`)));
  $('#budget').textContent = rows.length ? `${rows.length} calls · ${rows.filter(r => r.cache !== 'miss').length} from cache${state.result?.budget ? ` · ${state.result.budget.used}/${state.result.budget.limit} live-call budget` : ''}` : 'Run a search first.';
  $('#ledger tbody').replaceChildren(...rows.map(r => h('tr', {}, h('td', {}, r.id), h('td', {}, r.tool), h('td', {}, h('code', {}, r.endpoint)), h('td', {}, h('code', { class: 'params' }, Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join('\n'))), h('td', {}, chip(r.status), r.error ? h('div', { class: 'hint' }, r.error) : ''), h('td', {}, r.count), h('td', {}, r.cache), h('td', {}, r.ms))));
}

/* ---------- prove it ---------- */
const pc = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const stat = (label, value, sub, cls = '') => h('div', { class: `stat ${cls}` }, h('small', {}, label), h('b', {}, value), h('span', {}, sub));
let proofData = null;
async function getProof() { if (!proofData) { try { proofData = await (await fetch('/api/backtest')).json(); } catch { proofData = { status: 'error', message: 'Could not load.' }; } } return proofData; }
async function loadProof() {
  const d = await getProof();
  if (d.status !== 'ok') { $('#proofSummary').replaceChildren(h('div', { class: 'stat wide' }, h('small', {}, 'Precomputed results'), h('b', {}, 'Not run yet'), h('span', {}, 'Run a chain live on the right, or run `npm run prove` on the server.'))); $('#proofTable').replaceChildren(h('p', { class: 'hint' }, 'No precomputed results yet.')); return; }
  const s = d.summary;
  $('#proofSummary').replaceChildren(stat('Taste (Qloo)', pc(s.taste), 'mean hits in top 5', 'hero'), stat('Busy areas', pc(s.busy), 'popularity only'), stat('Random', pc(s.random), '500 seeded draws'), stat('Plain LLM', pc(s.llm), s.llm === null ? 'not run' : 'has memorised stores'), stat('Taste beat busy', `${s.tasteWins}/${s.chains}`, `chains${s.ties ? ` · ${s.ties} ties` : ''}`));
  $('#proofTable').replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Chain', 'Learn → hide', 'Hidden', 'Taste', 'Busy', 'Random', 'LLM'].map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...d.results.map(r => h('tr', {}, h('td', {}, h('b', {}, r.brand)), h('td', {}, `${r.train} → ${r.test}`), ...(r.status === 'ok' ? [h('td', {}, r.counts.heldOut), h('td', { class: r.taste.precisionAtK > r.busy.precisionAtK ? 'win' : '' }, pc(r.taste.precisionAtK)), h('td', {}, pc(r.busy.precisionAtK)), h('td', {}, pc(r.random.meanPrecisionAtK)), h('td', {}, pc(r.llm?.precisionAtK))] : [h('td', { colspan: 5 }, chip(r.status), ' ', r.message || '')])))))),
    h('p', { class: 'hint' }, `Ran ${new Date(d.ranAt).toLocaleString()}. ${d.method}`));
}
(async () => { const d = await getProof(); if (d.status === 'ok') $('#heroProof').replaceChildren('Backtested on ', h('b', {}, `${d.summary.chains} real chains`), `: taste found hidden stores at ${pc(d.summary.taste)} vs ${pc(d.summary.busy)} for busy areas. `, h('a', { href: '#', style: 'color:inherit', onclick: e => { e.preventDefault(); show('proof'); } }, 'See proof →')); })();

$('#proveForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#proveBtn'); btn.disabled = true; btn.textContent = 'Running live…';
  $('#proveSteps').replaceChildren(); $('#proveResult').replaceChildren(h('div', { class: 'skeleton' }));
  try {
    const r = await streamJSON('/api/backtest/run', { brand: $('#pBrand').value, train: $('#pTrain').value, test: $('#pTest').value }, s => stepRow($('#proveSteps'), s));
    state.ledger = r.ledger || state.ledger;
    if (r.status !== 'ok') { $('#proveResult').replaceChildren(h('p', {}, chip(r.status), ' ', r.message || '')); return; }
    $('#proveResult').replaceChildren(h('div', { class: 'proof-summary', style: 'margin-top:12px' }, stat('Taste', pc(r.taste.precisionAtK), `${r.taste.hitCells}/${r.config.k} picks hit`, 'hero'), stat('Busy', pc(r.busy.precisionAtK), 'popularity'), stat('Random', pc(r.random.meanPrecisionAtK), 'mean of 500'), stat('LLM', pc(r.llm?.precisionAtK), r.llm ? 'upper bound' : 'not run')),
      h('p', { class: 'hint' }, `${r.counts.heldOut} hidden ${r.brand} stores in ${r.test}. Signal: places like ${r.signalSample.join(', ')} in ${r.train}. ${r.llmNote}`));
    state.proveMap = makeMap($('#proveMap'), state.proveMap);
    if (!state.proveMap) return;
    const pts = [];
    for (const c of r.tastePicks) { pts.push([c.lat, c.lon]); L.circle([c.lat, c.lon], { radius: 1000, color: '#1f6b4f', weight: 2, fillOpacity: 0.12 }).bindTooltip('Taste pick (1 km hit radius)').addTo(state.proveMap); }
    for (const c of r.busyPicks) L.circle([c.lat, c.lon], { radius: 1000, color: '#b65a2c', weight: 1.5, dashArray: '4 4', fill: false }).bindTooltip('Busy-area pick').addTo(state.proveMap);
    for (const s of r.hidden) { pts.push([s.lat, s.lon]); L.circleMarker([s.lat, s.lon], { radius: 6, color: '#16332a', fillColor: '#d8ec8f', fillOpacity: 1, weight: 2 }).bindTooltip(esc(`Hidden store: ${s.name}`)).addTo(state.proveMap); }
    state.proveMap.fitBounds(pts, { padding: [20, 20] });
  } catch { $('#proveResult').replaceChildren(h('p', {}, chip('error'), ' Could not reach the server.')); }
  finally { btn.disabled = false; btn.textContent = 'Run backtest →'; }
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
renderSaved();
await Promise.all([loadHealth(), loadPresets()]);
// Shared link: #shop=..&homeCity=..&targetCity=.. re-runs the search.
if (location.hash.length > 1) {
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  if (q.homeCity) { fill(q); if (q.weight) { $('#weight').value = q.weight; $('#weightValue').textContent = `${q.weight}% taste`; } find(q.entityId ? { entityId: q.entityId } : {}); }
}

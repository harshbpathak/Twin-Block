import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRun, clearMemoryCache, normalizeParams } from '../lib/qloo.mjs';
import { cleanText, findPersonalData } from '../lib/pii.mjs';
import { runTwin, scoreArea, pickDistinctCells, priceFit } from '../lib/twin.mjs';
import { proveChain, summarize } from '../lib/prove.mjs';
import { trendDirection, TOOL_NAMES, makeTools } from '../lib/tools.mjs';
import { mockFetch } from './mock-qloo.mjs';

const KEY = 'test-key-never-logged';
const newRun = (opts = {}) => { clearMemoryCache(); return createRun({ apiKey: KEY, diskCache: false, retryDelayMs: 1, fetchImpl: mockFetch(opts.mock), ...opts }); };
const INPUT = { shop: 'Veracruz All Natural', homeCity: 'Austin', targetCity: 'Denver', price: 1, vibes: 'late night', weight: 70 };

test('PII guard blocks personal data and allows business names', () => {
  for (const bad of ['joe@example.com', 'call 512 555 0199', 'my name is Joe', '4111 1111 1111 1111', '@joesmith']) assert.ok(findPersonalData(bad), bad);
  for (const good of ["Joe's Tacos", 'Veracruz All Natural', 'Pappy\'s Smokehouse', 'Torchy\'s Tacos #12']) assert.equal(findPersonalData(good), null, good);
  assert.throws(() => cleanText('Your shop', 'email me joe@example.com'), /nothing personal is sent/);
});

test('client rejects unknown parameters and endpoints', async () => {
  assert.throws(() => normalizeParams({ 'api_key': 'x' }), /Unsupported/);
  await assert.rejects(newRun().call('t', '/admin', {}), /endpoint/);
});

test('cache: a repeated call is served from memory and costs no budget', async () => {
  const calls = [];
  const run = newRun({ mock: { calls } });
  await run.call('find_tags', '/v2/tags', { 'filter.query': 'coffee' });
  const second = await run.call('find_tags', '/v2/tags', { 'filter.query': 'coffee' });
  assert.equal(second.receipt.cache, 'memory');
  assert.equal(calls.length, 1);
  assert.equal(run.used, 1);
});

test('budget: calls past the limit are labelled partial, never sent', async () => {
  const calls = [];
  const run = newRun({ budget: 1, mock: { calls } });
  await run.call('a', '/v2/tags', { 'filter.query': 'one' });
  const r = await run.call('b', '/v2/tags', { 'filter.query': 'two' });
  assert.equal(r.status, 'partial');
  assert.equal(calls.length, 1);
});

test('no key -> labelled error; upstream errors labelled; key never in ledger', async () => {
  clearMemoryCache();
  const none = await createRun({ apiKey: '', diskCache: false }).call('t', '/v2/tags', { 'filter.query': 'x' });
  assert.equal(none.status, 'error');
  const run = newRun({ mock: { fail: { '/v2/tags': 500 } } });
  const r = await run.call('t', '/v2/tags', { 'filter.query': 'y' });
  assert.equal(r.status, 'error');
  assert.match(r.receipt.error, /HTTP 500/);
  assert.ok(!JSON.stringify(run.ledger).includes(KEY));
});

test('all 10 tools exist and return labelled statuses', async () => {
  const tools = makeTools(newRun());
  assert.deepEqual(Object.keys(tools).sort(), [...TOOL_NAMES].sort());
  const cap = await tools.capabilities();
  assert.equal(cap.status, 'ok');
});

test('end-to-end twin run: 3 areas, every claim has receipts, uses all 10 tools', async () => {
  const run = newRun();
  const steps = [];
  const r = await runTwin(INPUT, { run, onStep: s => steps.push(s), llm: async () => ({ status: 'not_run' }) });
  assert.equal(r.status, 'ok');
  assert.equal(r.areas.length, 3);
  for (const a of r.areas) {
    assert.ok(a.receipts.length >= 3);
    assert.match(a.formula, /taste \d+/);
    assert.ok(a.anchors.length > 0);
  }
  assert.ok(r.areas[0].score >= r.areas[2].score);
  const used = new Set(run.ledger.map(x => x.tool));
  for (const t of TOOL_NAMES.filter(t => t !== 'capabilities')) assert.ok(used.has(t), `tool ${t} used`);
  assert.ok(run.used <= 40);
  assert.ok(steps.some(s => s.status === 'running'));
  assert.equal(r.withoutQloo.busiest.length, 3);
});

test('ambiguous shop -> needs_input with candidates, no guessing', async () => {
  const r = await runTwin(INPUT, { run: newRun({ mock: { ambiguous: true } }) });
  assert.equal(r.status, 'needs_input');
  assert.equal(r.candidates.length, 2);
});

test('heatmap failure -> labelled error, not invented areas', async () => {
  const r = await runTwin(INPUT, { run: newRun({ mock: { fail: { 'urn:heatmap': 503 } } }) });
  assert.equal(r.status, 'error');
  assert.equal(r.areas, undefined);
});

test('scoring formula, spacing and price fit', () => {
  assert.deepEqual(scoreArea({ tastePct: 90, sameCategoryCount: 6, weight: 70 }), { crowding: 50, headroom: 50, score: 78, formula: '70% × taste 90 + 30% × headroom 50' });
  assert.equal(scoreArea({ tastePct: 90, sameCategoryCount: 30, weight: 0 }).score, 0);
  const cells = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0, lon: 0.05 }];
  assert.equal(pickDistinctCells(cells, 3).length, 2);
  assert.equal(priceFit(2, [{ priceLevel: 2 }, { priceLevel: 2 }]).label, 'match');
  assert.equal(priceFit(1, [{ priceLevel: 3 }]).label, 'pricier');
  assert.equal(priceFit(2, []).label, 'unknown');
});

test('trend direction', () => {
  assert.equal(trendDirection([1, 2, 3, 4, 5, 6].map(v => ({ population_percentile: v }))), 'rising');
  assert.equal(trendDirection([6, 5, 4, 3, 2, 1].map(v => ({ population_percentile: v }))), 'fading');
  assert.equal(trendDirection([]), 'unknown');
});

test('prove it: brand and brand stores never enter the signal', async () => {
  const calls = [];
  const run = newRun({ budget: 15, mock: { calls } });
  const r = await proveChain({ brand: 'Shake Shack', train: 'New York', test: 'Chicago' }, { run, useLLM: false });
  assert.equal(r.status, 'ok');
  const heat = calls.find(c => c.p['filter.type'] === 'urn:heatmap');
  const signal = heat.p['signal.interests.entities'].split(',');
  assert.ok(signal.every(id => !id.startsWith('store-') && id !== 'brand-0001'));
  assert.ok(!r.signalSample.some(n => /shake shack/i.test(n)), 'name-matched brand places dropped');
  assert.ok(r.taste.precisionAtK >= r.random.meanPrecisionAtK);
  assert.equal(summarize([r]).chains, 1);
});

test('browser copy of backtest engine matches the server copy', async () => {
  assert.equal(await readFile(new URL('../dist/backtest.mjs', import.meta.url), 'utf8'), await readFile(new URL('../backtest.mjs', import.meta.url), 'utf8'));
});

test('city finder: blank target city returns suggested cities, home city removed', async () => {
  const r = await runTwin({ ...INPUT, targetCity: '' }, { run: newRun() });
  assert.equal(r.mode, 'cities');
  assert.ok(r.cities.length >= 3);
  assert.ok(!r.cities.some(c => c.name === 'Austin'));
});

test('agent note and stability are derived from the result', async () => {
  const r = await runTwin(INPUT, { run: newRun(), llm: async () => ({ status: 'not_run' }) });
  assert.ok(r.note.length >= 3);
  assert.ok(r.note.some(n => n.text.includes(r.areas[0].name)));
  assert.equal(typeof r.stability.stable, 'boolean');
  assert.equal(r.stability.winners.length, 4);
});

test('gap finder flags a taste the best area under-serves', async () => {
  const r = await runTwin(INPUT, { run: newRun(), llm: async () => ({ status: 'not_run' }) });
  const gaps = r.areas[0].gaps;
  assert.equal(gaps.length, 2);
  assert.ok(gaps.find(g => g.tag === 'Patio').open);
  assert.ok(!gaps.find(g => g.tag === 'Tacos').open);
  assert.ok(r.note.some(n => n.text.startsWith('Opening spotted')));
});

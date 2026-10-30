// "Prove it": a live, non-circular backtest.
// Hide a chain's stores in the test city. Predict where they are using ONLY the taste of places near the chain's
// stores in the training city (never the brand, never its stores). Score against busy-area, random and optional LLM.
import { makeTools, compactEntity } from './tools.mjs';
import { resultArray } from './qloo.mjs';
import { runBacktest } from '../backtest.mjs';
import { askLLM } from './llm.mjs';
import { cleanText } from './pii.mjs';

export async function proveChain({ brand, train, test, k = 5, hitRadiusMeters = 1000 }, { run, onStep = () => {}, useLLM = true } = {}) {
  brand = cleanText('Chain', brand, { required: true, max: 80 });
  train = cleanText('Training city', train, { required: true, max: 80 });
  test = cleanText('Test city', test, { required: true, max: 80 });
  const tools = makeTools(run);
  const log = (label, status, detail = '') => onStep({ label, status, detail });
  const fail = (message, status = 'empty') => ({ brand, train, test, status, message, ledger: run.ledger });

  // 1. Resolve the brand.
  const found = await run.call('describe', '/search', { query: brand, types: 'urn:entity:brand', take: 5 });
  const brands = resultArray(found.data, 'entities').map(compactEntity).filter(Boolean);
  const b = brands.find(x => x.name.toLowerCase() === brand.toLowerCase()) || brands[0];
  if (!b) return fail(found.receipt.error || `Qloo has no brand called "${brand}".`, found.status === 'error' ? 'error' : 'empty');
  log('Resolved chain', 'ok', b.name);

  // 2. Real store lists in both cities.
  const stores = async city => {
    const r = await run.call('stores', '/v2/insights', { 'filter.type': 'urn:entity:place', 'filter.references_brand': b.id, 'filter.location.query': city, take: 50 });
    return { r, list: resultArray(r.data, 'entities').map(compactEntity).filter(e => e && Number.isFinite(e.lat) && Number.isFinite(e.lon)) };
  };
  const [tr, te] = await Promise.all([stores(train), stores(test)]);
  log('Store lists', tr.r.status, `${tr.list.length} in ${train}, ${te.list.length} hidden in ${test}`);
  if (tr.list.length < 2 || te.list.length < 3) return fail(`Not enough stores returned (${tr.list.length} in ${train}, ${te.list.length} in ${test}). Needs ≥2 and ≥3.`);
  const brandStoreIds = new Set([...tr.list, ...te.list].map(s => s.id));

  // 3. Taste neighbours of the training stores, in the training city, excluding every brand store.
  const nb = await tools.recommend({ signals: tr.list.slice(0, 20).map(s => s.id), location: train, exclude: [...brandStoreIds].slice(0, 100), take: 30 });
  const brandWord = b.name.toLowerCase();
  const neighbours = nb.results.filter(e => !brandStoreIds.has(e.id) && !e.name.toLowerCase().includes(brandWord) && Number.isFinite(e.lat));
  log('Taste neighbours (brand removed)', nb.status, `${neighbours.length} places`);
  if (neighbours.length < 3) return fail('Too few taste neighbours to build a signal.');

  // Leakage guard: the signal must contain no brand store and no brand entity.
  const signalIds = neighbours.slice(0, 20).map(e => e.id);
  if (signalIds.some(id => brandStoreIds.has(id) || id === b.id)) throw new Error('Leakage: brand store in signal');

  // 4. Taste heatmap of the test city from that signal.
  const heat = await tools.where_popular({ signals: signalIds, location: test, take: 200 });
  const cells = heat.results.map(c => ({ id: c.id, lat: c.lat, lon: c.lon, tasteScore: c.affinity, busyScore: c.popularity }));
  log('Test-city heatmap', heat.status, `${cells.length} cells`);
  if (cells.length < k * 2) return fail('Heatmap too small to rank.');

  // 5. Optional LLM-only baseline (it knows chain locations from training data, so treat it as an upper bound).
  let llmRanking;
  if (useLLM && process.env.OPENAI_API_KEY) {
    const sample = cells.slice(0, 80).map(c => `${c.id}:${c.lat.toFixed(3)},${c.lon.toFixed(3)}`).join(' ');
    const out = await askLLM(`Which ${k * 2} of these map cells in ${test} most likely contain a ${b.name} store? Cells (id:lat,lon): ${sample}. Reply JSON {"ids":[...]}`);
    const ids = Array.isArray(out?.ids) ? [...new Set(out.ids.map(String))].filter(id => cells.some(c => c.id === id)) : [];
    if (ids.length >= k) llmRanking = ids;
  }

  const result = runBacktest({
    cells,
    trainingLocations: neighbours.map(e => ({ id: e.id, lat: e.lat, lon: e.lon })),
    heldOutLocations: te.list.map(s => ({ id: s.id, lat: s.lat, lon: s.lon })),
    scoreSourceIds: signalIds,
    k, hitRadiusMeters, seed: 42, randomTrials: 500, llmRanking,
  });
  log('Scored', 'ok', `taste ${(result.taste.precisionAtK * 100).toFixed(0)}% vs busy ${(result.busy.precisionAtK * 100).toFixed(0)}%`);
  return {
    brand: b.name, brandId: b.id, train, test, status: 'ok', ...result,
    hidden: te.list.map(s => ({ name: s.name, lat: s.lat, lon: s.lon })),
    tastePicks: result.taste.ids.map(id => cells.find(c => c.id === id)).map(c => ({ id: c.id, lat: c.lat, lon: c.lon })),
    busyPicks: result.busy.ids.map(id => cells.find(c => c.id === id)).map(c => ({ id: c.id, lat: c.lat, lon: c.lon })),
    signalSample: neighbours.slice(0, 5).map(e => e.name),
    llmNote: llmRanking ? 'LLM likely memorised real store locations; treat as an upper bound, not a fair baseline.' : 'LLM baseline not run (no OPENAI_API_KEY).',
    ledger: run.ledger, ranAt: new Date().toISOString(),
  };
}

export function summarize(results) {
  const ok = results.filter(r => r.status === 'ok');
  const mean = f => (ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : null);
  return {
    chains: ok.length, attempted: results.length,
    taste: mean(r => r.taste.precisionAtK), busy: mean(r => r.busy.precisionAtK), random: mean(r => r.random.meanPrecisionAtK),
    llm: ok.some(r => r.llm) ? mean(r => r.llm?.precisionAtK ?? 0) : null,
    tasteWins: ok.filter(r => r.taste.precisionAtK > r.busy.precisionAtK).length,
    ties: ok.filter(r => r.taste.precisionAtK === r.busy.precisionAtK).length,
  };
}

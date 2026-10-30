// The Twin Block agent: a fixed, inspectable plan of Qloo tool calls.
// Shop that works in city A -> where its taste lives in city B -> top 3 areas with evidence and a Lease Brief.
import { makeTools } from './tools.mjs';
import { cleanText, InputError } from './pii.mjs';
import { distanceMeters } from '../backtest.mjs';
import { llmShortlist } from './llm.mjs';

export const DISCLOSURES = [
  'Qloo affinity describes cultural taste overlap. It is not foot traffic, revenue, rent or a forecast of sales.',
  'Area scores are Twin Block calculations from Qloo fields; the formula is shown on every card.',
  'Neighbour counts reflect what Qloo returned, not a census of every business on the block.',
  'Before signing anything: check available units, rent, permitted use, real competitors and visit at peak hours.',
];

const pct = (values, v) => (values.length < 2 ? 100 : Math.round((100 * values.filter(x => x < v).length) / (values.length - 1)));
const uniq = xs => [...new Set(xs.filter(Boolean))];

export function validateTwinInput(body = {}) {
  const shop = cleanText('Your shop', body.shop, { required: !body.entityId, max: 100 });
  const homeCity = cleanText('Home city', body.homeCity, { required: true, max: 80 });
  const targetCity = cleanText('Target city', body.targetCity, { required: true, max: 80 });
  const vibes = cleanText('Vibe words', body.vibes, { max: 120 });
  if (homeCity.toLowerCase() === targetCity.toLowerCase()) throw new InputError('Target city', 'Pick a target city different from your home city.');
  const price = body.price === undefined || body.price === '' || body.price === null ? null : Number(body.price);
  if (price !== null && (!Number.isInteger(price) || price < 1 || price > 4)) throw new InputError('Price level', 'Price level must be 1 to 4.');
  const weight = body.weight === undefined ? 70 : Number(body.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) throw new InputError('Taste weight', 'Taste weight must be 0 to 100.');
  const entityId = body.entityId ? String(body.entityId) : '';
  if (entityId && !/^[A-Za-z0-9-]{8,64}$/.test(entityId)) throw new InputError('Shop', 'Unknown shop ID.');
  return { shop, homeCity, targetCity, vibes, price, weight, entityId };
}

/** Score an area. Exported so the formula is unit-tested and shown verbatim in the UI. */
export function scoreArea({ tastePct, sameCategoryCount, weight }) {
  const crowding = Math.min(100, Math.round((sameCategoryCount / 12) * 100));
  const headroom = 100 - crowding;
  const w = weight / 100;
  return { crowding, headroom, score: Math.round(w * tastePct + (1 - w) * headroom), formula: `${weight}% × taste ${tastePct} + ${100 - weight}% × headroom ${headroom}` };
}

/** Pick spread-out top cells so the shortlist isn't three cells of the same block. */
export function pickDistinctCells(cells, n, minMeters = 900) {
  const out = [];
  for (const c of cells) {
    if (out.every(o => distanceMeters(o, c) >= minMeters)) out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

export function priceFit(target, anchors) {
  const levels = anchors.map(a => a.priceLevel).filter(Number.isFinite);
  if (!levels.length) return { label: 'unknown', note: 'Qloo returned no price levels for nearby places.' };
  const avg = levels.reduce((s, x) => s + x, 0) / levels.length;
  const shown = '$'.repeat(Math.round(avg));
  if (!target) return { label: 'info', avg, note: `Nearby taste-matched places average ${shown}.` };
  const gap = avg - target;
  if (Math.abs(gap) < 0.75) return { label: 'match', avg, note: `Nearby taste-matched places average ${shown}, in line with your ${'$'.repeat(target)}.` };
  return { label: gap > 0 ? 'pricier' : 'cheaper', avg, note: `Nearby taste-matched places average ${shown}, ${gap > 0 ? 'pricier' : 'cheaper'} than your ${'$'.repeat(target)}.` };
}

function summarizeDemographics(rows) {
  // Qloo returns aggregate affinity by age band / gender. Report the strongest skews only.
  const out = [];
  for (const row of rows) {
    const q = row?.query || row;
    for (const group of ['age', 'gender']) {
      const g = q?.[group];
      if (g && typeof g === 'object') for (const [k, v] of Object.entries(g)) if (typeof v === 'number') out.push({ group, band: k.replace(/_/g, ' '), value: v });
    }
  }
  return out.sort((a, b) => b.value - a.value).slice(0, 4);
}

export async function runTwin(rawInput, { run, onStep = () => {}, llm = llmShortlist } = {}) {
  const input = validateTwinInput(rawInput);
  const tools = makeTools(run);
  const steps = [];
  const step = (id, label, status, detail = '') => { const s = { id, label, status, detail }; steps.push(s); onStep(s); return s; };
  const degraded = [];

  // 1. Resolve the shop. Ambiguous -> ask the user to confirm (needs_input), never guess.
  step('resolve', 'Finding your shop on Qloo', 'running');
  let shop;
  if (input.entityId) {
    const d = await tools.describe({ id: input.entityId });
    shop = d.results[0];
    if (!shop) { step('resolve', 'Finding your shop on Qloo', d.status, d.note || 'Shop not found.'); return { status: d.status === 'error' ? 'error' : 'needs_input', input, steps, message: d.note || 'We could not load that shop. Search again.', ledger: run.ledger }; }
  } else {
    const d = await tools.describe({ query: input.shop });
    if (d.status === 'error' || d.status === 'partial') { step('resolve', 'Finding your shop on Qloo', 'error', d.note); return { status: 'error', input, steps, message: d.note, ledger: run.ledger }; }
    const city = input.homeCity.toLowerCase().split(',')[0].trim();
    const inCity = d.results.filter(e => (e.address || '').toLowerCase().includes(city));
    const exact = inCity.filter(e => e.name.toLowerCase() === input.shop.toLowerCase());
    if (exact.length === 1) shop = exact[0];
    else {
      const candidates = (inCity.length ? inCity : d.results).slice(0, 5);
      step('resolve', 'Finding your shop on Qloo', candidates.length ? 'needs_input' : 'empty', candidates.length ? `${candidates.length} possible matches; please confirm.` : 'No match found.');
      return { status: 'needs_input', input, steps, candidates, message: candidates.length ? 'Which one is your shop?' : `Qloo has no place called "${input.shop}". Try the exact name as it appears on maps.`, ledger: run.ledger };
    }
  }
  step('resolve', 'Finding your shop on Qloo', 'ok', `${shop.name}${shop.address ? ` · ${shop.address}` : ''}`);

  // 2. Taste DNA + vibe words + aggregate crowd.
  step('dna', 'Reading your crowd\'s taste DNA', 'running');
  const [dna, vibe, demo] = await Promise.all([
    tools.entity_tags({ ids: [shop.id] }),
    input.vibes ? tools.find_tags({ query: input.vibes }) : Promise.resolve({ tool: 'find_tags', status: 'empty', results: [], receipts: [] }),
    tools.audience_demographics({ ids: [shop.id] }),
  ]);
  const vibeTags = vibe.results.slice(0, 3);
  const categoryTag = shop.tags.find(t => /genre|category/.test(t.type || '') || /urn:tag:genre/.test(t.id)) || shop.tags[0];
  step('dna', 'Reading your crowd\'s taste DNA', dna.status, dna.results.slice(0, 4).map(t => t.name).join(' · ') || dna.note || 'No taste tags returned.');
  if (dna.status !== 'ok') degraded.push('Taste DNA');

  // 3. Home twins: places in the home city that share the crowd. These become the signal (shop alone is a thin signal).
  step('home', `Finding your taste neighbours in ${input.homeCity}`, 'running');
  const home = await tools.recommend({ signals: [shop.id], location: input.homeCity, exclude: [shop.id], take: 8 });
  const homeTwins = home.results.slice(0, 5);
  const signalIds = uniq([shop.id, ...homeTwins.slice(0, 4).map(e => e.id)]);
  step('home', `Finding your taste neighbours in ${input.homeCity}`, home.status, homeTwins.slice(0, 3).map(e => e.name).join(' · ') || home.note || 'None returned.');

  // 4. Heatmap of the target city: neighbourhood boundaries first, geohash cells if not supported.
  step('heat', `Mapping where this taste lives in ${input.targetCity}`, 'running');
  let heat = await tools.where_popular({ signals: signalIds, tags: vibeTags.map(t => t.id), location: input.targetCity, boundary: 'neighborhood' });
  if (heat.status !== 'ok') {
    const fallback = await tools.where_popular({ signals: signalIds, tags: vibeTags.map(t => t.id), location: input.targetCity });
    if (fallback.status === 'ok') { fallback.receipts = [...heat.receipts, ...fallback.receipts]; heat = fallback; degraded.push('Neighbourhood boundaries (fell back to map cells)'); }
  }
  if (heat.status !== 'ok') {
    step('heat', `Mapping where this taste lives in ${input.targetCity}`, heat.status, heat.note || 'No heatmap returned.');
    return { status: heat.status === 'partial' ? 'partial' : 'error', input, shop, steps, message: heat.note || `Qloo returned no taste map for ${input.targetCity}.`, ledger: run.ledger };
  }
  const cells = heat.results;
  const affinities = cells.map(c => c.affinity);
  const popularities = cells.map(c => c.popularity);
  for (const c of cells) { c.tastePct = pct(affinities, c.affinity); c.busyPct = pct(popularities, c.popularity); }
  step('heat', `Mapping where this taste lives in ${input.targetCity}`, 'ok', `${cells.length} ${heat.boundary === 'neighborhood' ? 'neighbourhoods' : 'map cells'} scored`);

  // 5. For the strongest distinct areas: anchor neighbours (recommend), saturation (same category nearby).
  step('areas', 'Checking anchors, prices and crowding in the top areas', 'running');
  const top = pickDistinctCells(cells, 3);
  const areas = await Promise.all(top.map(async cell => {
    const point = { lat: cell.lat, lon: cell.lon };
    const [anchors, same] = await Promise.all([
      tools.recommend({ signals: signalIds, point, radius: 1200, priceMin: input.price ? Math.max(1, input.price - 1) : undefined, priceMax: input.price ? Math.min(4, input.price + 1) : undefined, take: 8, explain: true }),
      categoryTag ? tools.recommend({ point, radius: 800, filterTags: [categoryTag.id], take: 30 }) : Promise.resolve({ status: 'empty', results: [], receipts: [], note: 'No category tag on your shop.' }),
    ]);
    const scored = scoreArea({ tastePct: cell.tastePct, sameCategoryCount: same.results.length, weight: input.weight });
    const named = cell.name || anchors.results.find(a => a.neighborhood)?.neighborhood || (anchors.results[0] ? `Around ${anchors.results[0].name}` : `Cell ${cell.id}`);
    return { cell, name: named, anchors: anchors.results.slice(0, 3), anchorPool: anchors.results, sameCategory: same.results.slice(0, 5).map(e => e.name), sameCategoryCount: same.results.length, sameCategoryStatus: same.status, priceFit: priceFit(input.price, anchors.results), explainability: anchors.explainability, receipts: [...heat.receipts, ...anchors.receipts, ...same.receipts], ...scored };
  }));
  step('areas', 'Checking anchors, prices and crowding in the top areas', areas.length ? 'ok' : 'empty', areas.map(a => a.name).join(' · '));

  // 6. Rank all anchors against the home crowd, compare audiences, check trends.
  step('verify', 'Comparing home crowd vs each area, checking trends', 'running');
  const allAnchors = uniq(areas.flatMap(a => a.anchorPool.map(x => x.id))).slice(0, 25);
  const [ranked, compares, trends] = await Promise.all([
    allAnchors.length ? tools.rank({ options: allAnchors, signals: signalIds }) : Promise.resolve({ status: 'empty', results: [], receipts: [] }),
    Promise.all(areas.map(a => (a.anchorPool.length ? tools.compare_audiences({ a: signalIds, b: a.anchorPool.slice(0, 5).map(x => x.id) }) : Promise.resolve({ status: 'empty', results: [], receipts: [] })))),
    Promise.all(areas.map(a => (a.anchors[0] ? tools.trends({ id: a.anchors[0].id }) : Promise.resolve({ status: 'empty', results: [], receipts: [], direction: 'unknown' })))),
  ]);
  const rankOf = new Map(ranked.results.map((e, i) => [e.id, i + 1]));
  areas.forEach((a, i) => {
    a.anchors = a.anchors.map(x => ({ ...x, rank: rankOf.get(x.id) }));
    a.shared = compares[i].results.slice(0, 5);
    a.compareStatus = compares[i].status;
    a.trend = { direction: trends[i].direction || 'unknown', status: trends[i].status, of: a.anchors[0]?.name };
    a.receipts.push(...ranked.receipts, ...compares[i].receipts, ...trends[i].receipts);
    a.saturationWarning = a.sameCategoryCount >= 8 ? `${a.sameCategoryCount} places in your category within 800 m. Expect a fight for the same customers.` : null;
  });
  step('verify', 'Comparing home crowd vs each area, checking trends', [ranked, ...compares].some(r => r.status === 'ok') ? 'ok' : 'degraded', `${ranked.results.length} anchors ranked`);
  areas.sort((a, b) => b.score - a.score);

  // 7. Without Qloo: what "go where it's busy" or a plain LLM would have picked.
  const busiest = pickDistinctCells([...cells].sort((a, b) => b.popularity - a.popularity), 3);
  const overlap = busiest.filter(b => areas.some(a => distanceMeters(a.cell, b) < 900)).length;
  const llmPick = await llm({ shop: shop.name, homeCity: input.homeCity, targetCity: input.targetCity }).catch(() => null);
  const withoutQloo = { busiest: busiest.map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, busyPct: c.busyPct, tastePct: c.tastePct })), overlap, llm: llmPick };

  const status = run.ledger.some(r => r.status === 'partial') ? 'partial' : degraded.length ? 'degraded' : 'ok';
  return {
    status, input, shop, steps,
    dna: { tags: dna.results.slice(0, 8), vibeTags, categoryTag, status: dna.status },
    crowd: { skews: summarizeDemographics(demo.results), status: demo.status },
    homeTwins, signalIds,
    map: { boundary: heat.boundary, cells: cells.slice(0, 120).map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, tastePct: c.tastePct, busyPct: c.busyPct })) },
    areas: areas.map(({ anchorPool, ...a }) => a),
    withoutQloo, degraded, disclosures: DISCLOSURES,
    ledger: run.ledger, budget: { used: run.used, limit: run.budget },
    generatedAt: new Date().toISOString(),
  };
}

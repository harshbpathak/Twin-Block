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
  const targetCity = cleanText('Target city', body.targetCity, { max: 80 });
  const vibes = cleanText('Vibe words', body.vibes, { max: 120 });
  if (targetCity && homeCity.toLowerCase() === targetCity.toLowerCase()) throw new InputError('Target city', 'Pick a target city different from your home city.');
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
  const decisions = [];
  const decide = (text) => { decisions.push(text); step(`decision-${decisions.length}`, 'Agent decision', 'degraded', text); };

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
    const exactAnywhere = d.results.filter(e => e.name.toLowerCase() === input.shop.toLowerCase());
    if (run.simulated && d.results[0]) shop = d.results[0];
    else if (exact.length === 1) shop = exact[0];
    else if (!exact.length && d.results.length === 1 && exactAnywhere.length === 1) shop = exactAnywhere[0];
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

  // 3b. City finder: where else does this crowd over-index? (Qloo localities)
  step('cities', 'Ranking other places where this crowd over-indexes', 'running');
  const cityRec = await tools.recommend({ signals: signalIds, type: 'urn:entity:locality', take: 12 });
  const homeWord = input.homeCity.toLowerCase().split(',')[0].trim();
  const cities = cityRec.results.filter(c => !c.name.toLowerCase().includes(homeWord)).slice(0, 8).map(c => ({ id: c.id, name: c.name, affinity: c.affinity, receipts: cityRec.receipts }));
  step('cities', 'Ranking other places where this crowd over-indexes', cityRec.status, cities.slice(0, 4).map(c => c.name).join(' · ') || cityRec.note || 'None returned.');
  const dnaOut = { tags: dna.results.slice(0, 8), vibeTags, categoryTag, status: dna.status, receipts: dna.receipts };
  const crowdOut = { skews: summarizeDemographics(demo.results), status: demo.status, receipts: demo.receipts };
  if (!input.targetCity) {
    return { status: 'needs_input', mode: 'cities', input, shop, steps, cities, dna: dnaOut, crowd: crowdOut, homeTwins, message: cities.length ? 'Pick where to look next.' : 'Qloo returned no city suggestions. Type a target city.', ledger: run.ledger, budget: { used: run.used, limit: run.budget } };
  }

  // 4. Heatmap of the target city: neighbourhood boundaries first, geohash cells if not supported.
  step('heat', `Mapping where this taste lives in ${input.targetCity}`, 'running');
  let heat = await tools.where_popular({ signals: signalIds, tags: vibeTags.map(t => t.id), location: input.targetCity, boundary: 'neighborhood' });
  if (heat.status !== 'ok') {
    const fallback = await tools.where_popular({ signals: signalIds, tags: vibeTags.map(t => t.id), location: input.targetCity });
    if (fallback.status === 'ok') { fallback.receipts = [...heat.receipts, ...fallback.receipts]; heat = fallback; degraded.push('Neighbourhood boundaries (fell back to map cells)'); decide('Neighbourhood boundaries unavailable, so the agent switched to map cells.'); }
  }
  if (heat.status === 'empty' && vibeTags.length) {
    const plain = await tools.where_popular({ signals: signalIds, location: input.targetCity });
    if (plain.status === 'ok') { plain.receipts = [...heat.receipts, ...plain.receipts]; heat = plain; degraded.push('Vibe words (dropped)'); decide(`The vibe words narrowed the map to nothing, so the agent retried without "${input.vibes}".`); }
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
    let [anchors, same] = await Promise.all([
      tools.recommend({ signals: signalIds, point, radius: 1200, priceMin: input.price ? Math.max(1, input.price - 1) : undefined, priceMax: input.price ? Math.min(4, input.price + 1) : undefined, take: 8, explain: true }),
      categoryTag ? tools.recommend({ point, radius: 800, filterTags: [categoryTag.id], take: 30 }) : Promise.resolve({ status: 'empty', results: [], receipts: [], note: 'No category tag on your shop.' }),
    ]);
    let priceRelaxed = false;
    if (anchors.status === 'empty' && input.price) {
      const wider = await tools.recommend({ signals: signalIds, point, radius: 1200, take: 8, explain: true });
      if (wider.status === 'ok') { wider.receipts = [...anchors.receipts, ...wider.receipts]; anchors = wider; priceRelaxed = true; }
    }
    const scored = scoreArea({ tastePct: cell.tastePct, sameCategoryCount: same.results.length, weight: input.weight });
    const named = cell.name || anchors.results.find(a => a.neighborhood)?.neighborhood || (anchors.results[0] ? `Around ${anchors.results[0].name}` : `Cell ${cell.id}`);
    return { cell, name: named, anchors: anchors.results.slice(0, 3), anchorPool: anchors.results, sameCategory: same.results.slice(0, 5).map(e => e.name), sameCategoryCount: same.results.length, sameCategoryStatus: same.status, priceFit: priceFit(input.price, anchors.results), priceRelaxed, explainability: anchors.explainability, receipts: [...heat.receipts, ...anchors.receipts, ...same.receipts], ...scored };
  }));
  step('areas', 'Checking anchors, prices and crowding in the top areas', areas.length ? 'ok' : 'empty', areas.map(a => a.name).join(' · '));
  for (const a of areas.filter(x => x.priceRelaxed)) decide(`No taste-matched places near ${a.name} at your price level, so the agent widened to all price levels.`);

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

  // 6b. Gap finder: does the best area already serve what this crowd loves? Few matches nearby = an opening.
  const placeTags = dna.results.filter(t => /place/.test(`${t.id} ${t.type}`)).slice(0, 2);
  if (areas[0] && placeTags.length) {
    step('gap', `Looking for gaps your crowd would fill in ${areas[0].name}`, 'running');
    const top = areas[0];
    top.gaps = await Promise.all(placeTags.map(async t => {
      const g = await tools.recommend({ point: { lat: top.cell.lat, lon: top.cell.lon }, radius: 1200, filterTags: [t.id], take: 20 });
      top.receipts.push(...g.receipts);
      return { tag: t.name, count: g.results.length, status: g.status, open: g.status !== 'error' && g.status !== 'partial' && g.results.length <= 3, receipts: g.receipts };
    }));
    step('gap', `Looking for gaps your crowd would fill in ${areas[0].name}`, 'ok', top.gaps.map(g => `${g.tag}: ${g.count} nearby`).join(' · '));
  }
  const stability = stabilityCheck(areas);

  // 7. Without Qloo: what "go where it's busy" or a plain LLM would have picked.
  const busiest = pickDistinctCells([...cells].sort((a, b) => b.popularity - a.popularity), 3);
  const overlap = busiest.filter(b => areas.some(a => distanceMeters(a.cell, b) < 900)).length;
  const llmPick = await llm({ shop: shop.name, homeCity: input.homeCity, targetCity: input.targetCity }).catch(() => null);
  const withoutQloo = { busiest: busiest.map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, busyPct: c.busyPct, tastePct: c.tastePct })), overlap, llm: llmPick };

  const status = run.ledger.some(r => r.status === 'partial') ? 'partial' : degraded.length ? 'degraded' : 'ok';
  return {
    status, input, shop, steps, simulated: Boolean(run.simulated),
    dna: dnaOut, crowd: crowdOut, cities, stability,
    note: agentNote({ input, shop, dna: dnaOut, areas, overlap, stability }),
    homeTwins, signalIds,
    map: { boundary: heat.boundary, cells: cells.slice(0, 120).map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, tastePct: c.tastePct, busyPct: c.busyPct })) },
    areas: areas.map(({ anchorPool, ...a }) => a),
    withoutQloo, degraded, decisions, disclosures: DISCLOSURES,
    ledger: run.ledger, budget: { used: run.used, limit: run.budget },
    generatedAt: new Date().toISOString(),
  };
}

/** Ranking gate: does the #1 area survive different taste weights? */
export function stabilityCheck(areas, weights = [30, 50, 70, 90]) {
  if (!areas.length) return { stable: false, winners: [] };
  const winners = weights.map(weight => {
    const best = [...areas].map(a => ({ name: a.name, s: scoreArea({ tastePct: a.cell.tastePct, sameCategoryCount: a.sameCategoryCount, weight }).score })).sort((x, y) => y.s - x.s)[0];
    return { weight, name: best.name };
  });
  return { stable: new Set(winners.map(w => w.name)).size === 1, winners };
}

/** Plain-English summary built only from fields above. Every sentence carries the receipts it came from. */
export function agentNote({ input, shop, dna, areas, overlap, stability }) {
  const out = [];
  const top = areas[0];
  if (dna.tags.length) out.push({ text: `${shop.name}'s crowd over-indexes on ${dna.tags.slice(0, 3).map(t => t.name).join(', ')}.`, receipts: dna.receipts });
  if (top) {
    out.push({ text: `In ${input.targetCity}, ${top.name} is the strongest twin: taste match ${top.cell.tastePct}/100${top.anchors[0] ? `, anchored by ${top.anchors.slice(0, 2).map(a => a.name).join(' and ')}` : ''}.`, receipts: top.receipts.slice(0, 2) });
    out.push({ text: top.saturationWarning ? `Watch out: ${top.saturationWarning}` : `Crowding looks manageable: ${top.sameCategoryCount} places in your category within 800 m.`, receipts: top.receipts.slice(2, 4) });
    if (top.priceFit?.label && top.priceFit.label !== 'unknown') out.push({ text: top.priceFit.note, receipts: top.receipts.slice(1, 2) });
  }
  const open = top?.gaps?.filter(g => g.open) || [];
  if (open.length) out.push({ text: `Opening spotted: your crowd loves ${open.map(g => g.tag).join(' and ')}, but Qloo finds only ${open.map(g => g.count).join(' and ')} such place(s) within 1.2 km of ${top.name}.`, receipts: open.flatMap(g => g.receipts) });
  out.push({ text: stability.stable ? 'The #1 pick holds whether you weight taste at 30% or 90%, so it is a stable recommendation.' : `The #1 pick changes with the weighting (${stability.winners.map(w => `${w.weight}% → ${w.name}`).join(', ')}), so treat the shortlist as exploratory.`, receipts: [] });
  out.push({ text: overlap < 2 ? `Only ${overlap} of the 3 busiest areas match your taste picks. Busy is not the same as right for you.` : 'Here the busiest areas and your taste picks largely agree.', receipts: [] });
  return out;
}

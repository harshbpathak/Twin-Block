/** Spatial evaluation only; callers must build taste scores using training data alone. */
export function distanceMeters(a, b) {
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function locations(rows, name) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${name} must be nonempty`);
  const ids = new Set();
  for (const r of rows) {
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) throw new Error(`${name}: unique string IDs required`);
    ids.add(r.id);
    if (!Number.isFinite(r.lat) || Math.abs(r.lat) > 90 || !Number.isFinite(r.lon) || Math.abs(r.lon) > 180) throw new Error(`${name}: invalid coordinates`);
  }
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function runBacktest({ cells, trainingLocations, heldOutLocations, scoreSourceIds, k = 5, hitRadiusMeters = 250, seed = 42, randomTrials = 200, llmRanking } = {}) {
  locations(cells, 'cells'); locations(trainingLocations, 'trainingLocations'); locations(heldOutLocations, 'heldOutLocations');
  if (!Number.isInteger(k) || k < 1 || k > cells.length) throw new Error('k must be between 1 and candidate count');
  if (!Number.isFinite(hitRadiusMeters) || hitRadiusMeters <= 0) throw new Error('positive hit radius required');
  if (!Number.isInteger(randomTrials) || randomTrials < 1 || randomTrials > 10000 || !Number.isInteger(seed)) throw new Error('integer seed and 1–10000 random trials required');
  const trainIds = new Set(trainingLocations.map(x => x.id));
  for (const h of heldOutLocations) if (trainIds.has(h.id) || trainingLocations.some(t => distanceMeters(t, h) < 1)) throw new Error('held-out leakage: overlapping ID or location');
  if (!Array.isArray(scoreSourceIds) || !scoreSourceIds.length || scoreSourceIds.some(id => !trainIds.has(id))) throw new Error('scoreSourceIds must identify training locations only');
  for (const c of cells) if (!Number.isFinite(c.tasteScore) || !Number.isFinite(c.busyScore)) throw new Error('finite tasteScore and busyScore required for every cell');
  const evaluate = picks => {
    const hit = picks.filter(p => heldOutLocations.some(h => distanceMeters(p, h) <= hitRadiusMeters)).length;
    const covered = heldOutLocations.filter(h => picks.some(p => distanceMeters(p, h) <= hitRadiusMeters)).length;
    return { ids: picks.map(p => p.id), precisionAtK: hit / k, heldOutCoverage: covered / heldOutLocations.length, hitCells: hit, coveredLocations: covered };
  };
  const rank = key => [...cells].sort((a,b) => b[key] - a[key] || a.id.localeCompare(b.id)).slice(0,k);
  const random = rng(seed), trials = [];
  for (let i=0; i<randomTrials; i++) {
    const shuffled = [...cells];
    for (let j=shuffled.length-1; j>0; j--) { const n=Math.floor(random()*(j+1)); [shuffled[j],shuffled[n]]=[shuffled[n],shuffled[j]]; }
    trials.push(evaluate(shuffled.slice(0,k)));
  }
  const result = { config: { k, hitRadiusMeters, seed, randomTrials }, counts: { candidates: cells.length, training: trainingLocations.length, heldOut: heldOutLocations.length }, taste: evaluate(rank('tasteScore')), busy: evaluate(rank('busyScore')), random: { meanPrecisionAtK: trials.reduce((s,t)=>s+t.precisionAtK,0)/randomTrials, meanHeldOutCoverage: trials.reduce((s,t)=>s+t.heldOutCoverage,0)/randomTrials }, limitations: ['Spatial proximity measures retrospective location fit, not business success or causal demand.', 'Score provenance is caller-declared; this evaluator cannot inspect how upstream scores were created.', 'Nearby overlapping candidate cells may match the same held-out location; coverage reports unique held-out locations.'] };
  if (llmRanking !== undefined) {
    const byId = new Map(cells.map(c=>[c.id,c]));
    if (!Array.isArray(llmRanking) || llmRanking.length < k || new Set(llmRanking).size !== llmRanking.length || llmRanking.some(id=>!byId.has(id))) throw new Error('LLM ranking must contain unique known candidate IDs and at least k entries');
    result.llm = evaluate(llmRanking.slice(0,k).map(id=>byId.get(id)));
  }
  return result;
}

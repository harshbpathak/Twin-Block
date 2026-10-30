// SIMULATION MODE. Used only when no QLOO_API_KEY is set, so the hosted demo can be clicked through while the key is pending.
// Everything here is generated: invented place names, invented scores. The UI labels every screen "SIMULATED".
// Backtest stores are placed uniformly at random, so simulated backtest numbers carry no signal and cannot flatter Twin Block.
// Implements the same HTTP surface as the Qloo endpoints Twin Block uses, as a fetch() replacement.

export const SIM_CITIES = {
  'austin': [30.267, -97.743], 'denver': [39.739, -104.99], 'st. louis': [38.627, -90.199], 'atlanta': [33.749, -84.388],
  'new york': [40.73, -73.99], 'los angeles': [34.052, -118.244], 'chicago': [41.878, -87.63], 'nashville': [36.163, -86.781],
  'san francisco': [37.775, -122.419], 'washington': [38.907, -77.037], 'boston': [42.36, -71.059], 'dallas': [32.777, -96.797],
  'seattle': [47.606, -122.332], 'portland': [45.515, -122.679], 'miami': [25.762, -80.192], 'houston': [29.76, -95.37],
  'philadelphia': [39.953, -75.165], 'phoenix': [33.448, -112.074], 'minneapolis': [44.978, -93.265], 'detroit': [42.331, -83.046],
  'new orleans': [29.951, -90.072], 'san diego': [32.716, -117.161], 'las vegas': [36.17, -115.14], 'charlotte': [35.227, -80.843], 'pittsburgh': [40.441, -79.996],
};
const DISTRICTS = ['Foundry Yards', 'Maple Row', 'Old Mill', 'Riverbend', 'Copper Hill', 'Lantern Square', 'North Commons', 'Brickworks', 'Cedar Flats', 'Harbor Gate', 'Orchard Heights', 'Signal Park', 'Ironside', 'Willow End', 'Market Cross', 'Tannery Row', 'Pinecrest', 'Union Fields', 'Stonebridge', 'Lakeshore West', 'Garnet Street', 'Elm Terrace', 'Railyard', 'Sunset Junction', 'Kiln District', 'Bluebell', 'Granary', 'Highline', 'Fern Hollow', 'Quarry Point', 'Mercer Bend', 'Chapel Hill East', 'Canal Works', 'Ashgrove', 'Juniper Way', 'Tidewater'];
const PLACE_A = ['Little', 'Golden', 'Night Owl', 'Corner', 'Blue Door', 'Copper', 'Second Street', 'Wild', 'Lucky', 'Velvet', 'Paper Moon', 'Rooftop', 'Hidden', 'Old Town', 'Neon'];
const PLACE_B = ['Taqueria', 'Coffee Co.', 'Tap Room', 'Noodle Bar', 'Supper Club', 'Bakehouse', 'Record Bar', 'Smokehouse', 'Cantina', 'Diner', 'Wine Bar', 'Comedy Room', 'Bowl', 'Pizzeria', 'Listening Room'];
const TAGS = [['Street Food', 'genre:place:restaurant:street_food'], ['Late Night', 'keyword:place:late_night'], ['Patio', 'amenity:place:patio'], ['Craft Beer', 'genre:place:bar:craft_beer'], ['Live Music', 'keyword:place:live_music'], ['Family Friendly', 'keyword:place:family_friendly'], ['Vintage', 'keyword:place:vintage'], ['Brunch', 'genre:place:restaurant:brunch'], ['Indie', 'keyword:place:indie'], ['Barbecue', 'genre:place:restaurant:barbecue'], ['Cocktails', 'genre:place:bar:cocktail'], ['Comedy', 'keyword:place:comedy']];

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cityKey = q => String(q || '').toLowerCase().split(',')[0].trim();
const names = new Map(); // simulated entity id -> name
const idFor = (kind, key) => `sim-${kind}-${hash(key).toString(16).padStart(8, '0')}`;

function place(seed, lat, lon, i, affinity) {
  const r = rng(seed + i * 7919);
  const name = `${PLACE_A[Math.floor(r() * PLACE_A.length)]} ${PLACE_B[Math.floor(r() * PLACE_B.length)]}`;
  const id = idFor('place', `${seed}-${i}`);
  names.set(id, name);
  const t = TAGS[Math.floor(r() * TAGS.length)];
  return { entity_id: id, name, subtype: 'urn:entity:place', properties: { address: `${Math.floor(r() * 2900) + 100} ${DISTRICTS[Math.floor(r() * DISTRICTS.length)]} Ave (simulated)`, price_level: 1 + Math.floor(r() * 3) }, location: { lat: lat + (r() - 0.5) * 0.012, lon: lon + (r() - 0.5) * 0.014 }, tags: [{ id: `urn:tag:${t[1]}`, name: t[0], type: 'urn:tag:genre:place' }], query: { affinity: affinity ?? Math.max(0.05, 0.95 - i * 0.07 - r() * 0.05) } };
}

function grid(city) {
  const c = SIM_CITIES[cityKey(city)];
  if (!c) return [];
  const cells = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) cells.push({ lat: c[0] + (y - 2.5) * 0.017, lon: c[1] + (x - 2.5) * 0.021, i: y * 6 + x });
  return cells;
}

function heatmap(p) {
  const cells = grid(p['filter.location.query']);
  const r = rng(hash(`${p['signal.interests.entities']}|${p['signal.interests.tags'] || ''}|${p['filter.location.query']}`));
  const hot = [0, 1, 2].map(() => ({ x: r() * 5, y: r() * 5, w: 0.6 + r() * 0.6 }));
  const named = p['output.heatmap.boundary'] === 'neighborhood';
  const offset = hash(cityKey(p['filter.location.query'])) % DISTRICTS.length;
  return cells.map(c => {
    const x = c.i % 6, y = Math.floor(c.i / 6);
    const affinity = Math.min(1, hot.reduce((s, h) => s + h.w * Math.exp(-((x - h.x) ** 2 + (y - h.y) ** 2) / 3), 0) / 1.4 + r() * 0.05);
    const popularity = Math.exp(-((x - 2.5) ** 2 + (y - 2.5) ** 2) / 5) * 0.9 + r() * 0.1;
    return { location: { latitude: c.lat, longitude: c.lon, geohash: `sim${c.i}`, ...(named ? { name: DISTRICTS[(c.i + offset) % DISTRICTS.length] } : {}) }, query: { affinity: +affinity.toFixed(3), popularity: +popularity.toFixed(3) } };
  });
}

function respond(results, extra = {}) { return new Response(JSON.stringify({ success: true, simulated: true, results, ...extra }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

export async function simFetch(url) {
  const u = new URL(url);
  const p = Object.fromEntries(u.searchParams);
  const type = p['filter.type'];
  if (u.pathname === '/search') {
    const kind = p.types === 'urn:entity:brand' ? 'brand' : 'place';
    // Never attach invented data to a real business: the typed name is replaced.
    const id = idFor(kind, p.query.toLowerCase());
    const label = kind === 'brand' ? 'Simulated chain' : 'Your shop (simulated)';
    names.set(id, label);
    return respond({ entities: [{ entity_id: id, name: label, subtype: p.types, properties: { address: 'Simulated match (no Qloo key yet)' }, tags: [{ id: 'urn:tag:genre:place:restaurant:street_food', name: 'Street Food', type: 'urn:tag:genre:place' }] }] });
  }
  if (u.pathname === '/entities') {
    const id = p.entity_ids.split(',')[0];
    return respond({ entities: [{ entity_id: id, name: names.get(id) || 'Simulated shop', subtype: 'urn:entity:place', properties: { address: 'Simulated match (no Qloo key yet)' }, tags: [{ id: 'urn:tag:genre:place:restaurant:street_food', name: 'Street Food', type: 'urn:tag:genre:place' }] }] });
  }
  if (u.pathname === '/v2/tags') { const r = rng(hash(p['filter.query'])); return respond({ tags: [TAGS[Math.floor(r() * TAGS.length)]].map(([name, id]) => ({ id: `urn:tag:${id}`, name, type: 'urn:tag:keyword' })) }); }
  if (u.pathname === '/v2/analysis/compare') { const r = rng(hash(p['b.signal.interests.entities'])); return respond({ tags: [0, 1, 2, 3].map(() => TAGS[Math.floor(r() * TAGS.length)]).filter((t, i, a) => a.indexOf(t) === i).map(([name, id]) => ({ tag_id: `urn:tag:${id}`, name, query: { a: { affinity: +(0.5 + r() * 0.5).toFixed(2) }, b: { affinity: +(0.3 + r() * 0.6).toFixed(2) } } })) }); }
  if (u.pathname === '/v2/trending') { const r = rng(hash(p['signal.interests.entities'])); const dir = r() - 0.5; return respond({ trending: Array.from({ length: 8 }, (_, i) => ({ population_percentile: +(0.5 + dir * i * 0.05 + r() * 0.02).toFixed(3) })) }); }
  if (type === 'urn:tag') { const r = rng(hash(p['signal.interests.entities'])); return respond({ tags: [0, 1, 2, 3, 4, 5].map(() => TAGS[Math.floor(r() * TAGS.length)]).filter((t, i, a) => a.indexOf(t) === i).map(([name, id], i) => ({ id: `urn:tag:${id}`, name, type: 'urn:tag', query: { affinity: +(0.95 - i * 0.1).toFixed(2) } })) }); }
  if (type === 'urn:demographics') return respond({ demographics: [{ query: { age: { '25_to_29': 0.31, '30_to_34': 0.18, '24_and_younger': 0.05 }, gender: { female: 0.06 } } }] });
  if (type === 'urn:heatmap') return respond({ heatmap: heatmap(p) });
  if (type === 'urn:entity:locality') { const r = rng(hash(p['signal.interests.entities'])); const list = Object.keys(SIM_CITIES).sort(() => r() - 0.5).slice(0, 10); return respond({ entities: list.map((k, i) => ({ entity_id: idFor('loc', k), name: k.replace(/\b\w/g, c => c.toUpperCase()), subtype: 'urn:entity:locality', query: { affinity: +(0.92 - i * 0.06).toFixed(2) } })) }); }
  if (type === 'urn:entity:place') {
    if (p['filter.references_brand']) {
      // Uniformly random store positions: simulated backtests carry no signal by design.
      const cells = grid(p['filter.location.query']);
      if (!cells.length) return respond({ entities: [] });
      const r = rng(hash(`${p['filter.references_brand']}|${p['filter.location.query']}`));
      const n = 4 + Math.floor(r() * 4);
      const lat0 = Math.min(...cells.map(c => c.lat)), lat1 = Math.max(...cells.map(c => c.lat)), lon0 = Math.min(...cells.map(c => c.lon)), lon1 = Math.max(...cells.map(c => c.lon));
      return respond({ entities: Array.from({ length: n }, (_, i) => ({ entity_id: idFor('store', `${p['filter.references_brand']}-${p['filter.location.query']}-${i}`), name: `Simulated store ${i + 1}`, location: { lat: lat0 + r() * (lat1 - lat0), lon: lon0 + r() * (lon1 - lon0) } })) });
    }
    if (p['filter.results.entities']) return respond({ entities: p['filter.results.entities'].split(',').map((id, i) => ({ entity_id: id, name: names.get(id) || `Simulated place ${i + 1}`, query: { affinity: +(0.9 - i * 0.03).toFixed(3) } })) });
    let lat, lon, seed;
    if (p['filter.location']) { const m = p['filter.location'].match(/POINT\(([-\d.]+) ([-\d.]+)\)/); lon = Number(m?.[1]); lat = Number(m?.[2]); seed = hash(p['filter.location'] + (p['filter.tags'] || '')); }
    else { const c = SIM_CITIES[cityKey(p['filter.location.query'])]; if (!c) return respond({ entities: [] }); [lat, lon] = c; seed = hash((p['filter.location.query'] || '') + p['signal.interests.entities']); }
    const count = p['filter.tags'] ? rng(seed)() * 12 | 0 : Math.min(Number(p.take) || 10, 10);
    const exclude = new Set((p['filter.exclude.entities'] || '').split(','));
    const body = { success: true, simulated: true, results: { entities: Array.from({ length: count }, (_, i) => place(seed, lat, lon, i)).filter(e => !exclude.has(e.entity_id)) } };
    if (p['feature.explainability']) body.query = { explainability: { 'signal.interests.entities': (p['signal.interests.entities'] || '').split(',').slice(0, 4).map((id, i) => ({ entity_id: id, score: +(0.45 - i * 0.1).toFixed(2) })) } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('{"message":"not simulated"}', { status: 404 });
}

/** Options for createRun(): simulation when there is no key (unless SIMULATION=off). */
export function runOptions(extra = {}) {
  if (process.env.QLOO_API_KEY || process.env.SIMULATION === 'off') return extra;
  return { apiKey: 'simulated', fetchImpl: simFetch, diskCache: false, simulated: true, ...extra };
}

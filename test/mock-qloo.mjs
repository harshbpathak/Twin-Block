// A fake Qloo API for tests. Shapes follow the documented response envelopes ({ success, results: {...} }).
export const SHOP = { entity_id: 'shop-0001', name: 'Veracruz All Natural', subtype: 'urn:entity:place', properties: { address: '1704 E Cesar Chavez St, Austin, TX', price_level: 1 }, location: { lat: 30.256, lon: -97.72 }, tags: [{ id: 'urn:tag:genre:place:restaurant:mexican', name: 'Mexican', type: 'urn:tag:genre:place' }] };

const DENVER = { lat: 39.74, lon: -104.99 };
const HOODS = ['RiNo', 'Highland', 'Baker', 'Five Points', 'Capitol Hill', 'LoHi', 'Cherry Creek', 'Sloan Lake', 'Berkeley', 'Platt Park', 'Congress Park', 'Uptown', 'Jefferson Park', 'Sunnyside', 'Whittier', 'Cole', 'Washington Park', 'Union Station', 'Golden Triangle', 'Lincoln Park', 'Villa Park', 'Barnum', 'Athmar Park', 'Ruby Hill', 'University', 'Hale', 'Montclair', 'Park Hill', 'Clayton', 'Elyria'];
const cell = (i, n = 6) => ({ lat: DENVER.lat + (Math.floor(i / n) - 2) * 0.02, lon: DENVER.lon + ((i % n) - 3) * 0.025 });

export function mockFetch({ calls = [], fail = {}, ambiguous = false } = {}) {
  return async url => {
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, p });
    if (fail[u.pathname] || fail[p['filter.type']]) return new Response('{"message":"boom"}', { status: fail[u.pathname] || fail[p['filter.type']] });
    const ok = results => new Response(JSON.stringify({ success: true, results }), { status: 200 });
    if (u.pathname === '/search') {
      if (p.types === 'urn:entity:brand') return ok({ entities: [{ entity_id: 'brand-0001', name: p.query }] });
      if (ambiguous) return ok({ entities: [SHOP, { ...SHOP, entity_id: 'shop-0002', properties: { address: '111 Burnet Rd, Austin, TX' } }] });
      return ok({ entities: [SHOP] });
    }
    if (u.pathname === '/entities') return ok({ entities: [SHOP] });
    if (u.pathname === '/v2/tags') return ok({ tags: [{ id: 'urn:tag:keyword:qloo:late_night', name: 'Late Night', type: 'urn:tag:keyword' }] });
    if (u.pathname === '/v2/analysis/compare') return ok({ tags: [{ tag_id: 'urn:tag:x:1', name: 'Street Food', query: { a: { affinity: 0.9 }, b: { affinity: 0.8 } } }, { tag_id: 'urn:tag:x:2', name: 'Craft Beer', query: { a: { affinity: 0.7 }, b: { affinity: 0.6 } } }] });
    if (u.pathname === '/v2/trending') return ok({ trending: [1, 2, 3, 4, 5, 6].map(v => ({ population_percentile: v / 10 })) });
    const type = p['filter.type'];
    if (type === 'urn:tag') return ok({ tags: [{ id: 'urn:tag:a', name: 'Tacos', query: { affinity: 0.9 } }, { id: 'urn:tag:b', name: 'Patio', query: { affinity: 0.7 } }] });
    if (type === 'urn:demographics') return ok({ demographics: [{ entity_id: SHOP.entity_id, query: { age: { '25_to_29': 0.4, '24_and_younger': 0.2 }, gender: { female: 0.1 } } }] });
    if (type === 'urn:heatmap') {
      return ok({ heatmap: Array.from({ length: 30 }, (_, i) => { const c = cell(i); return { location: { latitude: c.lat, longitude: c.lon, geohash: `gh${i}`, ...(p['output.heatmap.boundary'] === 'neighborhood' ? { name: HOODS[i] } : {}) }, query: { affinity: 1 - i / 30, popularity: (i % 7) / 7 } }; }) });
    }
    if (type === 'urn:entity:locality') return ok({ entities: ['Austin', 'Denver', 'Portland', 'Nashville', 'Asheville', 'Tucson', 'Boulder', 'Oakland'].map((n, i) => ({ entity_id: `loc-${i}`, name: n, subtype: 'urn:entity:locality', query: { affinity: 0.95 - i * 0.05 } })) });
    if (type === 'urn:entity:place') {
      if (p['filter.references_brand']) {
        // Training city: 4 stores. Test city: 5 stores, located at the top-affinity heatmap cells.
        const test = /Chicago|Denver/.test(p['filter.location.query'] || '');
        const list = test ? [0, 1, 2, 7, 13].map(i => ({ entity_id: `store-t${i}`, name: 'Shake Shack', location: { lat: cell(i).lat + 0.001, lon: cell(i).lon } })) : [0, 1, 2, 3].map(i => ({ entity_id: `store-a${i}`, name: 'Shake Shack', location: { lat: 40.7 + i * 0.01, lon: -74 } }));
        return ok({ entities: list });
      }
      if (p['filter.tags']) return ok({ entities: Array.from({ length: 9 }, (_, i) => ({ entity_id: `same-${i}`, name: `Taqueria ${i}` })) });
      if (p['filter.results.entities']) return ok({ entities: p['filter.results.entities'].split(',').map((id, i) => ({ entity_id: id, name: `Ranked ${i}`, query: { affinity: 1 - i / 20 } })) });
      const base = p['filter.location'] ? DENVER : { lat: 30.26, lon: -97.74 };
      const exclude = new Set((p['filter.exclude.entities'] || '').split(','));
      const list = Array.from({ length: 10 }, (_, i) => ({ entity_id: `place-${p['filter.location'] ? 'd' : 'a'}${i}`, name: i === 0 ? 'Shake Shack Annex' : ['Mile High Tacos', 'Sputnik Bar', 'Hi-Dive', 'Little Man Ice Cream', 'Hop Alley', 'Denver Central Market', 'Tacos Tequila Whiskey', 'Huckleberry Roasters', 'Linger'][i - 1], properties: { price_level: 1 + (i % 3), address: `${i} Main St` }, location: { lat: base.lat + i * 0.003, lon: base.lon }, query: { affinity: 1 - i / 10 } })).filter(e => !exclude.has(e.entity_id));
      const body = { success: true, results: { entities: list } };
      if (p['feature.explainability']) body.query = { explainability: { 'signal.interests.entities': (p['signal.interests.entities'] || '').split(',').slice(0, 3).map((id, i) => ({ entity_id: id, score: 0.5 - i * 0.15 })) } };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
}

// 30-minute feasibility spike. Checks the raw Qloo features Twin Block depends on, with real calls.
// Usage: QLOO_API_KEY=... node scripts/spike.mjs
import { createRun, resultArray } from '../lib/qloo.mjs';

const run = createRun({ budget: 20, diskCache: false });
if (!run.configured) { console.error('Set QLOO_API_KEY first.'); process.exit(1); }
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

const s = await run.call('spike', '/search', { query: 'Shake Shack', types: 'urn:entity:brand', take: 3 });
const brand = resultArray(s.data, 'entities')[0];
check('search brand', Boolean(brand), brand ? `${brand.name} ${brand.entity_id}` : s.receipt.error || 'none');

if (brand) {
  const st = await run.call('spike', '/v2/insights', { 'filter.type': 'urn:entity:place', 'filter.references_brand': brand.entity_id, 'filter.location.query': 'Chicago', take: 50 });
  const stores = resultArray(st.data, 'entities');
  check('filter.references_brand store list', stores.length >= 3, `${stores.length} stores in Chicago ${st.receipt.error || ''}`);
}

const p = await run.call('spike', '/search', { query: 'Veracruz All Natural', types: 'urn:entity:place', take: 5 });
const place = resultArray(p.data, 'entities')[0];
check('search place', Boolean(place), place ? `${place.name} · ${place.properties?.address || ''}` : p.receipt.error || 'none');

if (place) {
  const hn = await run.call('spike', '/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': place.entity_id, 'filter.location.query': 'Denver', 'output.heatmap.boundary': 'neighborhood', take: 50 });
  const cells = resultArray(hn.data, 'heatmap');
  check('heatmap boundary=neighborhood', cells.length > 0, `${cells.length} cells; sample ${JSON.stringify(cells[0]?.location || {}).slice(0, 120)} ${hn.receipt.error || ''}`);
  const hg = await run.call('spike', '/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': place.entity_id, 'filter.location.query': 'Denver', take: 50 });
  check('heatmap geohash cells', resultArray(hg.data, 'heatmap').length > 0, `${resultArray(hg.data, 'heatmap').length} cells ${hg.receipt.error || ''}`);
  const pr = await run.call('spike', '/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': place.entity_id, 'filter.location.query': 'Denver', 'filter.price_level.max': 2, 'feature.explainability': true, take: 5 });
  check('price_level + explainability', resultArray(pr.data, 'entities').length > 0, `${resultArray(pr.data, 'entities').length} places; explainability ${pr.data?.query?.explainability ? 'present' : 'absent'} ${pr.receipt.error || ''}`);
  const tr = await run.call('spike', '/v2/trending', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': place.entity_id, 'filter.start_date': '2026-05-01', 'filter.end_date': '2026-10-01', take: 10 });
  check('trending', tr.ok, `${resultArray(tr.data, 'trending').length} points ${tr.receipt.error || ''}`);
  const cmp = await run.call('spike', '/v2/analysis/compare', { 'a.signal.interests.entities': place.entity_id, 'b.signal.interests.entities': place.entity_id, take: 5 });
  check('analysis/compare', cmp.ok, `${cmp.receipt.count} rows ${cmp.receipt.error || ''}`);
}
console.log(`\n${checks.filter(c => c.pass).length}/${checks.length} passed · ${run.used} calls`);

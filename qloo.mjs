// Server-only Qloo adapter. Never import into a browser bundle.
const allowed = new Set(['filter.type','filter.location','filter.location.query','filter.location.radius','signal.location.query','signal.interests.entities','filter.results.entities','filter.references_brand','filter.tags','filter.price_level.min','filter.price_level.max','feature.explainability','take','page']);
const types = new Set(['urn:entity:place','urn:entity:brand','urn:entity:artist','urn:entity:book','urn:entity:movie','urn:entity:podcast','urn:entity:tv_show']);
export function validateNeighborhood(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\x00-\x1f]/.test(name)) throw new Error('Enter a neighbourhood name of 1–160 characters.');
  return name.trim();
}
export async function queryInsights(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid Qloo parameters.');
  if (!types.has(params['filter.type'])) throw new Error('Unsupported entity category.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key)) throw new Error('Unsupported Qloo parameter.');
    if (value == null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('Invalid Qloo parameter value.');
    if (String(value).length > 8000) throw new Error('Qloo parameter is too long.');
    if (key.endsWith('.query')) validateNeighborhood(value);
    if (['take','page','filter.location.radius','filter.price_level.min','filter.price_level.max'].includes(key)) {
      const min = key === 'filter.location.radius' ? 0 : 1;
      const max = key === 'take' ? 50 : key.startsWith('filter.price_level') ? 4 : key === 'filter.location.radius' ? 100000 : 1000;
      if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Qloo numeric parameter is out of range.');
    }
    if (key === 'feature.explainability' && ![true,false,'true','false'].includes(value)) throw new Error('Invalid explainability flag.');
    query.set(key,String(value));
  }
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new Error('Live Qloo access is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://hackathon.api.qloo.com/v2/insights?${query}`, {headers:{'X-Api-Key':key,Accept:'application/json'}, signal:controller.signal,redirect:'error'});
    if (!response.ok) throw new Error(`Qloo request failed (HTTP ${response.status}).`);
    const raw = await response.text();
    if (raw.length > 4_000_000) throw new Error('Qloo response exceeded the size limit.');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Qloo returned an invalid response.'); }
    if (!data || typeof data !== 'object' || !data.results || typeof data.results !== 'object') throw new Error('Qloo response has no usable results.');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Qloo timed out. Try again.');
    if (error.message.startsWith('Qloo')) throw error;
    throw new Error('Qloo could not be reached.');
  } finally { clearTimeout(timer); }
}
export function neighborhoodPlaces(name, page = 1) {
  return queryInsights({'filter.type':'urn:entity:place','filter.location.query':validateNeighborhood(name),'filter.location.radius':0,take:50,page});
}

// The 10 Qloo workflow tools (same names as the official qloo harness), implemented over the REST API.
// Each returns { tool, status, results, receipts, note? } and never invents data: failures come back labelled.
import { resultArray } from './qloo.mjs';

export const TOOL_NAMES = ['capabilities', 'describe', 'find_tags', 'entity_tags', 'audience_demographics', 'recommend', 'where_popular', 'compare_audiences', 'rank', 'trends'];

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function compactEntity(e) {
  if (!e || typeof e !== 'object' || !e.entity_id) return undefined;
  const p = e.properties || {};
  const loc = e.location || p.geocode || {};
  const lat = num(loc.lat ?? loc.latitude);
  const lon = num(loc.lon ?? loc.lng ?? loc.longitude);
  return {
    id: e.entity_id,
    name: String(e.name || '').slice(0, 120),
    type: e.subtype || e.type || '',
    address: p.address ? String(p.address).slice(0, 160) : undefined,
    neighborhood: p.neighborhood ? String(p.neighborhood).slice(0, 80) : undefined,
    priceLevel: num(p.price_level),
    rating: num(p.business_rating),
    lat, lon,
    affinity: num(e.query?.affinity ?? e.affinity),
    popularity: num(e.popularity),
    tags: Array.isArray(e.tags) ? e.tags.slice(0, 25).map(t => ({ id: t.id || t.tag_id, name: t.name, type: t.type || t.subtype })).filter(t => t.id && t.name) : [],
  };
}

export function compactTag(t) {
  if (!t || typeof t !== 'object') return undefined;
  const id = t.id || t.tag_id || t.entity_id;
  if (!id || !t.name) return undefined;
  return { id, name: String(t.name).slice(0, 80), type: t.subtype || t.type || '', affinity: num(t.query?.affinity ?? t.affinity), popularity: num(t.popularity) };
}

export function compactCell(c) {
  const loc = c?.location || {};
  const lat = num(loc.latitude ?? loc.lat), lon = num(loc.longitude ?? loc.lon);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    id: String(loc.geohash || loc.name || `${lat.toFixed(4)},${lon.toFixed(4)}`),
    name: loc.name || loc.neighborhood || undefined,
    lat, lon,
    affinity: num(c.query?.affinity) ?? 0,
    affinityRank: num(c.query?.affinity_rank),
    popularity: num(c.query?.popularity) ?? 0,
  };
}

const pack = (tool, r, results, extra = {}) => ({ tool, status: r.status === 'ok' && !results.length ? 'empty' : r.status, results, receipts: [r.receipt.id], ...(r.receipt.error ? { note: r.receipt.error } : {}), ...extra });

export function makeTools(run) {
  return {
    /** Health / readiness. One cheap live probe so the badge reflects reality, not configuration alone. */
    async capabilities() {
      if (!run.configured) return { tool: 'capabilities', status: 'degraded', results: { live: false, tools: TOOL_NAMES }, receipts: [], note: 'QLOO_API_KEY is not set; only cached or recorded data can be shown.' };
      const r = await run.call('capabilities', '/v2/tags', { 'filter.query': 'coffee', take: 1 });
      return { tool: 'capabilities', status: r.ok ? 'ok' : 'degraded', results: { live: r.ok, tools: TOOL_NAMES, http: r.receipt.http }, receipts: [r.receipt.id], ...(r.receipt.error ? { note: r.receipt.error } : {}) };
    },

    /** Resolve free text (or an ID) to Qloo entities. Ambiguity is returned for the user to confirm, never auto-picked silently. */
    async describe({ query, id, type = 'urn:entity:place', take = 6 }) {
      if (id) {
        const r = await run.call('describe', '/entities', { entity_ids: id });
        return pack('describe', r, resultArray(r.data, 'entities').map(compactEntity).filter(Boolean));
      }
      const r = await run.call('describe', '/search', { query, types: type, take });
      return pack('describe', r, resultArray(r.data, 'entities').map(compactEntity).filter(Boolean));
    },

    /** Turn the owner's vibe words into Qloo tags. */
    async find_tags({ query, take = 4 }) {
      const r = await run.call('find_tags', '/v2/tags', { 'filter.query': query, 'feature.semantic_search': true, take });
      return pack('find_tags', r, resultArray(r.data, 'tags').map(compactTag).filter(Boolean));
    },

    /** Taste DNA: the tags that over-index for the audience of these entities. */
    async entity_tags({ ids, take = 12, tagType }) {
      const r = await run.call('entity_tags', '/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': ids, ...(tagType ? { 'filter.tag.types': tagType } : {}), take });
      return pack('entity_tags', r, resultArray(r.data, 'tags').map(compactTag).filter(Boolean));
    },

    /** Aggregate age/gender skew of the audience. Aggregate only: no individuals. */
    async audience_demographics({ ids }) {
      const r = await run.call('audience_demographics', '/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': ids });
      return pack('audience_demographics', r, resultArray(r.data, 'demographics'));
    },

    /** Places (or other entities) this taste signal predicts, optionally in an area, at a price level. */
    async recommend({ signals = [], tags = [], type = 'urn:entity:place', location, point, radius, priceMin, priceMax, exclude = [], filterTags = [], take = 10, explain = false, popularityMax }) {
      const params = {
        'filter.type': type,
        'signal.interests.entities': signals,
        'signal.interests.tags': tags,
        'filter.location.query': point ? undefined : location,
        'filter.location': point ? `POINT(${point.lon} ${point.lat})` : undefined,
        'filter.location.radius': point ? radius : undefined,
        'filter.price_level.min': priceMin,
        'filter.price_level.max': priceMax,
        'filter.exclude.entities': exclude,
        'filter.tags': filterTags,
        'filter.popularity.max': popularityMax,
        'feature.explainability': explain || undefined,
        take,
      };
      const r = await run.call('recommend', '/v2/insights', params);
      return pack('recommend', r, resultArray(r.data, 'entities').map(compactEntity).filter(Boolean), explain && r.data?.query?.explainability ? { explainability: r.data.query.explainability } : {});
    },

    /** Heatmap of where this taste lives inside a city. */
    async where_popular({ signals = [], tags = [], location, boundary, take = 60 }) {
      const r = await run.call('where_popular', '/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': signals, 'signal.interests.tags': tags, 'filter.location.query': location, 'output.heatmap.boundary': boundary, take });
      const cells = resultArray(r.data, 'heatmap').map(compactCell).filter(Boolean).sort((a, b) => b.affinity - a.affinity);
      return pack('where_popular', r, cells, { boundary: boundary || 'geohashes' });
    },

    /** Two audiences side by side: which tags they share and where they differ. */
    async compare_audiences({ a, b, take = 20 }) {
      const r = await run.call('compare_audiences', '/v2/analysis/compare', { 'a.signal.interests.entities': a, 'b.signal.interests.entities': b, take });
      const rows = [];
      const walk = v => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          if ((v.tag_id || v.id) && v.name) rows.push(v); else Object.values(v).forEach(walk);
        }
      };
      walk(r.data?.results);
      const tags = rows.slice(0, take).map(t => ({ id: t.tag_id || t.id, name: String(t.name).slice(0, 80), a: num(t.query?.a?.affinity ?? t.a?.affinity), b: num(t.query?.b?.affinity ?? t.b?.affinity), score: num(t.query?.affinity ?? t.query?.score ?? t.score) }));
      return pack('compare_audiences', r, tags);
    },

    /** Order a fixed set of options for a taste signal. */
    async rank({ options, signals = [], type = 'urn:entity:place' }) {
      const r = await run.call('rank', '/v2/insights', { 'filter.type': type, 'filter.results.entities': options, 'signal.interests.entities': signals, take: Math.min(50, options.length) });
      return pack('rank', r, resultArray(r.data, 'entities').map(compactEntity).filter(Boolean));
    },

    /** Is this entity rising or fading? */
    async trends({ id, type = 'urn:entity:place', days = 180 }) {
      const end = new Date();
      const start = new Date(end.getTime() - days * 864e5);
      const r = await run.call('trends', '/v2/trending', { 'filter.type': type, 'signal.interests.entities': id, 'filter.start_date': start.toISOString().slice(0, 10), 'filter.end_date': end.toISOString().slice(0, 10), take: 30 });
      const points = resultArray(r.data, 'trending');
      return pack('trends', r, points, { direction: trendDirection(points) });
    },
  };
}

/** Rising / steady / fading from whatever numeric series the trending endpoint returns. */
export function trendDirection(points) {
  const values = points.map(p => num(p?.population_percentile ?? p?.query?.population_percentile ?? p?.popularity ?? p?.value ?? p?.population_rank_velocity)).filter(v => v !== undefined);
  if (values.length < 4) return 'unknown';
  const half = Math.floor(values.length / 2);
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const first = mean(values.slice(0, half)), last = mean(values.slice(half));
  const change = (last - first) / (Math.abs(first) || 1);
  return change > 0.05 ? 'rising' : change < -0.05 ? 'fading' : 'steady';
}

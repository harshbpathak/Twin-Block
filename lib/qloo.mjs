// Server-only Qloo client. Never import into a browser bundle.
// Every call goes through one run: it is cached, counted against a budget and written to a ledger (receipts).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const STATUSES = ['ok', 'empty', 'needs_input', 'partial', 'degraded', 'error'];
export const DEFAULT_BASE_URL = 'https://hackathon.api.qloo.com';
const ENDPOINTS = new Set(['/search', '/entities', '/v2/insights', '/v2/tags', '/v2/analysis/compare', '/v2/trending']);
const PARAM = /^(?:(?:a|b)\.)?(?:filter|signal|operator|feature|output|bias|diversify)\.[a-z_.]+$|^(?:take|page|query|types|entity_ids|sort_by)$/;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_DIR = new URL('../.cache/qloo/', import.meta.url);
const memory = new Map();

export function resultArray(data, key) {
  const r = data?.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r[key])) return r[key];
  if (Array.isArray(data?.[key])) return data[key];
  return [];
}

export function normalizeParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Qloo parameters must be an object.');
  const out = {};
  for (const [key, raw] of Object.entries(params)) {
    if (!PARAM.test(key)) throw new Error(`Unsupported Qloo parameter: ${key}`);
    if (raw === undefined || raw === null || raw === '') continue;
    let value = raw;
    if (Array.isArray(raw)) {
      if (!raw.length) continue;
      if (raw.some(v => typeof v !== 'string' && typeof v !== 'number')) throw new Error(`Invalid list for ${key}`);
      value = raw.join(',');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Invalid value for ${key}`);
    value = String(value);
    if (value.length > 8000 || /[\x00-\x1f]/.test(value)) throw new Error(`Value too long or invalid for ${key}`);
    out[key] = value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function cacheKey(endpoint, params) {
  return createHash('sha256').update(endpoint + '?' + JSON.stringify(params)).digest('hex').slice(0, 32);
}

function countResults(data) {
  const r = data?.results;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') return Object.values(r).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  return 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One "run" = one user request. Holds the call budget and the receipts ledger.
 * call() never throws for upstream problems: it returns { ok, status, data, receipt }.
 */
export function createRun({
  budget = Number(process.env.QLOO_CALL_BUDGET) || 40,
  apiKey = process.env.QLOO_API_KEY,
  baseUrl = process.env.QLOO_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  diskCache = process.env.QLOO_DISK_CACHE !== 'off',
  timeoutMs = 15000,
  retryDelayMs = 700,
  simulated = false,
} = {}) {
  const ledger = [];
  let used = 0;
  const run = {
    ledger,
    budget,
    get used() { return used; },
    get remaining() { return Math.max(0, budget - used); },
    configured: Boolean(apiKey),
    simulated,
    async call(tool, endpoint, params) {
      if (!ENDPOINTS.has(endpoint)) throw new Error(`Unsupported Qloo endpoint: ${endpoint}`);
      const query = normalizeParams(params);
      const key = cacheKey(endpoint, query);
      const receipt = { id: `Q${ledger.length + 1}`, tool, endpoint, params: query, status: 'ok', cache: 'miss', ms: 0, count: 0, at: new Date().toISOString(), ...(simulated ? { simulated: true } : {}) };
      ledger.push(receipt);
      const done = (status, data, extra = {}) => {
        Object.assign(receipt, { status }, extra);
        return { ok: status === 'ok' || status === 'empty', status, data, receipt };
      };

      const hit = memory.get(key);
      if (hit && hit.expires > Date.now()) {
        receipt.count = countResults(hit.data);
        return done(receipt.count ? 'ok' : 'empty', hit.data, { cache: 'memory' });
      }
      if (diskCache) {
        try {
          const saved = JSON.parse(await readFile(new URL(`${key}.json`, CACHE_DIR), 'utf8'));
          memory.set(key, { data: saved.data, expires: Date.now() + CACHE_TTL_MS });
          receipt.count = countResults(saved.data);
          return done(receipt.count ? 'ok' : 'empty', saved.data, { cache: 'disk', recordedAt: saved.at });
        } catch { /* not cached */ }
      }
      if (!apiKey) return done('error', null, { error: 'Live Qloo access is not configured (QLOO_API_KEY).' });
      if (used >= budget) return done('partial', null, { error: `Call budget of ${budget} reached; step skipped.` });
      used++;

      const url = new URL(endpoint, baseUrl.replace(/\/+$/, '') + '/');
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const started = performance.now();
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
          receipt.http = res.status;
          if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(retryDelayMs); continue; }
          if (!res.ok) {
            let detail = '';
            try { const body = await res.json(); detail = String(body?.error?.message || body?.message || '').slice(0, 200); } catch { /* ignore */ }
            return done('error', null, { ms: Math.round(performance.now() - started), error: `Qloo HTTP ${res.status}${detail ? `: ${detail}` : ''}` });
          }
          const text = await res.text();
          if (text.length > 5_000_000) return done('error', null, { error: 'Qloo response exceeded size limit.' });
          const data = JSON.parse(text);
          receipt.count = countResults(data);
          if (Array.isArray(data?.warnings) && data.warnings.length) receipt.warnings = data.warnings.slice(0, 3).map(w => String(w?.message || w).slice(0, 160));
          memory.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
          if (diskCache) {
            mkdir(CACHE_DIR, { recursive: true }).then(() => writeFile(new URL(`${key}.json`, CACHE_DIR), JSON.stringify({ at: receipt.at, endpoint, params: query, data }))).catch(() => {});
          }
          return done(receipt.count ? 'ok' : 'empty', data, { ms: Math.round(performance.now() - started) });
        } catch (error) {
          if (attempt === 0 && !controller.signal.aborted) { await sleep(retryDelayMs); continue; }
          return done('error', null, { ms: Math.round(performance.now() - started), error: controller.signal.aborted ? 'Qloo timed out.' : 'Qloo could not be reached.' });
        } finally { clearTimeout(timer); }
      }
      return done('error', null, { error: 'Qloo request failed after retry.' });
    },
  };
  return run;
}

export function clearMemoryCache() { memory.clear(); }
export function memoryCacheSize() { return memory.size; }

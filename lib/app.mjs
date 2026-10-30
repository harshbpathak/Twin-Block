// Twin Block HTTP app: static UI + JSON API. The Qloo key stays on the server, never in the browser.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRun, memoryCacheSize } from './qloo.mjs';
import { makeTools } from './tools.mjs';
import { runTwin } from './twin.mjs';
import { proveChain } from './prove.mjs';
import { InputError } from './pii.mjs';

const ROOT = new URL('../dist/', import.meta.url);
const DATA = new URL('../data/', import.meta.url);
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'",
};

const hits = new Map();
function limited(ip, max) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

async function readBody(req, max = 8192) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new InputError('body', 'Request too large.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new InputError('body', 'Invalid JSON.'); }
}

const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY }); res.end(JSON.stringify(data)); };

function stream(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...SECURITY });
  return obj => res.write(JSON.stringify(obj) + '\n');
}

async function readData(name) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return null; }
}

let health = { at: 0, value: null };
async function getHealth() {
  if (Date.now() - health.at < 60000 && health.value) return health.value;
  const run = createRun({ budget: 1, diskCache: false });
  const cap = await makeTools(run).capabilities();
  health = { at: Date.now(), value: { ...cap, cacheEntries: memoryCacheSize(), llmBaseline: Boolean(process.env.OPENAI_API_KEY), checkedAt: new Date().toISOString() } };
  return health.value;
}

export function createServer({ budget = Number(process.env.QLOO_CALL_BUDGET) || 40 } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    try {
      if (url.pathname.startsWith('/api/')) {
        if (limited(ip, url.pathname === '/api/health' ? 60 : 20)) return json(res, 429, { status: 'error', message: 'Too many requests. Wait a minute.' });
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, await getHealth());
        if (req.method === 'GET' && url.pathname === '/api/presets') return json(res, 200, (await readData('presets.json')) || []);
        if (req.method === 'GET' && url.pathname.startsWith('/api/recorded/')) {
          const id = url.pathname.split('/').pop();
          if (!/^[a-z0-9-]{1,40}$/.test(id)) return json(res, 400, { status: 'error', message: 'Bad preset id.' });
          const rec = await readData(`recorded/${id}.json`);
          return rec ? json(res, 200, rec) : json(res, 404, { status: 'empty', message: 'No recording for this preset yet.' });
        }
        if (req.method === 'GET' && url.pathname === '/api/backtest') {
          return json(res, 200, (await readData('backtest-results.json')) || { status: 'not_run', message: 'No live backtest has been run yet. Run `npm run prove` with QLOO_API_KEY set.' });
        }
        if (req.method === 'POST' && url.pathname === '/api/twin') {
          const input = await readBody(req);
          const send = stream(res);
          const run = createRun({ budget });
          try {
            const result = await runTwin(input, { run, onStep: s => send({ type: 'step', ...s }) });
            send({ type: 'result', ...result });
          } catch (e) {
            send({ type: 'result', status: e instanceof InputError ? 'needs_input' : 'error', field: e.field, message: e instanceof InputError ? e.message : 'Something went wrong on our side.', ledger: run.ledger });
            if (!(e instanceof InputError)) console.error(e);
          }
          return res.end();
        }
        if (req.method === 'POST' && url.pathname === '/api/backtest/run') {
          const input = await readBody(req);
          const send = stream(res);
          const run = createRun({ budget: 15 });
          try {
            send({ type: 'result', ...(await proveChain(input, { run, onStep: s => send({ type: 'step', ...s }) })) });
          } catch (e) {
            send({ type: 'result', status: e instanceof InputError ? 'needs_input' : 'error', message: e instanceof InputError ? e.message : 'Backtest failed.', ledger: run.ledger });
            if (!(e instanceof InputError)) console.error(e);
          }
          return res.end();
        }
        return json(res, 404, { status: 'error', message: 'Unknown API route.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY); return res.end(); }
      const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (name.includes('..') || name.includes('\\') || name.startsWith('/') || name.includes(':')) { res.writeHead(404, SECURITY); return res.end('Not found'); }
      const file = await readFile(new URL(name, ROOT));
      res.writeHead(200, { 'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
      res.end(req.method === 'HEAD' ? undefined : file);
    } catch (e) {
      if (e instanceof InputError) return json(res, 400, { status: 'needs_input', field: e.field, message: e.message });
      if (e.code === 'ENOENT' || e.code === 'EISDIR') { res.writeHead(404, SECURITY); return res.end('Not found'); }
      console.error(e);
      if (!res.headersSent) json(res, 500, { status: 'error', message: 'Server error.' }); else res.end();
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

delete process.env.QLOO_API_KEY;
process.env.QLOO_DISK_CACHE = 'off';
const { createServer } = await import('../lib/app.mjs');

let base, server;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('serves the UI with security headers', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await r.text(), /Twin Block/);
});

test('blocks path traversal', async () => {
  for (const p of ['/..%2fserver.mjs', '/%2e%2e/package.json', '/..\\server.mjs']) assert.equal((await fetch(base + p)).status, 404, p);
});

test('health reports missing key honestly', async () => {
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.status, 'degraded');
  assert.equal(h.results.live, false);
});

test('twin endpoint rejects personal data before any Qloo call', async () => {
  const res = await fetch(base + '/api/twin', { method: 'POST', body: JSON.stringify({ shop: 'joe@example.com', homeCity: 'Austin', targetCity: 'Denver' }) });
  const lines = (await res.text()).trim().split('\n').map(l => JSON.parse(l));
  const result = lines.at(-1);
  assert.equal(result.status, 'needs_input');
  assert.equal(result.ledger.length, 0);
});

test('presets and backtest endpoints respond', async () => {
  const presets = await (await fetch(base + '/api/presets')).json();
  assert.ok(presets.length >= 4);
  const bt = await (await fetch(base + '/api/backtest')).json();
  assert.ok(['ok', 'not_run'].includes(bt.status));
  assert.equal((await fetch(base + '/api/recorded/../x')).status, 404);
});

test('accessibility basics: every form control has a label, page has lang', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en">/);
  const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 8);
  for (const id of ids) assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
  assert.ok(!/<img(?![^>]*alt=)/.test(html), 'images need alt');
});

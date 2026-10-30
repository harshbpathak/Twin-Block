import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mockFetch } from './mock-qloo.mjs';

test('MCP server lists tools and answers twin_block_find with cited areas', async () => {
  const fake = mockFetch();
  const qloo = http.createServer(async (req, res) => { const r = await fake(new URL(req.url, 'http://x')); res.writeHead(r.status); res.end(await r.text()); });
  await new Promise(r => qloo.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, ['scripts/mcp.mjs'], { env: { ...process.env, QLOO_API_KEY: 'k', QLOO_BASE_URL: `http://127.0.0.1:${qloo.address().port}`, QLOO_DISK_CACHE: 'off', OPENAI_API_KEY: '' } });
  const replies = new Map();
  let buf = '';
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); } });
  const ask = (id, method, params) => { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return new Promise(r => { const t = setInterval(() => { if (replies.has(id)) { clearInterval(t); r(replies.get(id)); } }, 20); }); };
  try {
    assert.equal((await ask(1, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'twin-block');
    assert.deepEqual((await ask(2, 'tools/list')).result.tools.map(t => t.name), ['twin_block_find', 'twin_block_prove']);
    const r = await ask(3, 'tools/call', { name: 'twin_block_find', arguments: { shop: 'Veracruz All Natural', homeCity: 'Austin', targetCity: 'Denver' } });
    const out = JSON.parse(r.result.content[0].text);
    assert.equal(out.status, 'ok');
    assert.equal(out.areas.length, 3);
    assert.ok(out.areas[0].receipts.length > 0);
  } finally { child.kill(); qloo.close(); }
});

// Twin Block as an MCP server (stdio, JSON-RPC 2.0, newline-delimited). Zero dependencies.
// Lets any MCP agent (Claude, Codex, Cursor...) ask "where should this shop open next?" and get cited answers.
// Usage: QLOO_API_KEY=... node scripts/mcp.mjs     (or: npm run mcp)
import { createInterface } from 'node:readline';
import { createRun } from '../lib/qloo.mjs';
import { runTwin } from '../lib/twin.mjs';
import { proveChain } from '../lib/prove.mjs';

const TOOLS = [
  {
    name: 'twin_block_find',
    description: 'Given a shop that works in one city, find the top 3 areas in a target city where the same crowd lives (Qloo taste graph). Returns scores with formulas, anchor neighbours, price fit, crowding, trends, receipts and disclosures. Leave targetCity empty to get suggested cities instead. Never pass personal data.',
    inputSchema: { type: 'object', properties: { shop: { type: 'string' }, homeCity: { type: 'string' }, targetCity: { type: 'string' }, price: { type: 'integer', minimum: 1, maximum: 4 }, vibes: { type: 'string' }, weight: { type: 'number', minimum: 0, maximum: 100 }, entityId: { type: 'string', description: 'Qloo entity ID, if the shop name was ambiguous' } }, required: ['homeCity'] },
  },
  {
    name: 'twin_block_prove',
    description: 'Live backtest: hide a chain\'s stores in a test city and predict them from the taste of places near its stores in a training city (brand excluded). Returns Precision@5 vs busy-area and random baselines.',
    inputSchema: { type: 'object', properties: { brand: { type: 'string' }, train: { type: 'string' }, test: { type: 'string' } }, required: ['brand', 'train', 'test'] },
  },
];

function compact(r) {
  if (r.status === 'needs_input') return { status: r.status, message: r.message, candidates: r.candidates, cities: r.cities?.map(c => c.name) };
  if (!r.areas) return { status: r.status, message: r.message };
  return {
    status: r.status, shop: r.shop.name, targetCity: r.input.targetCity,
    note: r.note.map(n => n.text),
    areas: r.areas.map(a => ({ name: a.name, score: a.score, formula: a.formula, tastePct: a.cell.tastePct, sameCategoryWithin800m: a.sameCategoryCount, priceFit: a.priceFit.note, anchors: a.anchors.map(x => x.name), trend: a.trend.direction, receipts: [...new Set(a.receipts)] })),
    stable: r.stability.stable, busiestOverlap: r.withoutQloo.overlap, disclosures: r.disclosures,
    qlooCalls: r.ledger.length,
  };
}

async function call(name, args) {
  const run = createRun();
  if (name === 'twin_block_find') return compact(await runTwin(args, { run }));
  if (name === 'twin_block_prove') { const { ledger, ...r } = await proveChain(args, { run }); return r; }
  throw new Error(`Unknown tool ${name}`);
}

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
createInterface({ input: process.stdin }).on('line', async line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'twin-block', version: '1.0.0' } } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try {
        const out = await call(params.name, params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError: out.status === 'error' } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
});
console.error(`Twin Block MCP ready · Qloo key ${process.env.QLOO_API_KEY ? 'configured' : 'NOT configured'}`);

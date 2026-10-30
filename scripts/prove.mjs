// Runs the live "Prove it" backtest for every chain in data/chains.json and writes data/backtest-results.json.
// Usage: QLOO_API_KEY=... npm run prove      (optional OPENAI_API_KEY adds the LLM-only baseline)
import { readFile, writeFile } from 'node:fs/promises';
import { createRun } from '../lib/qloo.mjs';
import { proveChain, summarize } from '../lib/prove.mjs';

const chains = JSON.parse(await readFile(new URL('../data/chains.json', import.meta.url), 'utf8'));
const only = process.argv[2];
const results = [];
for (const chain of chains.filter(c => !only || c.brand.toLowerCase().includes(only.toLowerCase()))) {
  const run = createRun({ budget: 15 });
  if (!run.configured) { console.error('Set QLOO_API_KEY first.'); process.exit(1); }
  process.stdout.write(`${chain.brand} (${chain.train} → ${chain.test}) … `);
  try {
    const r = await proveChain(chain, { run });
    const { ledger, ...rest } = r;
    results.push({ ...rest, receipts: ledger.map(({ id, tool, endpoint, params, status, count, cache, at }) => ({ id, tool, endpoint, params, status, count, cache, at })) });
    console.log(r.status === 'ok' ? `taste P@5 ${(r.taste.precisionAtK * 100).toFixed(0)}% · busy ${(r.busy.precisionAtK * 100).toFixed(0)}% · random ${(r.random.meanPrecisionAtK * 100).toFixed(0)}%` : `${r.status}: ${r.message}`);
  } catch (e) {
    results.push({ ...chain, status: 'error', message: e.message });
    console.log(`error: ${e.message}`);
  }
}
const out = { status: 'ok', ranAt: new Date().toISOString(), method: 'Hide the chain\'s stores in the test city. Signal = taste neighbours of its training-city stores (brand and all its stores excluded). Rank test-city heatmap cells. Hit = a pick within 1 km of a hidden store. Precision@5.', summary: summarize(results), results };
await writeFile(new URL('../data/backtest-results.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('\nSummary', out.summary);

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, clearMemoryCache } from '../lib/qloo.mjs';
import { runOptions, SIM_CITIES } from '../lib/sim.mjs';
import { runTwin } from '../lib/twin.mjs';
import { proveChain } from '../lib/prove.mjs';

const simRun = (budget = 45) => { clearMemoryCache(); return createRun({ ...runOptions(), budget }); };
const REAL_NAMES = /shake shack|sputnik|hi-dive|little man|hop alley|rino|highland|lohi|five points/i;

test('simulation only when there is no key, and can be switched off', () => {
  const saved = { key: process.env.QLOO_API_KEY, sim: process.env.SIMULATION };
  try {
    delete process.env.QLOO_API_KEY; delete process.env.SIMULATION;
    assert.equal(runOptions().simulated, true);
    process.env.SIMULATION = 'off';
    assert.equal(runOptions().simulated, undefined);
    delete process.env.SIMULATION; process.env.QLOO_API_KEY = 'real';
    assert.equal(runOptions().simulated, undefined);
  } finally {
    if (saved.key === undefined) delete process.env.QLOO_API_KEY; else process.env.QLOO_API_KEY = saved.key;
    if (saved.sim === undefined) delete process.env.SIMULATION; else process.env.SIMULATION = saved.sim;
  }
});

test('simulated twin run: complete, flagged, invented names only', async () => {
  delete process.env.QLOO_API_KEY;
  const r = await runTwin({ shop: 'Corner Tacos', homeCity: 'Austin', targetCity: 'Denver', price: 2, vibes: 'late night' }, { run: simRun(), llm: async () => ({ status: 'not_run' }) });
  assert.ok(['ok', 'degraded'].includes(r.status), r.message);
  assert.equal(r.simulated, true);
  assert.equal(r.areas.length, 3);
  assert.ok(r.ledger.every(x => x.simulated));
  const text = JSON.stringify({ areas: r.areas, homeTwins: r.homeTwins, map: r.map });
  assert.ok(!REAL_NAMES.test(text), 'no real business or neighbourhood names in simulated output');
  assert.equal(r.shop.name, 'Your shop (simulated)');
  assert.ok(!JSON.stringify(r.note).includes('Corner Tacos'), 'typed business name never carries invented data');
});

test('simulated backtest runs but stores are random (no built-in advantage)', async () => {
  delete process.env.QLOO_API_KEY;
  const r = await proveChain({ brand: 'Any Chain', train: 'New York', test: 'Chicago' }, { run: simRun(15), useLLM: false });
  assert.equal(r.status, 'ok', r.message);
  assert.equal(r.simulated, true);
  assert.ok(r.hidden.every(s => s.name.startsWith('Simulated store')));
});

test('unknown city in simulation is labelled, not invented', async () => {
  delete process.env.QLOO_API_KEY;
  const r = await runTwin({ shop: 'Corner Tacos', homeCity: 'Austin', targetCity: 'Atlantis' }, { run: simRun(), llm: async () => ({ status: 'not_run' }) });
  assert.notEqual(r.status, 'ok');
  assert.equal(r.areas, undefined);
  assert.ok(Object.keys(SIM_CITIES).length >= 20);
});

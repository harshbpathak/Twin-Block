// Records each preset's full live result to data/recorded/<id>.json so the demo still works if the API is down.
// Recordings are labelled with their date in the UI. Usage: QLOO_API_KEY=... npm run record
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRun } from '../lib/qloo.mjs';
import { runTwin } from '../lib/twin.mjs';

const presets = JSON.parse(await readFile(new URL('../data/presets.json', import.meta.url), 'utf8'));
await mkdir(new URL('../data/recorded/', import.meta.url), { recursive: true });
for (const p of presets) {
  const run = createRun({ budget: 45 });
  if (!run.configured) { console.error('Set QLOO_API_KEY first.'); process.exit(1); }
  let r = await runTwin(p, { run });
  if (r.status === 'needs_input' && r.candidates?.length) {
    console.log(`${p.id}: picked "${r.candidates[0].name}" (${r.candidates[0].address || 'no address'}) — set entityId in presets.json to pin it`);
    r = await runTwin({ ...p, entityId: r.candidates[0].id }, { run });
  }
  console.log(`${p.id}: ${r.status} · ${run.used} calls · ${r.areas?.map(a => a.name).join(', ') || r.message}`);
  if (r.areas?.length) await writeFile(new URL(`../data/recorded/${p.id}.json`, import.meta.url), JSON.stringify({ ...r, recorded: true, recordedAt: new Date().toISOString() }));
}

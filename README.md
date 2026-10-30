# Twin Block

**Your shop works in one city. Twin Block finds where the same crowd lives in the next one, and proves the method on real chain stores.**

Built for the Qloo Agentic Hackathon. MIT licensed. No npm dependencies (Node 20+).

## What it does

1. **You type the shop that works**: "Veracruz All Natural, Austin". Then the next city ("Denver"), your price level and optional vibe words.
2. **The agent reads your crowd on Qloo**: taste DNA tags, the age and gender skew of the audience, and the places in your home city that share that crowd.
3. **It maps where that taste lives in the next city**: a neighbourhood-level Qloo heatmap.
4. **It checks the top 3 areas**: three anchor neighbours each, price fit against nearby places, crowding (same-category places within 800 m), shared taste between your crowd and the area, and whether the area is rising or fading.
5. **You get a one-page Lease Brief** for each area, with evidence chips, a visible scoring formula, what to check before signing, and what the data does *not* establish.
6. **Without Qloo panel**: what "just go where it's busy" (and, optionally, a plain LLM) would have picked instead. A map toggle recolours the same map by busy-ness alone, so you can see the difference.

More:
- **City finder**: leave the next city blank and Qloo ranks the localities where your crowd over-indexes. Click one to map it.
- **Gap finder**: the agent checks whether the best area already serves what your crowd loves. If few places nearby do, it flags an opening.
- **Agent's note**: a plain-English summary where every sentence cites its receipts.
- **Stability check**: does the #1 pick survive at 30%, 50%, 70% and 90% taste weight? The pick is labelled "Stable" or "Exploratory".
- **Adaptive agent**: when a filter empties the results (vibe words, price level, neighbourhood boundaries), the agent relaxes it and says so in the trace, then labels the result "reduced confidence".
- **Visit plan**: a half-day scouting route with map links and what to look for. **Landlord pitch**: a first email to a leasing agent, built only from the evidence.
- **Shareable links**: the URL re-runs the search. **Saved blocks** are kept in your browser. Receipts can be downloaded as JSON.
- **MCP server** (`npm run mcp`) exposes `twin_block_find` and `twin_block_prove` to any MCP agent (Claude, Codex, Cursor).

### Prove it: a non-circular real-store backtest

We take a real chain (Shake Shack, Sweetgreen, Blue Bottle and others) and **hide all its stores in a test city**. Twin Block builds a taste signal from the places *near the chain's stores in a different city*. The brand itself and all of its stores are excluded, and the test enforces this. It then ranks the test city's heatmap cells. A pick is a hit if it is within 1 km of a real hidden store.

Each chain is scored with Precision@5 against three baselines:

- **Busy-area (popularity only)**: heatmap popularity with no taste signal.
- **Random**: 500 seeded random draws.
- **Plain LLM (optional)**: reported as an upper bound, since LLMs have memorised store locations.

Results are precomputed with `npm run prove`. You can also run one chain live in the **Prove it** tab.

## How it uses Qloo

All 10 Qloo workflow tools ([lib/tools.mjs](lib/tools.mjs)), each doing real work:

| Tool | Twin Block job |
|---|---|
| `capabilities` | Health badge with a live probe (not just "is the key set") |
| `describe` | Resolve the shop; ambiguous matches go to confirm cards, never auto-picked |
| `find_tags` | Owner's vibe words → Qloo tags, added to the heatmap signal |
| `entity_tags` | Taste DNA of the shop's crowd |
| `audience_demographics` | Aggregate age/gender skew |
| `recommend` | Home-city taste neighbours; anchor neighbours per area (with `filter.price_level`, `feature.explainability`); same-category crowding (`filter.tags` + radius) |
| `where_popular` | Target-city heatmap, `output.heatmap.boundary=neighborhood` with geohash fallback |
| `compare_audiences` | Home crowd vs. each area's places → shared taste |
| `rank` | Rank every anchor against the home crowd (`filter.results.entities`) |
| `trends` | Is the area's lead anchor rising or fading? (`/v2/trending`) |

The backtest also uses `filter.references_brand` to get real store lists and `filter.exclude.entities` to keep the brand out of the signal.

## Engineering

- **Key stays server-side.** The browser never sees it. Parameter and endpoint allowlist, redirects refused, 15 s timeout, one retry on 429/5xx.
- **Cache**: in memory plus on disk, keyed by a hash of endpoint and parameters. Cache hits are free and labelled in receipts.
- **Call budget per run** (default 40). Steps past the budget are labelled `partial`, never silently dropped.
- **Receipts**: every call is logged with tool, endpoint, exact params (never the key), status, result count, cache and ms. Shown in the Receipts tab, and every evidence chip cites its receipt IDs.
- **Personal-data guard** on every typed field before any Qloo call. It blocks emails, phones, card/ID numbers, handles and "my name is…".
- **Status labels everywhere**: `ok`, `empty` (no Qloo signal), `needs_input`, `partial`, `degraded` (reduced confidence), `error`. Missing data is shown as missing, never invented.
- **Streaming agent steps** (NDJSON) so you see each tool call happen.
- **Recorded fallback**: `npm run record` saves each preset's live run; if Qloo is down, presets load the recording, clearly labelled with its date.
- **Tests**: `npm test` runs 35 tests against a mock Qloo. They cover the PII guard, cache, budget, error labels, all 10 tools, the end-to-end pipeline, the ambiguous-shop flow, heatmap failure, the city finder, the gap finder, adaptive decisions, scoring, the backtest leakage guard, the MCP server, server security headers, path traversal and basic accessibility checks.
- Security headers and a CSP. Basic rate limiting.

## Simulation mode (no Qloo key yet)

If `QLOO_API_KEY` is not set, the app runs in **simulation mode** so the full workflow can still be clicked through:

- A banner on every screen, a "SIMULATED · NOT QLOO DATA" chip on results, a watermark on the map, and a warning in every Lease Brief, Visit plan and Landlord pitch.
- All places and neighbourhoods have invented names. The typed shop is shown as "Your shop (simulated)", so a real business is never shown with made-up data.
- Simulated backtest stores are placed **uniformly at random**, so simulated backtest numbers carry no signal. They are never added to the results table.
- Setting `QLOO_API_KEY` switches to live Qloo automatically, with no code change. `SIMULATION=off` disables simulation entirely.

The simulator is in [lib/sim.mjs](lib/sim.mjs). Tests check that it is fully flagged and never uses real business names.

## Run it

```bash
cp .env.example .env      # add QLOO_API_KEY
npm run spike             # 2-minute check that the Qloo features we rely on work on your key
npm run dev               # http://127.0.0.1:4173
npm test
npm run prove             # live backtest for data/chains.json -> data/backtest-results.json
npm run record            # record presets for the offline fallback
npm run mcp               # Twin Block as an MCP tool server (stdio)

# No key yet? Click through the UI against a fake local Qloo (dev only, not real data):
npm run dev:mock &        # fake Qloo on :4999
QLOO_API_KEY=dev QLOO_BASE_URL=http://127.0.0.1:4999 npm start
```

## Deploy

- **Render**: New → Blueprint → pick this repo. `render.yaml` is included. Paste `QLOO_API_KEY` when asked. The health check is `/api/health`.
- **Cloud Run / Fly**: a `Dockerfile` is included. It listens on `$PORT`.

## What this does NOT establish

Qloo affinity is cultural taste overlap. It is not foot traffic, revenue, rent or a sales forecast. Area scores are our calculation from Qloo fields, and the formula is printed on every card. Backtest hits measure resemblance to where operators chose to open, not whether those stores are profitable. Chains are survivors. Before signing a lease: check units, rent and permitted use, count real competitors, and walk the block at your peak hour.

## Layout

```
server.mjs          entry point (PORT, HOST)
lib/app.mjs         HTTP routes + static files
lib/qloo.mjs        Qloo client: cache, budget, receipts, status labels
lib/tools.mjs       the 10 Qloo tools
lib/twin.mjs        the Twin Block agent pipeline + scoring
lib/prove.mjs       live real-store backtest
lib/pii.mjs         personal-data guard
lib/llm.mjs         optional plain-LLM baseline
backtest.mjs        spatial backtest engine (shared with the browser via dist/backtest.mjs)
dist/               UI (vanilla JS + Leaflet)
data/               presets, chains, recorded runs, backtest results
scripts/            spike, prove, record
test/               node:test suites + mock Qloo
```

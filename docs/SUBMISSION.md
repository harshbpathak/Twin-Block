# Twin Block: Devpost submission text

> Paste each section into Devpost. Fill in the two `[[ ]]` placeholders after running `npm run prove` with a live key. Never paste numbers you haven't run.

## Tagline
Your shop works in one city. Twin Block finds where the same crowd lives in the next one, and proves it on real chain stores.

## Inspiration
When a big chain expands, it pays analysts and buys foot-traffic data. When a taqueria owner in Austin wants a second location in Denver, they drive around and guess. The thing they actually know is *who their regulars are*. Qloo's taste graph lets us turn that crowd into a map.

## What it does
1. **Start from a shop that works.** Type its name and city, then the next city. Add a price level and vibe words if you like. Leave the next city blank and Twin Block ranks the places where your crowd over-indexes.
2. **The agent reads your crowd** on Qloo: taste DNA, age skew, and the places back home that share your customers.
3. **It maps the new city.** A neighbourhood heatmap shows where that taste lives.
4. **It checks every shortlisted block:**
   - three anchor neighbours, ranked for your crowd
   - price fit
   - how many places in your category are within 800 m (crowding)
   - shared taste between your crowd and the area's crowd
   - whether the area is rising or fading
5. **You get, for each area:**
   - a one-page **Lease Brief**
   - a **Visit plan** with map links for a half-day scouting trip
   - a **Landlord pitch** email
   - a "Without Qloo" panel showing what "just go where it's busy" would have picked instead

Every claim carries a receipt ID that links to the exact Qloo call. A stability check tells you whether the #1 pick survives different weightings.

### Prove it
We don't ask anyone to trust a heatmap:
- **Hide.** We take a real chain and hide all of its stores in one city.
- **Predict.** Twin Block predicts where those stores are, using only the taste of places near the chain's stores in a *different* city. The brand and its stores are excluded, and a test enforces it.
- **Score.** We reveal the real stores and score Precision@5 against busy-area, random and plain-LLM baselines.

**Result:** across [[N]] chains, taste-based picks hit hidden stores [[X%]] of the time, versus [[Y%]] for "go where it's busy" and [[Z%]] for random.

## How we built it
- **All 10 Qloo workflow tools, each with a real job:**
  - `describe` resolves the shop, with confirm cards when the name is ambiguous.
  - `find_tags` turns vibe words into tags.
  - `entity_tags` builds the taste DNA.
  - `audience_demographics` gives the age skew.
  - `recommend` finds home twins, anchors (with price-level filters and explainability) and crowding counts.
  - `where_popular` draws the neighbourhood heatmap.
  - `compare_audiences` measures shared taste.
  - `rank` orders the anchors for your crowd.
  - `trends` shows momentum.
  - `capabilities` drives a live health badge.
- **Deeper Insights API parameters:** `filter.references_brand` for real store lists, `filter.exclude.entities` to keep the brand out of its own backtest, `urn:entity:locality` for the city finder, and `output.heatmap.boundary=neighborhood` with a geohash fallback.
- **Engineering:**
  - The API key stays on the server, behind a parameter allowlist.
  - Cache, and a 40-call budget per run.
  - A receipts ledger with every parameter of every call.
  - A personal-data guard that runs before any call.
  - Six explicit status labels (ok, empty, needs_input, partial, degraded, error). Missing data is shown as missing, never invented.
  - Agent steps stream live to the browser.
  - A date-labelled recorded fallback if Qloo is down.
- **An MCP server** (`npm run mcp`), so Claude, Codex or Cursor can call Twin Block as a tool.
- **Zero npm dependencies:** Node 20+, vanilla JS and Leaflet. 28 automated tests against a mock Qloo, covering the leakage guard, the personal-data guard, budget, cache, path traversal and accessibility basics.

## Challenges we ran into
- **Making the backtest non-circular.** If you signal with a chain's own stores, of course you find its other stores. We signal only with *neighbouring* places, strip anything brand-linked, and assert it in tests.
- **Honest numbers.** A Qloo affinity is not foot traffic or revenue. Every score shows its formula, and every result says what it does not establish.

## Accomplishments we're proud of
- **A live, reproducible real-world test** of whether cultural taste predicts where successful operators choose to open.
- **A product a non-technical owner can use in two minutes**, with outputs they would actually send to a broker.

## What we learned
Busy and right-for-you are different maps. The "Without Qloo" panel makes that visible on almost every run.

## What's next
- Pair taste with rent and vacancy feeds.
- Time-held-out backtests using opening dates.
- A broker mode that scores available listings directly.

## Built with
Qloo Insights API · Node.js · JavaScript · Leaflet · OpenStreetMap · MCP

## Try it
- Live demo: [[your Render URL]]
- Code (MIT): https://github.com/harshbpathak/Twin-Block

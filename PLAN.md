# Twin Block — MVP and evidence plan

Research checked 30 October 2026. Working definition: help a small business compare expansion neighborhoods with the cultural signature around its existing successful location. This is an evidence-based shortlist for field research, not a revenue forecast.

## Competitive position

GeoTaste won the 2025 Qloo Grand Prize. Its public project describes broad location market analysis, competition intelligence, maps and 13+ visualizations. Twin Block should differentiate through one constrained task: compare a source catchment with candidate catchments, show what matches and differs, and explain when evidence is too weak to rank. Do not claim the underlying idea of Qloo-powered location intelligence is new.

Current competition includes TasteLaunch (taste heatmaps, competition and launch kits) and TasteTest (which chain stores should test a drink, ingredient-level heatmaps and leave-one-concept-out stability). A generic opportunity heatmap or stability badge alone will not distinguish Twin Block. Center the paired source-versus-candidate evidence view and explicit disqualifiers.

## Thirty-minute feasibility spike

1. Minutes 0–5: configure server-only Qloo credentials; resolve one source locality and three candidate localities in one city. Confirm coordinates and radius semantics. Never print credentials.
2. Minutes 5–15: probe documented location insight and heatmap requests using exactly the same tag/entity vocabulary, filters, spatial definition and candidate universe. Verify account access, response shape, result limits and useful variation. Record requests without authentication headers and small permitted response samples.
3. Minutes 15–25: derive source and candidate vectors only from comparable returned fields. Inspect missingness, local coverage and whether changing location actually changes evidence. Confirm spatial resolution supports neighborhood comparisons; a city-level signal must never be represented as block-level.
4. Minutes 25–30: go/no-go. Proceed with live neighborhood matching only if at least three candidate areas have comparable, sufficiently populated evidence and real geographic differences. Otherwise narrow to a larger geographic scale, or deliver an explicitly labelled illustrative prototype with live capability unverified.

Environment inspection found no QLOO-named environment variables. No live API validation has been performed. Credential files were not inspected.

## MVP

Inputs: source business/location, three to five candidate areas, business category and optional independently sourced constraints. One city, one business category, one fixed set of cultural dimensions. Show source profile beside each candidate; matched and divergent dimensions; evidence coverage; ranking sensitivity; reasons to investigate or reject; exportable field-visit brief.

Agent workflow: resolve locations → collect comparable evidence → validate → compute transparent similarity → investigate the largest mismatch with another supported query → produce a source-linked brief. The model writes explanations from supplied facts; it does not invent scores, local tastes, rents or competitors. An unavailable request yields an unavailable result.

Use normalized vectors only when normalization is meaningful for the actual response semantics. Report similarity as an application-defined comparison, with formula and candidate universe visible. Qloo affinity is neither market size nor conversion probability. Keep rent, footfall, competition, operating constraints and cultural similarity as separate dimensions; avoid an arbitrary all-in-one investment score.

## Validation gates

- Entity/locality gate: exact resolved IDs, geography and radius confirmed; ambiguous inputs require selection.
- API gate: server-side key, schema checks, status/error handling, bounded retries and request quota. Missing values remain unknown.
- Comparability gate: same vocabulary, spatial scale, filters and retrieval method for every area. Do not compare independently ranked top-N lists as if their absent entries were zero.
- Coverage gate: show returned count and missing dimensions. Thresholds are product choices declared before the demo, not statistically established confidence bounds.
- Geographic gate: show actual returned cells or catchment geometry; never imply street-level precision from coarse data.
- Ranking gate: perturb radius, remove one dimension and vary documented weights. Show rank changes; unstable results become exploratory rather than recommended.
- Explanation gate: every numeric or factual statement traces to a response field or independent source. Distinguish Qloo evidence, business-supplied facts, derived calculations and model interpretation.
- Demo gate: run source + three candidates end-to-end, then unknown locality, sparse data, Qloo failure and contradictory constraint. A synthetic example cannot pass the live gate.

## Provenance and honest validation

For each observation retain source URL/endpoint, query parameters without secrets, locality ID, coordinate/radius, retrieval timestamp, response version/hash where practical, transformations and live/recorded/synthetic label. Follow API data retention terms before persisting full responses. External data records need URL/provider, observation date, geographic scope and licence. Inventory counts reflect returned coverage, not necessarily all businesses.

Useful baseline: a geography-only or category-density-only shortlist and the same model without Qloo. Predeclare identical candidate areas and ask independent reviewers to rate usefulness and evidence traceability blind to method. Qloo scoring its own Qloo-derived ranking is a consistency check, not independent proof of business value.

Backtest limitations: current taste data paired with historical business outcomes leaks future information. Without timestamped pre-opening inputs and independent outcomes, do not report predictive accuracy or ROI. Survivorship, site availability, rent, marketing, execution and location selection confound results. Small hand-picked anecdotes cannot demonstrate causality. A future credible study uses time-held-out openings, predeclared metrics, geography-separated validation and independent outcome labels; include failures as well as successes.

## Build sequence

First pass feasibility spike; then build data adapter and provenance model, deterministic comparison, paired comparison screen, bounded agent investigation, failure states and hosted demo. Public repository needs setup instructions, server-only secret configuration and visible open-source licence. Test meaningful data/schema and missingness behavior; manually verify the complete published flow. Hackathon requires externally hosted usable software, not a local-only prototype.

## Sources

- Official requirements and judging: https://qloo.devpost.com/
- GeoTaste Grand Prize project: https://devpost.com/software/geotaste-your-agentic-qloo-taste-business-consultant
- Winner gallery: https://qloo-hackathon.devpost.com/project-gallery
- Current TasteLaunch: https://devpost.com/software/tastelaunch
- Current TasteTest: https://devpost.com/software/tastetest
- Official API overview: https://github.com/qloo/docs-public/blob/main/reference/api-overview.md
- Official parameter reference/deep dive: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
- Qloo locality capability descriptions: https://www.qloo.com/capabilities

Project pages describe creators’ claims; they have not been independently benchmarked or runtime-tested in this research.

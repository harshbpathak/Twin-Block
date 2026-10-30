# Qloo capability validation

This adapter is server-only. Set `QLOO_API_KEY` in the hosting provider's secret settings. No authenticated calls have been performed during authoring; documentation validation is not live verification.

Official parameter source: https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md
Entity compatibility: https://github.com/qloo/docs-public/blob/main/reference/available-parameters-by-entity-type.md

Endpoint: `GET https://hackathon.api.qloo.com/v2/insights`, header `X-Api-Key`.

1. Call `neighborhoodPlaces('Lower East Side')`. Inspect `query` for the resolved locality; fuzzy names can resolve incorrectly. Radius zero requests strict locality boundaries. Check actual response shape and pagination. Do not label top-50 samples as a census.
2. Collect returned place IDs. Call `queryInsights({'filter.type':'urn:entity:brand','signal.interests.entities':ids.join(','),'feature.explainability':true,take:20})`. Confirm category compatibility and evidence availability on this key.
3. Repeat for target area. For a shared brand candidate pool, use `filter.results.entities` and separate source/target input place IDs. Compare ranks only after checking both responses cover the same pool. Missing results are unknown, not zero demand.
4. To locate brand branches, query Places with `filter.references_brand` and target `filter.location.query`. A missing result does not prove no branch exists.
5. Price filters `filter.price_level.min/max` accept restaurant tiers 1–4. They do not establish rent, income, willingness to pay, or revenue. Hotel price range is a different property and is intentionally not enabled.
6. Explainability may be unavailable with a warning. Its normalized contribution values explain input influence, not causal market demand. Show unavailable evidence explicitly.

The adapter allows only listed parameters, caps request duration, rejects redirects, and returns generic network errors without upstream bodies or credentials. Keep the key off the client. Confirm host/API entitlement, nonempty real entities, locality resolution, brand linkage coverage, and rate limits before describing the app as live.

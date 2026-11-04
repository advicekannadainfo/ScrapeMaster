# Final bounded fragrance milestone

Decision: **NOT READY** for the stated guarantee that every automatic competitor
price represents an independently evidenced exact selected variant. Baseline
`9e4489a`; fixed machine-readable matrix: `fragrance-final-acceptance.json`.
This is the final acceptance decision, not another architecture audit or a new
product workaround. No production matcher/parser change is included.

## Fixed acceptance matrix

The matrix has eleven gates, seven offline invariants and four blocked operational
criteria. Its evidence files are existing executable regression suites, not new
copies of the same tests. Run the full offline suite once for validation. A test
passing is not automatically a release gate passing: some tests intentionally
demonstrate the current compatibility behavior that blocks the stronger milestone.

| Gate                                                     | Acceptance evidence                                                                                                                 | Status                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Own Product source                                       | Three captured Product fixtures, root identity/price/stock controls                                                                 | PASS offline                  |
| Multiple exact selected scents                           | Love Drunk/Old Money/Fresh Morning plus Quiet Garden/Cedar Trail; six directed Amazon/Flipkart/Myntra pairs, independent 30ml facts | PASS offline, synthetic pairs |
| Wrong variants                                           | Wrong scent/brand, 20/30/100ml, EDP/EDT, oil/mist, edition, pack/tester/refill/bundle                                               | PASS offline                  |
| Missing selected evidence                                | Null seller quantity and title/catalog/per-unit quantities do not become independent Product proof                                  | PASS offline                  |
| Persisted evidence                                       | BSON optional absence, malformed provenance, source drift and durable identity links                                                | PASS offline                  |
| Known price/stock and saved Product freshness            | INR/positive price, anomalies, conflicting observations, unavailable stock and ten-minute saved observations                        | PASS offline                  |
| Budget/manual/cache preservation                         | Existing no-hydration/retry, cache, manual merge and partial-failure tests                                                          | PASS offline                  |
| Every visible offer has selected Product proof           | Current listingOnly matches can still be displayed                                                                                  | BLOCKED — B1                  |
| Real Search recall                                       | No captured live Search response                                                                                                    | BLOCKED — B2                  |
| Captured same-size selected triple                       | Available Product captures are 30ml/30ml/100ml; explicit oil/pack declarations differ in completeness                               | BLOCKED — B1                  |
| Every retained price has current independent observation | Legacy/manual/search observations are incomplete; last comparison time is not last price-fetch time                                 | BLOCKED — B3                  |

Love Drunk/Old Money each showing three stores is user-confirmed live evidence.
It is preserved as such, without converting it into proof of all operational
gates or presenting synthetic transformations as additional live captures.

## Only three remaining blocker groups

**B1 — selected-variant evidence and its display policy.** Missing provider-selected
quantity/SKU/declaration evidence is a data limitation. In addition, the existing
listing compatibility path is a **fixable code eligibility gap** against this
milestone: `enrichSearchFragranceIdentity` can annotate a listing's title volume,
and `verifiedOffers` can display that listing without independent Product/SKU
proof. `fragrance-discovery-gates.test.ts` explicitly proves it is listingOnly.
Do not call it selected-SKU verification. Fail-closed display could hide those
offers, but cannot supply missing evidence or preserve their claimed exactness.
No new title-derived quantity inference or policy relaxation is implemented here.
Stop at this evidence boundary rather than silently turning compatibility results
into a release claim. An approved strict eligibility change must distinguish
unverified candidates from fresh independently evidenced Product offers; it cannot
be justified as a provider/parser schema guess.

For SKINN, the precise required input is a supported non-null netQuantity array
bound to the same selected seller/SKU/product and root offer price, or an actual
captured provider contract establishing selected-SKU-to-volume mapping. A title
claim, alternate SKU or per-unit basis cannot replace it. Name/formulation gates
must also pass; selected quantity alone does not guarantee matching. Supported
name scope remains 2–6 contiguous distinctive words with a normalized brand
prefix; one-word/reordered/non-ASCII cases are unsupported until grounded.

**B2 — Search recall.** A genuine candidate may be absent, filtered, beyond the
bounded 200-result pool or missing selected attributes. No actual Search capture
exists to distinguish these for a new click. More title normalization or a fake
fixture cannot resolve this. Keep existing bounded diagnostics and zero hydration.

**B3 — retained-price observation contract.** This is an unsupported legacy data
contract plus a **fixable code freshness gap**: not every retained offer carries
its own observation, so a comparison attempt can leave older prices displayed.
The independent saved Product route already has a ten-minute gate. That is not
universal coverage. Missing historical timestamps cannot be reconstructed safely;
a future versioned observation/expiry change needs explicit legacy behavior.
No DB backfill, guessed dates or silent expiry-policy change is performed here.

No further evidence-backed, behavior-preserving parser fix was established in
this bounded check. Do not repeatedly patch schemas or rerun discovery hoping to
manufacture selected identity. The prior confirmed code fixes remain validated.

## Fixed-budget future validation proposal

1. Free: reuse existing sanitized captures/read-only evidence diagnostics and
   existing logs. Do not click Track/Compare/refresh. If a Search response already
   exists, inspect it offline and spend zero credits.
2. Otherwise, obtain **separate approval for at most one Amazon dedicated Search
   request** for the fixed Love Drunk 30ml target. Zero retries, pagination,
   fallback, Product hydration, DB writes or notifications. Record request count,
   parsed/retained counts and bounded rejection/provenance diagnostics. Store only
   a sanitized fixture; never retain API keys or credential-bearing URLs.
3. Stop after that response whether it succeeds, fails or is insufficient. It can
   establish discovery evidence only. No extra Product call is authorized. A later
   selected Product capture requires separate approval and a new explicit budget.

GO requires all blocked criteria to be satisfied (or a clearly narrower product
claim approved). Today's recommendation remains NOT READY for the full stated
three-store automatic exact-selected-product guarantee, even with green tests.

Validation completed for this milestone: **792/792 offline tests passed**, zero
failed/skipped; formatting, ESLint, TypeScript, production build, matrix integrity
and diff checks passed. Existing suites were run once, without adding duplicate
regressions or changing production code. Paid requests and DB writes: zero.

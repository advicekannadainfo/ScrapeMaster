# Fragrance reliability completion: scoped release gates

Baseline: `ea54b46`. No provider calls, DB operations, refreshes or notifications.
Tests use the existing captured Product fixtures and explicitly synthetic selected
facts/listings. This completes the scoped code hardening, not evidence-free category
certification. Love Drunk/Old Money live three-store success remains user-reported;
neither success proves every scent/formulation/selected seller is equivalent.

## Focused journey check

1. Product adapters validate requested retailer identity, main selected seller/SKU
   where supplied, root INR price/MRP, stock and image. They emit canonical identity
   only from supported main fields. Retailer ASIN/PID/SKU is never a cross-store ID.
2. Selected volume resolver accepts Amazon main Item Volume/Package Size Name;
   Flipkart General Quantity/Net Quantity, Product Highlights Quantity and exact
   root Quantity highlights; Myntra seller-linked netQuantity after seller/SKU/price
   binding. Title, catalog, related item and per-unit quantities cannot fill missing
   Product proof. Missing evidence can remain trackable without becoming comparable.
3. Track/refresh persist canonical facts and bound price observations through their
   existing paths. Optional nulls remain absence; malformed facts reject. This task
   does not execute these services or migrate/refresh existing records.
4. Search keeps the existing coalesced cache, 200-candidate bound, no paid retries
   or Product hydration. Candidate provenance survives normalization. Listing facts
   are explicitly distinct from independently selected Product evidence.
5. The shared profile checks brand, distinctive scent, volume, explicit concentration,
   formulation, edition and pack constraints. Identity is checked before price.
   Saved-product reuse needs independently validated identities and ≤10-minute
   URL/identity/price/currency/stock-bound observations. Durable associations have
   no price and survive stale observations. Render verification repeats the gates.

## Confirmed code bugs fixed

- **Evidence downgrade:** listing enrichment overwrote existing canonical Product
  evidence. Reproduced with captured Amazon oil/pack declarations being replaced
  by shorter title claims, allowing an unconfirmed counterpart. Existing valid,
  partial or malformed canonical evidence is now preserved, never reinterpreted
  as fresh Search-title proof.
- **Persisted descriptor provenance:** concentration/formulation/edition slots
  accepted unrelated otherwise-allowlisted fields and unsupported scalar values.
  Enforce slot-specific fields, scope and contextual vocabulary, including supported
  negation markers and main-title line scope. Null remains unknown; no evidence is
  invented. Diagnostics expose bounded codes/paths only.
- **Contradiction priority:** a one-sided earlier attribute could return insufficient
  before a later explicit formulation/edition/negation mismatch was examined.
  All explicit contradictions take priority; missing facts still cannot verify.
- **Unknown stock coercion:** observeProduct's runtime `!undefined` could create an
  in-stock observation. Non-boolean stock now produces no observation.
- **Present observation ignored:** a non-saved-tagged competitor could pass identity
  while carrying a conflicting Product observation (price, URL, identity key,
  currency, future time or explicit out-of-stock). Such observations now reject
  before display; tracking the customer's own source stays separate. Diagnostics
  distinguish observation conflicts from identity and stock failures.

No parser requirements are relaxed. No fragrance names, prices or aliases are
whitelisted. No new API calls, budgets, retries, fallback or cooldown behavior.

## Offline release matrix and objective signoff

PASS means the named offline invariant passed, not that all live provider data is
available. BLOCKED means the release criterion lacks evidence or implementation;
passing synthetic cases never removes that blocker.

| Gate                                         | Offline evidence / required criterion                                                                                                                | Status  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Requested source identity and price          | Existing three captured Product fixtures; wrong ID/seller/SKU/price controls                                                                         | PASS    |
| Selected volume provenance                   | Supported main fields; null/title/catalog/per-unit proof rejected                                                                                    | PASS    |
| Multiple scents/store naming                 | Existing Love Drunk/Old Money/Fresh Morning matrix plus synthetic Quiet Garden/Cedar Trail; symmetric same-size checks                               | PASS    |
| Wrong variants and declarations              | 20/30/100ml; EDP/EDT, oil/mist, editions, packs/testers/refills/bundles rejected or insufficient; comparative EDx marketing creates no concentration | PASS    |
| Evidence preservation and storage            | Captured oil/pack survives enrichment; malformed slot provenance rejected; BSON/null/future/stale controls                                           | PASS    |
| Saved associations and price safety          | Fresh bound records reusable; stale price hidden while association survives; present conflicting stock/price evidence rejected                       | PASS    |
| Partial failure/manual preservation          | Existing discovery/render consistency, manual merge, cache/cooldown/budget regressions                                                               | PASS    |
| Source selected quantity for SKINN null case | Actual seller-linked selected quantity needed; title-only 20ml/catalog/per-unit information is insufficient                                          | BLOCKED |
| Selected-SKU proof for every Search offer    | Need actual candidate Product/selected-SKU evidence or an independently validated fresh tracked candidate; listing title is not Product proof        | BLOCKED |
| Live discovery recall                        | Need captured Search payloads with a known exact candidate, missing/wrong-candidate controls and safe matching diagnostics; currently zero captures  | BLOCKED |
| Captured same-size cross-store triples       | Existing Myntra capture is 100ml; need independently selected same-size Product pairs/triples and actual compatible formulation/pack evidence        | BLOCKED |
| All retained legacy/manual price freshness   | Legacy offers lack uniform per-offer observations. No blanket expiry change/backfill here. Do not call retained prices freshly fetched               | BLOCKED |
| Entire fragrance category signoff            | All preceding evidence gates; unsupported name/context/formulation cases explicitly bounded                                                          | BLOCKED |

Executed regression matrix: `tests/fragrance-release-gates.test.ts` (correct,
mismatched, missing-evidence, BSON/saved-record and price controls) and
`tests/fragrance-discovery-gates.test.ts` (captured downgrade reproduction and
listing-vs-Product diagnostics). Existing fragrance benchmark retains 18 synthetic
verified, 14 explicit mismatch and 15 insufficient cases. Existing tests cover
after-index-20 ranking, cache reuse, partial failure and manual offer preservation.

## Provider limitations, not fixed code bugs

- SKINN: need a non-null supported selectedSeller.netQuantity array for the **same
  already-bound product/seller/SKU** and root price (or a separately established
  provider-selected SKU-to-quantity contract with an actual capture). Do not substitute
  a title's 20ml, unselected size labels, per-unit basis or unrelated seller.
  Quantity proof is necessary, not sufficient: brand/scent/formulation must also
  pass the profile. Its current one-word/brand-prefix naming limits may still
  prevent a canonical scent identity; do not promise SKINN matching from quantity
  alone without its actual response and corresponding candidate evidence.
- Search may omit an exact candidate or selected SKU, formulation, pack and stock.
  Existing strict listing comparison remains for compatibility, explicitly counted
  as `listingOnly` in bounded diagnostics. It cannot become an independent saved
  Product association or be claimed as Product/SKU verification. No paid hydration
  is added. Uncertain/mismatched listings stay hidden under the existing checks.
- Naming support remains deliberately bounded: ASCII-normalizable brand prefix and
  2–6 distinctive contiguous scent words. One-word names, unrecognized languages,
  reordered names and unsupported marketing contexts need actual evidence before
  adding a generic normalization rule. There is no name-specific exception.
- Captured Amazon's affirmative Perfume Oil/pack declarations cannot be ignored
  merely because another title says perfume. Missing counterpart declarations stay
  insufficient. Title comparisons such as "above EDP, EDT & EDC" are not selected
  concentration evidence.
- Absent observation metadata remains legacy/unrecorded; it does not become proof
  of freshness. Only the saved Product route enforces its existing 10-minute TTL.
  No retention/expiry policy is silently changed for manually verified links.

## Smallest future live evidence step

First inspect existing protected read-only Preview diagnostics and already available
logs, without Track/Compare/refresh. Reuse already captured sanitized responses if
available. If the critical missing item is a Search capture, request separate
approval for **one dedicated Search request for one known fragrance**, with zero
retries, pagination, Product hydration, DB writes or notifications. Analyze its
bounded provenance/rejection counts offline. Only after that, separately authorize
one selected Product capture if necessary (e.g. missing selected quantity). This
report authorizes no paid request and makes no new live success claim.

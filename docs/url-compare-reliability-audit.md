# URL-to-Compare reliability audit

Baseline: `6f958d4`. Offline audit; no provider calls, database reads/writes,
refreshes or live compatibility claims.

## Journey and confirmed defects

Track Price validates a requested retailer URL and its main Product API response.
The parsers bind root price/stock and identifiers before emitting identity facts.
Track/refresh persist those facts and observations; automatic search has a shared
10-minute cache, bounded candidate pool and no paid retries. Comparison checks
identity before price. Saved product reuse also requires fresh, URL/price-bound
observations; render-time verification repeats the identity and price checks.
Manual links have a separate budget and use the same final verifier.

The audit found these shared implementation defects:

- The independent selected-field extractor omitted fields its reader/matcher
  already supported (GTIN, processor, quantity/pack aliases). Conflicting model
  aliases could be hidden by first-field selection.
- Optional independent identifiers could retain own `undefined` properties,
  which default BSON serialization turns into null. The strict reader then
  rejected an otherwise valid saved record. Null must mean unknown only in those
  optional slots, never in required facts.
- Independent evidence did not itself require a retailer-bound product URL.
  Pair evaluation could report insufficient evidence before discovering a later
  explicit contradiction, depending on selected-field insertion order.
- Search diagnostics exposed detailed rejection reasons but lacked a stable
  failure-class distinction and a current-record evidence state. A raw evidence
  object's presence is not proof it is bound to the current product.
- Discovery used a legacy title/flag prerequisite even for pairs accepted by
  the existing independent strong-ID verifier. Align discovery with that final
  verifier without adding new categories or new paid verification.
- The final offer gate did not directly reject an explicitly out-of-stock
  independent observation on a non-saved competitor row. Reject it at discovery
  and render, without hiding the customer's own tracked source product.

## Scope and category gates

Keep fragrance-v1 as the only registered canonical category profile. Consolidate
the existing independent-evidence requirements for earbuds, phones, laptops,
fashion, grocery and appliances in a reusable selected-field policy. This does
not enable a new title-only or canonical category matcher. Book rules are an
explicit disabled gate: ISBN checksum, edition, language and binding require
grounded adapter evidence before activation. Existing legacy title matching is
preserved, not promoted to independent proof.

Only exact allowlisted MAIN specification fields are collected. Alternatives,
related products, catalog sizes and titles never fill independent selected facts.
Missing fields keep evidence insufficient; contradictory aliases invalidate
evidence without making an otherwise valid source product untrackable.

## Provider limitations and minimal future verification

The actual response may omit selected colour, RAM, size, publication metadata or
seller-linked quantity. No policy can reconstruct these safely. In particular,
Myntra null netQuantity stays tracking-only and ProClip unknown colour stays
unverified. Search rows can provide listing-level facts but not selected-SKU proof.
Old records without independent evidence need a normal future validated refresh;
no migration, backfill or forced refresh is included.

Retained legacy/manual search offers also do not uniformly carry individual
price/stock observations. `offersCheckedAt` is the comparison attempt time, not
proof that every retained offer's price was refreshed. Their existing retention
semantics are preserved here; they are not promoted to fresh independently
tracked observations. A future versioned per-offer observation change needs
explicit legacy display/expiry rules, rather than silently renewing old prices.

After Preview is available, first inspect the existing protected read-only
evidence diagnostic for one already tracked record and existing comparison logs.
Do not click Compare or refresh as part of that inspection. Any future paid test
needs separate approval. Love Drunk and Old Money live success remains the user's
reported evidence, not an offline benchmark result.

## Offline benchmark

The system reliability matrix labels captured fixtures separately from synthetic
main-field transformations. It exercises positive, explicit mismatch, missing
evidence and JSON/BSON-persisted cases across categories, freshness, stock and
record binding. Existing fragrance, manual-offer, discovery and cooldown tests
remain in the complete suite. New diagnostics contain enums/counts only, never
titles, identity values, URLs or raw provider errors.

| Offline matrix                                                | Positive |                                          Mismatch |                               Missing evidence |                                    Persisted |
| ------------------------------------------------------------- | -------: | ------------------------------------------------: | ---------------------------------------------: | -------------------------------------------: |
| Fragrance multi-product benchmark (existing synthetic matrix) |       18 |                                                14 |                                             15 | Separate observation/association regressions |
| Earbuds, phone, laptop main-field rows (synthetic)            |        3 |                                                 3 |                                              3 |                                            3 |
| Fashion main-field row (synthetic)                            |        1 |                                                 1 |                                              1 |                                            1 |
| Grocery and appliance rows (synthetic)                        |        2 |                                                 2 |                                              2 |                                            2 |
| Books independent profile                                     | Disabled | Existing ISBN/edition/language negatives retained | Missing publication provenance remains blocked |         No new independent book associations |

These are assertions, not counts of separately captured provider responses.
The captured fixture checks retain Amazon/Flipkart 30ml and Myntra 100ml source
prices and explicitly reject cross-size matches. Synthetic electronics tests
also prove automatic discovery and render-time agreement in both directions
with no new Product API requests. None establish live availability of these
attributes on every product or retailer.

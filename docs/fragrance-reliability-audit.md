# Fragrance-v1 reliability audit and offline benchmark

Baseline: fccc73b. Live evidence: Love Drunk 30ml displays three stores; Old Money
tracking succeeds but comparison has no retained offer. No live provider request,
forced refresh, DB backfill or response capture was performed in this task.

## What the Old Money logs actually prove

The source is legacy-eligible, not independently validated; saved reuse correctly
stops. Two Amazon and one Myntra rows failed the old identity gate. Six Amazon rows
hit the price gate _before_ identity, so those six are not proven matching scents.
The precise missing source/candidate field cannot be identified from those logs.
No real Old Money Product/Search JSON was supplied. Neither a missing
General.Quantity nor an absent selected Myntra listing size is a confirmed live
response fact. Those are reproducible failure classes, not invented live causes.

Code-level defects confirmed:

- Flipkart tracking already reconciles four selected-root quantity locations plus
  descriptive title text, but canonical identity only used General.Quantity.
  Net Quantity or root Product Highlights can independently bind a valid selected
  volume after URL/main-product/stock/price checks; title and catalogs cannot.
- Legacy eligibility was reported as eligible without explaining the independent
  evidence gap. New diagnostics show explicit sourceConfidence, sourceIssues and
  validated sourceVolumeEvidence field paths with no actual values.
- Price-first diagnostics obscured identity failures. Identity assessment now
  precedes the unchanged selling-price policy in discovery and display.

Love Drunk's success is confirmed by the user and its captured fixtures expose
usable General.Quantity. Old Money's exact title is generic-normalizer compatible
as well. The logs therefore do not prove a scent-name bug; data/provenance paths
can differ. No production condition recognizes either product name specially.

## Trust and provenance

The store-aware selected-volume resolver is called only AFTER existing Product
adapter validation of root response, requested identity, selected seller/SKU where
supplied, root price, currency and stock. It does not replace those validations.
It accepts coherent positive ml/l values and rejects conflicts/unsupported forms.

| Store       | Supported selected/root fields                                                                                                                 | Excluded                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Amazon      | product_information.Item Volume, Package Size Name, bound to verified ASIN                                                                     | title-only volume, related products, customization catalogs                              |
| Flipkart    | specifications.General.Quantity; General.Net Quantity; specifications.Product Highlights.Quantity; exact root highlights `Quantity: …` strings | title alone, variants/display_sizes, seller alternatives, guessed SKU-to-PID equivalence |
| Myntra real | selectedSeller.netQuantity, under the existing unique product/seller/SKU linked-offer checks                                                   | null quantity, size catalog, another seller, normalized per_unit_amount                  |

Existing captured Flipkart JSON contains all four quantity locations; tests remove
others to establish each independently supported path. Synthetic transformations
are explicitly labeled. A different field/group/representation needs actual
provider evidence before adding it. Myntra quantity entries with unfamiliar type
semantics remain unsupported for independent identity. Root title contradictions
still reject; no optional metadata changes the tracking price or promotes a
selected size from a title. Source and candidate must each meet their profile.

Generic men/women/unisex marketing and note lists are not separate scent names.
Explicit named Pour Homme/Pour Femme or For Him/For Her edition markers are
material qualifiers and must agree, alongside existing Intense/Elixir, formulation,
concentration and pack protections. Spaced/compact brands normalize mechanically.
Unrecognized one-word scent patterns remain insufficient, not a category-wide
success claim.

## Price, stock, association and diagnostics

The unchanged ratio is 0.4x–2.5x inclusive. A genuinely verified product can have a
real discount outside it, but identity alone does not validate a possibly wrong
currency/unit/conditional selling price. Such a candidate is now an explicit
price-anomaly after verified identity, not an identity failure. Additional trusted
main-offer price confirmation would be needed to change that policy. No automatic
Product request, retry, expanded budget or ratio override was added.

Saved identity links contain no prices and persist when price observations expire
or a price anomaly blocks display. Saved prices still require bound identity,
URL, amount, INR, explicit in-stock evidence and ten-minute freshness on both
records. The same price policy is applied before reuse/render. Old records with
no independent provenance are not retroactively certified. Manual/valid prior
offers, partial-failure merge, the 200-candidate cached pool, 20-result name-search
view and cooldowns are preserved.

Safe logs now distinguish legacy-only / independent-main / insufficient-selected,
source canonical issues/volume provenance, verified/mismatch/insufficient identity
counts, bounded profile rejection reasons, then price anomalies. No product names,
actual prices, raw response objects, customer details, credentials or URLs are
included in these diagnostics.

## Offline benchmark

Run `npx vitest run tests/fragrance-reliability-matrix.test.ts` offline. The summary
is asserted, not a live-provider success measurement.

| Matrix outcome    | Cases | Coverage                                                                                                                                   |
| ----------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Verified          |    18 | Love Drunk, Old Money, Fresh Morning; six directional store pairs each; independently evidenced selected 30ml and realistic title patterns |
| Explicit mismatch |    14 | 20/100ml against 30ml, wrong scent/brand, EDP/EDT, oil/mist, material gender edition, for each of two scents                               |
| Insufficient      |    15 | Pack/tester/refill/bundle/gift set; title-only source; missing listing variant; unsupported one-word scent                                 |

Additional tests cover each selected-root quantity location, conflict/unsupported
resolution, parsed Amazon/Myntra Search paths, real discount anomaly after identity,
legacy source diagnostics, freshness and persistent associations. The complete
suite also keeps captured fixture, manual-offer, partial-failure, Love Drunk,
SKINN null quantity, ProClip unknown-colour and no-extra-request regressions.

## Narrow next live validation (not executed)

After explicit paid-call approval, validate just one normal Old Money Product
refresh (one Product API request, no retry) on Preview and capture only the safe
sourceIssues/sourceVolumeEvidence and subsequent normal comparison diagnostics.
This determines which actual selected-root field the provider supplies; no bulk
refresh or parallel product tests are needed. Existing comparison cooldown/budgets
remain in force; further Search requests require their own approved budget.

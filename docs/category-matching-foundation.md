# Category matching foundation: scoped design and audit

Baseline: 35dcebc. No API calls, backfills or category-wide parser rewrite.

## Confirmed architectural weaknesses

- Flat title concentration tokens misclassify comparative marketing as selected
  EDP/EDT. Discovery, legacy attributes and render-time matching use different rules.
- Discovery caches and truncates the first 20 parsed candidates before considering
  source identity. The live Amazon response had 48 parsed candidates.
- exactEvidence ties identity to price/time and requires an MPN/GTIN and complete
  electronics-style attributes even for a named, independently selected fragrance.
- Saved reuse has no durable identity association distinct from temporary offers;
  optional legacy flags cannot describe _which_ selected evidence is missing.

## Proposed implementation boundary

Add a versioned canonical fact/provenance contract and pluggable category profile
interface. Implement only fragrance-v1 in the production profile registry. Keep
existing non-fragrance matching and exactEvidence behavior intact. Document and
exercise electronics, fashion and books requirements as design contracts only.

Canonical identity records store-local URL binding separately from cross-store
brand/line/selected facts and contradictions. Space/punctuation brand aliases
normalize mechanically; retailer ASIN/PID/SKU never become cross-store IDs. A
fragrance requires a distinctive independently printed name, trusted brand and
independently selected volume from each Product response for saved-product reuse.
Search listings can provide their own unique title volume under the existing
listing verification policy, but cannot become main-product association evidence.
Legacy verified/manual offers remain supported; legacy links cannot bootstrap
new persistent identity evidence. Optional concentration/formulation declarations
are never invented; explicit conflicts or unresolved selected variants reject.

A shared contextual reader distinguishes affirmative declarations, comparison,
negation and alternatives. It excludes comparative terms from selected facts,
records negative constraints, and keeps contradictory affirmative terms unsafe.
Named scent identity excludes note lists and marketing/category language. No
product-specific names or snapshot prices belong in production rules.

Keep the shared cache/request key, TTL, cooldown, coalescing and paid budgets.
Retain a bounded parsed pool (200) from each already-paid response; comparison
ranks with the same profile decision used at render time, then retains one best
verified offer per store. Other search consumers still receive 20 by default.
Diagnostics report bounded inspected/ranked/omitted counts and constant reasons.
No pagination, Product hydration or additional requests are introduced.

Product API adapters append canonical evidence only after their existing identity,
selected-price and stock validation. A separate price observation binds the root
price/stock/time to that identity and source URL. A durable productLinks record
contains independently verified identity only, with no price. Saved candidate
lookup is bounded and local. Stale observations may retain an identity link but
never produce a current competitor offer. Every reuse rereads and rechecks the
candidate; previous links do not override changed or missing evidence.

No concentration, SKU or volume is obtained from variant catalogs, related
products, normalized per-unit quantities or other seller rows. SKINN null seller
quantity remains unverified. Existing records need adequate normal-refresh
metadata; no forced refresh or migration is run.

## Validation and rollout

Use the exact user titles as title evidence, captured Product fixtures where
available, and explicitly labelled synthetic Search/variant mutations. Cover
context, contradictions, after-index-20 results, symmetry, selected-volume
provenance, fresh/stale price separation, manual/partial-failure preservation and
non-fragrance safety. Run full offline checks before feature-branch-only push.
Implementation details, limits and evidence gaps will be recorded below.

## Implemented scope and remaining evidence limits

`matching/contracts.ts` provides reusable fact/source and generic IdentityEvidence
and CategoryProfile contracts. Only fragrance-v1 is registered in matching/index.ts.
Fragrance uses a runtime-validated schema; other categories continue through the
existing engine. ElectronicsIdentityDesign, FashionIdentityDesign and
BookIdentityDesign are typed examples, not new runtime adapters. A future profile
must add runtime validation, captured main-product mappings, required selected
facts, contradiction checks, a bounded ranking policy and the same pair decision
for search/render/reuse. It must register explicitly and supply regressions.

Fragrance-v1 currently requires an ASCII-normalizable brand prefix and at least
two distinctive contiguous scent words, excluding category/marketing/notes. Unknown
or one-word names remain unverified by the new profile (existing strict legacy
matches still apply only to legacy records). Quantity is millilitres with litre
normalization. Combos/multipacks, mixed sizes, unresolved alternatives and explicit
contradictions reject. The contextual parser recognizes bounded comparative,
negative and alternative clauses; unsupported language/contexts are not a general
natural-language understanding guarantee. Affirmative concentrations/formulations, edition qualifiers and explicit pack counts
must agree; one-sided declarations stay unverified. No missing concentration is
assigned EDP, EDT or any other value.

Grounded adapter provenance:

- Amazon: verified ASIN; product_information.Brand and Item Volume / Package Size
  Name; optional genuine Fragrance Concentration and Number of Items pack evidence. No related-product extraction.
- Flipkart: existing URL-provider/root validation, main brand and selected General
  Quantity. A catalog size or SKU never becomes requested PID confirmation.
- Myntra real: already verified ID and uniquely linked seller/SKU offer, with
  selectedSeller.netQuantity. Null quantity creates incomplete identity only.

The captured Amazon fixture's actual main-spec formulation is **Perfume Oil**.
That is affirmative evidence, unlike the comparative EDP/EDT/EDC title. It is not
silently discarded to link a counterpart lacking formulation confirmation. The
three exact user titles match as sufficiently evidenced listings/selected facts;
this does not promise every captured full payload pair will satisfy all explicit
main-spec constraints. More evidence is required if one product declares an explicit pack count or oil,
EDP/EDT, pack/size or another selected discriminator that the other cannot confirm.
Old stored records lack new canonical facts until normal refresh; title similarity
or success tracking alone never creates a new durable product association.

New optional canonicalIdentity and priceObservation fields are written through
existing tracking/refresh paths, with no migration/backfill or live DB writes in
this task. Source productLinks retains at most 40 independently checked identity
snapshots, with no prices/timestamps masquerading as price freshness. Comparisons
locally reread candidates, recheck current identity and remove observed changed
links. Legacy offers/manual links are preserved under their prior strict policy,
but are not bootstrapped into independent Product evidence. Existing saved links
alone never authorize a price. Both source and competitor price observations must
be no older than ten minutes, stock known in-stock, URL/store/currency/current
price and identity key unchanged, before a saved competitor price is reused.

The comparison pool is at most 200 parsed candidates from one paid response. Name
search still receives 20; both share the same cached pool/key and TTL. Profile
filtering precedes final one-offer/store retention. Beyond 200 is explicitly
reported as truncated; no page/request/retry is added. Bounded diagnostics expose
counts, limits, profile confidence/source eligibility, rejection reasons, linked
identity count and fresh-price count, never identity values or product payloads.

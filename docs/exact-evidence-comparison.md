# Main-product exact evidence and saved-product discovery

Historical baseline note: fragrance behavior is superseded by [the category profile foundation](category-matching-foundation.md). Non-fragrance legacy protections remain.

Baseline a6715bb6e020f4f056a82735803cd19a98eecbe1. No live ProClip JSON is available.
Tracking confidence, model evidence, selected attributes and pair verification
remain separate. A legacy false flag can be compensated only by two complete,
independently validated manufacturer/GTIN fact sets with matching selected facts.
Ordinary titles, local ASIN/PID/SKU, image appearance or prices never provide that
compensation. Existing strict/perfume and manual-offer behavior remains the fallback.

New optional exactEvidence stores field provenance, retailer URL association and
an observedAt timestamp bound to root price/currency/stock. Amazon extraction uses
main product_information: Manufacturer Part Number/Model Number, selected Color/
Colour, Item Volume, Number of Items, Storage/RAM/Capacity and concentration where
actually present. Flipkart uses only selected General specification fields. Model
Name alone is not treated as a manufacturer MPN. Retailer ID lookalikes are excluded.
The current Amazon fixture has manufacturer fields; it has no selected colour.
No real Flipkart ProClip manufacturer/selected-colour capture exists. GTIN checksum
validation is supported in the reusable model; no unverified retailer GTIN schema
has been invented. Myntra's working parser/comparison was not rewritten.

Profiles require pack plus category attributes: earbuds colour; phones RAM/storage/
colour; laptops CPU/RAM/storage/colour; perfume quantity/concentration; fashion
size/colour; grocery quantity; appliances capacity/colour. Every extra selected
fact must also agree on both sides. Incomplete profiles deliberately reject reuse.
Manufacturer identifiers must agree when both supplied; contradictory identifiers
block fallback to title matching. Evidence from alternatives is never inspected.

Automatic comparison adds a bounded local lookup (40 newest records) only when
the source already has complete fresh evidence. Both source and candidate prices
must be at most ten minutes old using price-bound observation timestamps, not
Mongoose updatedAt (which comparison writes can update). URL/store/current price/
currency/explicit stock must agree with their evidence. Same-store links, future/
stale/changed prices and unverified records reject. Reused offers retain evidence
and a marker so render-time freshness is rechecked. No paid hydration is added.

Normal cached search still runs under existing budgets/cooldowns. Search offers
lack complete main evidence and cannot override a false source flag. Diagnostics
now distinguish empty searches, insufficient identity, mismatch/insufficient cases,
verified results and provider failure with bounded constant reasons. Existing
customer unverified state remains. Stored evidence/offer fields are optional;
there is no migration/backfill or DB operation executed during implementation.
Old tracked records without evidence cannot use the new saved-price route until
a normal independent refresh supplies enough main facts. ProClip comparison still
needs trustworthy manufacturer identity AND explicit selected colour/pack facts
from both main responses, plus fresh validated prices. Tracking alone is insufficient.

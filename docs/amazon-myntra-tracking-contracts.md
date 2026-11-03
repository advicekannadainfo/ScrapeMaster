# Focused Amazon/Myntra tracking compatibility

Baseline 4f105e4dd0e2c90d1a1873ef3040aa21bba10c52. Exact failing boAt/SKINN JSON is
not available. Official documentation pages were attempted without credentials;
network access returned proxy 403. Contracts below are grounded in the supplied
verified documentation example and existing captured/sanitized fixtures.

Amazon still requires response ASIN equality, positive numeric main price and
explicit INR and stock evidence. Brand and duplicate purchase_options.single_offer
are optional. Supplied selected price/stock must agree. A missing symbol may use
the documented INR main-price string only if its amount equals extracted_price;
India domain/country alone is not currency proof. Unknown stock never becomes
available; related products never supply identity, stock or price. Missing brand
marks comparison identity unverified while allowing trustworthy URL tracking.

Myntra's documented productId/string brand/images/sizes contract and real
id/selectedSeller/buyButtonSellerOrder/media/seller-linked sizes contract remain
separate. Real-schema markers prevent fallback after corrupt real data. Both
contracts support the two established brand representations; missing brand does
not invalidate tracking but prevents comparison verification. Real media may use
the documented main images array; no related/size image is selected. Real seller,
SKU, product reference, stock and price agreement remain mandatory. The documented
contract can track a common selling price across available sizes, but never claims
an arbitrary selected size or a size-specific MRP when those MRPs differ. Wrong
explicit volume labels reject. No selected size is inferred from a catalog list.

Validation errors expose at most eight allowlisted paths plus fixed Zod codes and
primitive types, not arbitrary field names, values or payloads. Unknown response
ASIN/ID structures, missing prices/currency/stock or missing real selected-seller
linkage remain safe failures; actual failed fields cannot be confirmed without
sanitized live fixtures. Optional data is not used to manufacture prices/models.

Synthetic tests mutate established fields explicitly, and do not claim captures of
the new products. Flipkart parser logic, transports, retries, fallbacks, caching,
cooldowns, manual comparison and DB services are unchanged. No live API or DB write
was run. Tracking and cross-store identity remain separate via the existing flag.

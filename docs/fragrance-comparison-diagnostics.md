# Fragrance comparison evidence and diagnostics

These are offline findings, not the cause of an uncaptured live Amazon click.
The existing sanitized Amazon Product fixture is NOT that click's Search response.
Its long title contains comparative EDP/EDT marketing, so using that exact wording
as a synthetic Search row correctly remains ambiguous. It must not be silently
stripped to certify a particular concentration. This is a reproduced omission
path, not proof of what Amazon Search returned on that click.

## Love Drunk 30ml

The Amazon and Flipkart dedicated search parsers require valid store-local URLs,
identifiers and positive INR prices. Amazon excludes sponsored and explicitly
unavailable rows; malformed all-product results produce a parse failure. Its
verified schema does not supply brand/selected-variant metadata, so fragrance
enrichment must establish brand prefix, scent and quantity from that candidate's
own title. Compact/spaced brands already normalize. Missing/contradictory brand,
size, concentration or variant cannot be filled from the source alone.

Two reproducible false negatives are fixed: repeated identical quantities in one
listing are one volume, and explicit EDP/EDT abbreviations normalize consistently
with their full names in discovery and persisted/render-time attribute checks.
Bare "perfume" or "parfum" still does not establish EDP or EDT. Different scents,
20/30/100ml, mixed quantities, bundles and accessories remain rejected.

Other omission paths remain intentional or unconfirmed for that live click:

- The provider might return no eligible listing, omit its required fields, or fail.
- A correct listing beyond the first 20 parsed positive-price candidates is not
  examined. The limit stays 20; no paging, Product calls or retries were added.
- Source identity may be unconfirmed; a candidate may lack scent/volume evidence.
- Explicit quantity/concentration/identifier conflict, currency, implausible price
  or accessory checks can reject a candidate.
- Persisted/render-time checks can reject evidence that disagrees with its record.
- Saved-product reuse requires complete independent main evidence and source AND
  competitor observations at most ten minutes old; comparison writes do not renew
  those timestamps. Old links without provenance cannot establish a verified price.

The missing evidence for the click is its Amazon `[compare] Search result` or
`[compare] Search failed` entry. Search result diagnostics now include sourceEvidence,
parsedCandidates (after adapter validation, before the 20-result limit), candidateLimit,
truncated, cacheHit and rejection counts. Reasons distinguish source insufficiency,
explicit mismatch, ambiguous concentration, candidate insufficiency, currency, price, accessory and render
filtering. `[compare] Offer merge` reports only per-store booleans for discovered,
previouslySaved and retained. `[compare] Saved product reuse` reports only constant
status and bounded counts. No query, product title, URL, price, SKU, customer data,
raw JSON or credentials are logged. Existing valid offers survive missing discovery.

## SKINN Verge 20ml

The confirmed selectedSeller.netQuantity=null explains the source-wide false flag;
20 search candidates per store do not supply the missing source quantity evidence.
Tracking continues using the already bound root product ID, seller/SKU link,
root/selected-seller price agreement and inventory. No parser relaxation is made.

Known real fixture fields supply no independently selected replacement volume:
frg_list_link binds product/seller/SKU but contains no volume; product name/details
are descriptive text; other sizes/offers can belong to another product or seller.
per_unit_amount is normalized pricing (the 30ml rows use quantity=100), not bottle
volume. Neither that field nor a price ratio proves selected 20ml.

The supported route is an actual valid selectedSeller.netQuantity array stating
20ml, corroborated by the current uniquely linked product/seller/SKU offer, price
and title with no conflict. A different selected-SKU quantity representation would
need captured evidence and a verified provider contract before supporting it.
Until then comparisonIdentityVerified remains false with the safe diagnostic
sourceEvidence=selected-volume-unconfirmed. Tests mutating captured Love Drunk
fields into SKINN-like structures are explicitly synthetic, not live SKINN captures.

Even with volume supplied, the current fragrance-name discovery helper requires a
recognizable named scent; it is not a promise that a future SKINN response will
automatically produce verified cross-store offers. No tracking parser, paid budget,
10-minute comparison/search cooldown, freshness gate or manual-offer policy changed.

# Cross-store discovery

Amazon name search is implemented. Flipkart prefers dedicated ScrapingDog search
with the shared key, or uses Affiliate search with both affiliate credentials.
Disabled search is not evidence of no stock.
Myntra Search uses the user-supplied official `search_results` schema and a documented-shape
offline fixture. Its fixed `/myntra/search` endpoint receives `api_key` and a full Myntra
search URL server-side. IDs must agree with landing URLs; availability uses inventoryInfo.
Catalog size lists are not selected variants, and never supply invented title quantities.
The existing real Myntra Product parser is retained. Search has not been live-verified.

`findOffersWithDiagnostics` separates empty search results, candidates rejected by
strict identity checks, verified matches and request failures. These diagnostics
describe each invocation; mocked tests do not establish live store inventory.
`discoverySupport` reports absent search implementations and missing credentials.

Search queries now retain distinctive names and normalized quantity instead of
cutting off at eight words. Identity verification remains strict; missing size,
brand/name conflicts and the AL ADHEEM false match remain rejected.

`discoverOffers` is shared by name search and comparison. Per-store/region/query
requests coalesce; results (including empty results) cache for ten minutes and
failures cool down for one minute. Dedicated and general ScrapingDog search routes
get one attempt, with no browser fallback or paid retries. Future verified adapters
can supply `search.load` for a dedicated transport without using `/scrape`.
Caches are process-local, not a global credit cap across serverless instances.
A distributed cache/budget and documented store feeds are still needed for scale.
Nykaa, Ajio, Meesho, Croma and Reliance Digital catalog discovery is not implemented.

## Dedicated providers and controlled fallback

Amazon currently uses HTML product/search parsers, with the general ScrapingDog route
when configured, including premium proxies and JS rendering. Flipkart retains its HTML
product parser/browser support and official Affiliate search. Dedicated Flipkart Search
supports the conservative supplied field subset described below. Dedicated Amazon
Search for India now uses the documented object envelope and row fields described below.

`dedicatedFirst` supports an explicitly authorized separate fallback, on empty results
or transient provider failures. Default is no fallback and at most one paid route.
An extra paid fallback requires a two-route budget; identity/security/parse errors
never trigger fallback. If a primary failure is followed by empty fallback results,
the failure is preserved. `search.fallback` must supply a verified parser and transport.
No Myntra generic-search fallback is enabled because its HTML schema is unverified.
The generic scraper, premium proxies and JS rendering remain available; they were not
removed or represented as unsupported globally. Budgets count outer provider calls,
not provider-internal credit billing. Request coalescing and limits are per process.

## Amazon and Flipkart dedicated search update

Flipkart now prefers `/flipkart/search` when SCRAPINGDOG_API_KEY is configured.
The user-supplied fields (title, url, price, image, product_id in search_results)
are supported conservatively: positive numeric INR price and HTTPS Flipkart product
URL whose pid equals product_id are required. PID-less links, formatted/object
prices, and undocumented availability formats are not guessed. The fixture uses
synthetic values in that supplied field shape, not a live-captured response.
Affiliate Search remains the default without this key and is an opt-in fallback
with credentials. No unverified generic Flipkart HTML search parser was invented.
Product HTML/browser/general scraping paths are unchanged.

Amazon India search now prefers `/amazon/search` with the shared key, using query,
domain=in, page=1 and country=in. The supplied official object envelope `results`
and `type=search_product`, title, asin, optimized_url, extracted_price, price_string,
price, currency, image, sponsored, availability_quantity fields are validated.
Bare arrays/array-of-objects envelopes are rejected until separately verified.
Valid extracted_price wins; fallback strings must be explicitly INR/rupee-prefixed
and correctly grouped. HTTPS Amazon India URL and ASIN must agree. Sponsored and
explicit zero-availability listings are excluded; missing stock remains unknown.
Non-product metadata rows are skipped, while wholly invalid product rows fail clearly.
The documented-shape fixture uses synthetic products and is not a live capture.
Other Amazon regions keep existing generic/HTML search. India without the key also
uses the existing HTML path. Generic scraping, premium proxies and JS rendering
remain an explicitly budgeted fallback with the existing HTML parser; default paid
budget stays one, so an additional paid generic fallback requires explicit opt-in.

## Amazon/Flipkart Product status

The supplied Product endpoints and inputs are implemented as server-only, one-call
transports with zero redirects, finite timeout/response size, fixed provider hosts,
sanitized errors, key checks, public DNS/private-IP validation and throttling.
Amazon validates an India URL and extracts its ten-character ASIN; explicit multi-item
quantity is rejected. Flipkart validates the product path and optional unique PID,
retaining URL selectors. Working HTML product routes are unchanged.

Initially both documentation pages returned 403. The user subsequently supplied
the real Amazon India field contract and a Flipkart Product example. Amazon India
now activates dedicated Product routing with the key. It requires requested ASIN
to equal product_information.ASIN, INR, positive extracted_price agreeing with the
single_offer price, and agreeing explicit stock statuses. Selected volume/package
size and title quantities must agree; unsupported pack representations fail.
related_product_sections is never traversed or returned as a verified offer.
The 100ml ASIN B0FLWST1D4 is only a candidate until separately fetched and verified;
no automatic enrichment request is made. The 30ml ASIN B0FYGRL51R at 184 must not
match the Myntra 100ml product at 650. extracted_median_price is not verified MRP,
so originalPrice defaults to selling price with zero claimed discount.

The Amazon reduced fixture uses supplied ASIN/price/volume values and illustrative
title/image/review/related-section data, not a captured complete provider response.
Full sanitized payload compatibility still needs confirmation. HTML parsing/proxy/JS
rendering is retained as an explicit-budget fallback; response #ASIN, INR selling
price and known in-stock status must verify before accepting that fallback.

Flipkart's real product_results payload now validates a diagnostic candidate with
formatted INR, SKU, brand/model, agreeing 30ml quantities, HTTPS image, explicit
InStock and nested product ratings. The real fixture yields 250 INR and reference
price 275. Response-side requested identity binding remains unavailable: SKU is
not independent proof of requested PID, even when their strings coincide. Product
routing now accepts provider URL binding with consistent real fields plus brand/
model corroboration from a descriptive URL or already cached dedicated Search
row. Conflicting cached evidence, URL quantity or response fields reject. No extra
Search request is made for corroboration; no verified PID is fabricated. Opaque
URLs without cached evidence and unsupported contracts remain blocked. Generic
rendering remains an opt-in bounded fallback with canonical/stock validation.
See `flipkart-real-product.md` for the policy and limitations.

Amazon India credit costs and proxy/rendering multipliers are provider-plan-dependent;
one HTTP request is not a promise of one credit. No Product live requests were made.
Missing/ambiguous price, stock or selected variant must fail or remain unknown once
parsers are implemented; list price must not be substituted for a selling price.

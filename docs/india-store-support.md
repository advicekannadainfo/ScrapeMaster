# AJIO, Nykaa and Croma: conditional product support

These stores have domain adapters using a shared, strict Schema.org Product parser.
This is conditional JSON-LD support, not a claim that current live store markup works.
No real store HTML/search fixtures were available. Free robots requests for all three
hosts failed at the cloud proxy with CONNECT 403; no store robots rules were obtained.
No paid scrape, CAPTCHA bypass, credentials, database mutation or deployment was used.

Accepted pages must contain exactly one Product whose explicit URL matches the
requested page (including variant selectors), brand/name, productID or sku, HTTPS
image, and one unambiguous Offer with positive INR selling price and explicit supported
stock. ProductGroup minima, aggregate offers, ambiguous sellers, and recommendations
are not selected. ListPrice can supplement but never replace selling price. Colour
and size are preserved in identity/title so comparison cannot silently mix variants.
Missing data fails clearly; stock is not invented. Only known tracking keys are removed.
IDs come from standard data, not guessed store URL patterns. Optional metadata fields
are added to the application model; no migration or database write was executed.

The fixture is synthetic standard JSON-LD reused for each domain, not captured store
HTML or an invented proprietary response. Embedded state, DOM selectors, OpenGraph-only
pages, missing availability and product pages without explicit canonical identity are
unsupported until verified. Search by name is intentionally not registered for these
stores: a generic product parser is not a search adapter. Existing search capability
reporting marks them not-implemented and no fake offers or search prices are supplied.

Needed for each store: a sanitized captured product page with JSON-LD/embedded state,
exact requested URL and selected size/colour/quantity; a captured search result page
(or its documented JSON response) with requested search URL, product links, IDs,
selling price/currency and stock/variant fields; include empty/blocked-page examples.
Review actual robots/access rules before enabling search. No further live requests
are needed to implement against user-supplied offline captures.

All new adapters use existing loadAndParse: URL/DNS/private-IP checks, robots guard,
host throttling, health/circuit breaker and the general ScrapingDog premium/JS route
when configured. Direct HTTP/browser paths and existing dedicated APIs are preserved.
No new dedicated API was invented for these stores. Generic/proxy rendering remains
available; parsing an unsupported page is a failure, not permission to bypass access.

# Cross-store discovery

Amazon name search is implemented. Flipkart search uses its official Affiliate API
and requires both affiliate credentials; disabled search is not evidence of no stock.
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
product parser/browser support and official Affiliate search. Dedicated Amazon/Flipkart
ScrapingDog endpoints are integration opportunities, not implemented without verified
request/response contracts and fixtures. Existing working paths were not replaced.

`dedicatedFirst` supports an explicitly authorized separate fallback, on empty results
or transient provider failures. Default is no fallback and at most one paid route.
An extra paid fallback requires a two-route budget; identity/security/parse errors
never trigger fallback. If a primary failure is followed by empty fallback results,
the failure is preserved. `search.fallback` must supply a verified parser and transport.
No Myntra generic-search fallback is enabled because its HTML schema is unverified.
The generic scraper, premium proxies and JS rendering remain available; they were not
removed or represented as unsupported globally. Budgets count outer provider calls,
not provider-internal credit billing. Request coalescing and limits are per process.

# Real Flipkart Product payload (offline)

The user-supplied full response is retained in `tests/fixtures/flipkart-product-real.json`.
Chat Markdown links are normalized to their literal HTTPS URLs. Review text/names
and manufacturer addresses are redacted; response field structure is preserved.

`inspectFlipkartAPIProduct` validates a diagnostic candidate: SKU, brand/model,
30ml quantity across title/specifications/highlights, selected INR price 250,
reference price 275, explicit InStock, HTTPS image and product rating 4.4.
Description price, cashback and seller rating are not selected product fields.
Nonempty variant arrays, unsupported packs, conflicting quantities/identity hints,
unknown stock and invalid prices fail closed.

The inspector intentionally contains no canonical product URL or verified PID.
The payload has SKU but no response-side PID/product URL. A SKU resembling or
equaling the request PID is not independent proof of that binding.

Dedicated Product routing is now active with a URL-based provider trust policy:
the fixed HTTPS provider endpoint receives the validated exact product URL, with
no redirects or automatic retries. A consistent supported real payload must also
have independent semantic corroboration from the descriptive request slug (brand
and all distinctive model words, at least two), or an already validated cached
Search row with matching canonical path/PID and strictly matching title. URL
quantities must not conflict. Cached conflicting titles reject even if slug
evidence passes. Cache entries expire after ten minutes and are capped at 200;
cache misses/expiry never cause another Search request. Search prices are never
substituted for the selected Product price. Response-side identity hints, where
present, must not conflict. Unsupported explicit variant/cart selectors reject.

Accepted products retain the requested URL but do not fabricate `storeProductId`:
the description records provider URL trust and the absence of independently
verified response PID. This policy trusts provider URL binding, not cryptographic
identity proof. Opaque URLs without cached evidence, the old monitor schema
without stock, unsupported variant arrays/packs and inconsistent data fail closed.
The currently supported real Product contract is volume-based; other categories
need verified payloads, not guessed schemas.

Existing generic HTML/proxy/rendering paths remain available. Paid fallback is
opt-in with budget two; parse/security failures never trigger it. HTML fallback
requires matching canonical identity and explicit structured stock. No live
requests are needed for these tests. Amazon/Flipkart 30ml are compatible variant
candidates; Myntra 100ml remains incompatible. Conservative cross-store title
matching still applies and can reject differently worded titles.

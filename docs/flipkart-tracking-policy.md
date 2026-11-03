# Flipkart URL tracking vs comparison identity

Baseline d00824791ba66bda7ddf8106ca977cb19d644927; incorporates the local safe
missing-model diagnostic. No real ProClip response has been invented or captured.

Missing General.Model Name is no longer by itself a tracking failure. Tracking
still requires the real main title/brand, valid root INR selling price, SKU,
HTTPS image and explicit stock, without any response PID/canonical URL conflict.
A missing-model product also needs matching cached Search title, independently
validated response PID/canonical URL, or descriptive request-URL context agreeing
with the returned brand and multiple distinctive title tokens. This validates
URL-based tracking context, not a model inferred from a URL/title.

The model remains absent. A persisted comparisonIdentityVerified=false prevents
this product from becoming a cross-store verified source/candidate, even when
its title happens to equal another listing. Automatic discovery still attempts normal cached store searches for such a source;
its results remain unverified and hidden. Manual verification avoids paid Product requests.
Existing DB offers are retained and filtered at render time instead of erased.
When a later response has sufficient explicit model and selected-variant evidence,
normal comparison can resume under the existing strict variant rules.

Variable or absent specifications/General groups are permitted for tracking.
Unrelated structured fields are ignored, but recognized selected specification
fields must have supported scalar types; contradictory model/brand/colour/size/
quantity data still rejects. Nonempty variants and display_sizes arrays are
bounded at 50. Missing independent main-product colour evidence downgrades
comparison confidence without rejecting URL-bound tracking; their
options/selected flags/prices are never used to select the tracked product.
Existing availability, root price, URL/PID and unsupported non-missing model
representation checks are preserved. No alternative field schema is guessed.

Only verified model-format strings are currently recognized. Missing model
products can track when the above evidence suffices, but cannot compare yet.
Unknown stock, explicit variant contradictions and unbound root prices remain failures.
Missing optional colour is unknown, never copied from the alternatives catalog. Legacy
records lacking the new optional flag follow the existing identity policy.
The optional Mongoose field is persisted by existing track/refresh services;
no database migration/write was run during this implementation.

Tests use controlled offline contract mutations of known fields, not real
ProClip data/prices. Actual ProClip field presence, selected colour and supported
representations still need a sanitized real fixture or an approved live test.
Request routes, retries, caches and cooldowns are unchanged; no new paid route
or retry is added. The synthetic tests disable all live Product request access.

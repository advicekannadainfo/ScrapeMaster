# Main Product API content for About this item

Amazon reads only top-level description and feature_bullets. The captured full
Amazon fixture contains a string description and a flat string-array of bullets.
Flipkart reads only product_results.description and highlights; these shapes are
present in the real full fixture. Description fields remain optional/unknown at
schema validation so malformed presentation content never blocks tracking.
Existing recognized quantity statements in highlights still undergo their existing
identity/conflict checks; unsupported presentation-only items are ignored.

Myntra reads product_results.product_details from both established Product shapes.
Known Myntra fixtures have no nonempty product_details example. The adapter can
render direct text or a flat string-list without interpreting object keys; these
cases are explicitly synthetic in tests. Nested/object detail formats are ignored
until a real sanitized sample establishes their structure. No schema is invented.

The shared normalizer ignores null/empty/unsupported objects, HTML, parser proof
notes and credential-like text; deduplicates lines; removes redundant bullet
prefixes; and caps inspection (32 source items/lines), each line (1500 characters),
output (8 items / 6000 characters). No related listings, variant options, seller
records or reviews are traversed. React renders plain text, never injected HTML.
The existing newline-delimited description string persists through track/refresh;
About renders it using the existing bullet list. Fallback appears only when no
usable main-product content remains. Historical technical notes remain hidden.

No identity/comparison rule, root price, SKU, selected size, model or request budget
is changed. Root price/stock/quantity conflicts still reject under existing rules.
There is no migration, database backfill, bulk refresh or extra API request.
Existing records receive new content only on their normal future refresh/retrack;
deploying this code alone does not fetch or rewrite their descriptions.

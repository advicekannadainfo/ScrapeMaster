# Full Product fixture verification

amazon-india-product-full.json preserves all top-level fields and nested structures
from the user-supplied real ASIN B0FYGRL51R payload. Customer names/profiles/avatars
and review prose are redacted; location/contact strings are sanitized. Product
identifiers, prices, selected quantity, images, stock, ratings and all related-product
sections are retained. This is separate from the earlier reduced illustrative fixture.

The real payload exposed a compatibility bug: main_title omits 30ml, while title
contains 30ml. Previously the parser inspected both titles but failed to append the
selected quantity to the returned shortened title. It now checks the chosen title
itself and appends the confirmed 30ml. Compact BLABLIBLU and spaced BLA BLI BLU are
recognized as the same brand prefix for presentation only; global matching rules
are not relaxed. ASIN and price/stock/volume checks remain mandatory.

related_product_sections.items includes B0FLWST1D4 at 649 for 100ml. That section is
not traversed by the product parser, not converted into offers and never fetched
automatically. A separately requested ASIN must match the top-level selected ASIN.
extracted_median_price 275 is not asserted to be verified MRP.

flipkart-product-full.json retains every field in the supplied documented example.
Review names/prose are redacted. Markdown link presentation wrappers in the pasted
message are normalized to their literal HTTPS URL values for the JSON fixture;
the production parser does not accept Markdown as a URL format.

Response-side identity evidence: title, brand, specifications.General.Brand,
specifications.General.Model Name (LS22D300GAWXXL), and Display Size. brand_url is
a brand/category URL, not the selected product canonical URL. seller.name identifies
the merchant; main_image/images identify media. There is no product PID, SKU,
canonical product URL, explicit selected variant identifier, stock or availability.
delivery_date, cod_available and seller services do not establish stock. Accordingly
Flipkart dedicated Product routing remains blocked; the parser raises the precise
identity/stock limitation instead of inventing verified fields. Existing HTML routes
remain available. No paid request was needed for this verification.

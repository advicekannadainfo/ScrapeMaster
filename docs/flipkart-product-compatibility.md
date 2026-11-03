# Focused Flipkart Product compatibility

Baseline: b35833fc4e0c5ae0f892048b31c606371a823adf.

The confirmed error showed two independent blockers: a non-string/missing Model
Name and rejection of all nonempty variants arrays. The complete ProClip response
has not been supplied. Only a nonempty string model is established by the real
perfume response and documented monitor example. Array/object/null/missing models
remain blocked with structural-only type/array-length diagnostics. Singleton
arrays are deliberately not unwrapped without evidence of that API contract.

Variants can now be an opaque array of at most 50 entries. Entries, including
selected flags, IDs and prices, never supply model, price, stock or selected colour.
A nonempty catalog additionally requires one recognized main-title colour that
agrees with explicit selected General.Color/Colour evidence. Existing brand/model,
SKU, INR price, HTTPS image, stock, request URL/canonical URL and PID conflict
checks still apply. A SKU is not proof of requested PID. Empty/absent variants
keep the existing policy. Display sizes remain unsupported if nonempty.

Tests are explicitly synthetic contract mutations of known response fields, not
captured ProClip results. Real perfume and existing wrong-size regressions remain.
No transport, search, cooldown, cache, paid budget, retry, DB or fallback changes.
No live API was called. Actual Model Name structure and selected-colour evidence
must be supplied as a sanitized fixture before claiming real ProClip compatibility.

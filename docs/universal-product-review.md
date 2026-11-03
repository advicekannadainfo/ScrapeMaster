# Category-aware product comparison review

Baseline: feature branch `fix/myntra-real-json-parser`, exact commit
`11a31f84862cbf228f42090dc42483357ce46857`. Implementation uses a separate detached
worktree; no old local patches or ZIP releases were imported.

## Confirmed causes and what is not known

The Flipkart real Product schema required General.Quantity and Net Quantity for
all products, ran the volume-only parser over their values, required repeated
General.Brand, nested ratings, highlights and empty variant arrays. These
perfume-specific requirements can reject electronics before price or identity
validation. The generic error hid which field failed. The actual ProClip JSON is
NOT present, so no claim is made that its precise response has been reproduced.
The new error contains allowlisted field paths and Zod codes, never raw values.

## Changes

- Flipkart retains mandatory title, top-level brand, model, SKU, INR positive price,
  HTTPS image and explicit stock. Optional ratings, repeated Brand, quantity and
  absent variant arrays are no longer prerequisites. Nonempty unverified variant
  arrays still reject; existing URL/PID/SKU distinctions and corroboration remain.
- Quantities remain required for perfumes; other categories do not require ml.
  Explicit selected colour, size, capacity, storage, CPU, RAM and model-number
  facts can be normalized into the existing variant field. Conflicting printed
  facts reject. No unverified available-size array is treated as selected evidence.
- Amazon non-perfume titles retain the full title to avoid dropping variant facts.
  A non-volume Package Size Name is not passed to the perfume volume parser.
  Related products and unknown stock do not become the selected product.
- Shared matching gates both strict and flexible fragrance matching and automatic
  search enrichment. Explicit colour/memory/quantity/pack/size/CPU disagreements
  or asymmetric evidence reject. Recognized categories require relevant evidence
  on both sides. Ordinary model/title token equality stays conservative.
- Generic parsing rejects missing currency or stock rather than guessing USD or
  available. Its extracted brand is retained. No new store-specific HTML contract
  is claimed.

## Validation and limits

Category tests are synthetic identity/unit tests, explicitly not real retailer
responses. The electronics parser test mutates verified Flipkart response fields
in a controlled contract test; it is NOT a captured ProClip fixture. Existing real
Amazon/Flipkart/Myntra fixtures and identity/partial-failure/manual-offer tests run
alongside them. The one old assertion requiring ratings was replaced by a positive
optional-rating test: stock, price, identity and variant safety assertions remain.

A complete sanitized ProClip response is still needed to confirm which fields it
actually supplies. Missing SKU/model/stock, unrecognized response envelopes, numeric
vs string alternatives or nonempty selected-variant structures remain unverified;
no response schema was guessed to make that product pass. Non-General specification
groups, broad colour vocabularies and unusual dimensions need real fixtures. The
matching policy can deliberately produce false negatives. The engine does not
promise every product category or every store is live verified.

No request routes, paid retry counts, search cache TTL, cooldowns, DB services,
alerts, UI or fallback controls were changed. Extra paid cost from this patch is
zero: identity checks are local; no extra hydration/search is initiated. Existing
provider costs still apply during authorized future live use. Automatic discovery
continues without customer competitor URLs; existing manual verification remains.

## Completion after interrupted review

- Preserved the quantity-conflict error contract and added regression coverage
  for swapped labelled RAM/storage (including prefix and suffix labels).
- Books now require checksum-valid ISBN-10/13 (ISBN-10 canonicalizes to ISBN-13),
  explicit nonconflicting edition and recognized language. Unknown/missing values
  reject. Edition alone does not classify an electronic product as a book.
- Book checks apply to title evidence or serialized selected specification fields
  in the existing variant field. They do not establish a new retailer book API
  schema: real store payloads without these facts remain unverified. Unlabelled
  book titles cannot always be identified as books; language vocabulary is bounded.

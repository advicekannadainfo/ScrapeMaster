# Invalid stored canonical identity: offline audit

Baseline 91ac1db. Actual protected diagnostic says the stored value exists but
readCanonicalIdentity rejects it. No live provider call or DB operation was run.

## Confirmed facts versus unknowns

`state: invalid` rules out a wholly absent/null canonical value for that diagnostic.
It does NOT identify the failed predicate. The old issues/selectedVolume flags are
computed from the decoded object. When decoding fails, issues defaults to [] and
volumePresent to false, even if the stored object physically contains those fields.
Likewise invalid identity makes boundAndFresh false irrespective of price age.
A legacy true flag never authenticates the new stored schema/provenance.

The reader first requires the current version/profile/category/shape, then checks
retailer URL association, normalized brand, product/listing binding method, each
fact's store-specific field/scope provenance, selected volume and pack constraints.
Old shape/version, invalid field paths/scopes, malformed volume, wrong URL/binding,
or persistence loss can each produce the observed invalid result. Existing live
summary cannot distinguish them.

## Concrete incompatibility reproduced without a database

The current parser emits a VALID partial canonical identity when no independent
selected volume is available: selected may consist entirely of undefined optional
facts, with issues including volume-unconfirmed. observeProduct can still create
its bound observation before any persistence, although the identity is insufficient
for independently verified comparison.

The actual Product Mongoose schema uses default minimization. Constructing a real
ProductModel document from that partial parser output and calling toObject() drops
empty canonicalIdentity.selected. The canonical schema requires selected, so the
serialized object rejects at path `selected`, code `schema.invalid_type`.
priceObservation survives. toObject({minimize:false}) retains selected and decodes
as valid-but-insufficient. A populated selected volume survives default minimization.
Tests perform no connect/save/update calls. This demonstrates a parser/document
serialization incompatibility, particularly relevant to document refresh/save.
It is not proof of the exact update path or contents of the actual Old Money row.

No writer settings, schema requirements or stored records are changed by this
patch. Do not default missing selected facts, repair rows, refresh, or run migrations
before the specific stored failure is confirmed. Preserving an empty object in a
future writer fix would still not establish missing selected-volume evidence.

## Safe diagnostic extension

The existing protected GET now includes canonicalIdentity.validationFailures:
at most eight objects with fixed code and allowlisted structural path. The reader
itself emits the rejection reason, so the diagnostic does not duplicate or relax
its acceptance rules. No Zod message/options/actual values, unknown field names,
identity values, URLs or customer data are returned. issuesValidated distinguishes
failed decoding from a successfully validated empty issues list.

Examples:

- schema.invalid_type at selected: the required selected object is missing/wrong
  type; consistent with reproduced minimization, but does not prove its history.
- schema.invalid_literal at version/profile/category: incompatible contract.
- product-fact-field-disallowed at selected.volume.field: untrusted provenance.
- volume-scope-invalid / volume-value-invalid: selected evidence invalid.
- source-url-unbound / product-binding-invalid: retailer binding invalid.

Next action: repeat ONLY the protected read-only Preview inspection for the same
Old Money URL on this diagnostic commit. Read deploymentCommit, validationFailures
and issuesValidated. No Product/Search request, Track Price, Compare, notifications,
write or refresh is necessary to obtain these reason codes. A live confirmation
has not been claimed. Existing Preview/secret guards, projection and no-store
response behavior are unchanged; Production refuses the request before DB access.

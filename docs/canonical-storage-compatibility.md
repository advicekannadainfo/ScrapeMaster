# Optional canonical facts: parser and persistence compatibility

Baseline 4484097. The live failure identifies invalid types in three optional
fact slots, but does not disclose those stored types. This patch does NOT claim
that the actual Old Money values have been observed as null.

## Root cause reproduced offline

The prior canonical producer returned own keys concentration/formulation/edition
with undefined values when those attributes were unknown. JSON.stringify omits
undefined, so earlier JSON-only round trips passed. MongoDB driver's actual
default bsonOptions.ignoreUndefined is false: BSON serialization converts those
explicit undefined fields to null. The prior optional fact schema accepted
missing/undefined, but rejected null. Tests reproduce the exact three invalid_type
paths with the old strict schema and actual driver BSON options, without connecting
a client. Standalone BSON.serialize's default can differ, so the regression uses
MongoClient.bsonOptions, not an assumed serializer default.

This is a concrete generic producer/serialization/reader contract incompatibility.
It explains the reported pattern if those stored values are null. Other invalid
types remain possible until the protected diagnostic's structural types are read.
No stored record was fetched or written during this task.

## Fix and boundaries

- OPTIONAL identity fact slots normalize null to absence, which is the same unknown
  state already supported for missing fields. Required source/brand/selected/issue
  structures are unchanged. No defaults fabricate any identity or attribute.
- The canonical reader returns a fresh compact object with unknown optional keys
  omitted. Producers already return through that reader; future Track/refresh,
  search evidence and association snapshots no longer emit explicit undefined
  optional facts. The original stored object is never mutated by reading it.
- Product/offer document minimization is disabled for future document serialization
  so an empty selected object remains valid-but-insufficient, rather than vanishing.
  The required selected object is NOT defaulted when absent/null in a saved row.
- Non-null strings, numbers, arrays, empty/malformed fact objects, invalid provenance,
  scopes, values and bindings still reject under existing validation. A null volume
  or line remains missing proof; it never becomes the title's asserted value.
- Known EDP/EDT, formulation, scent, selected volume and pack contradictions still
  reject. One known attribute versus an unknown counterpart remains unconfirmed
  under the existing profile. There is no title/flag/price-based trust override.
- Price-observation identity keys retain their semantic values across normalization;
  no timestamp, price, stock or freshness is renewed. Stale prices remain stale.

The protected Preview diagnostic now returns fixed optionalAttributeTypes for the
three reported slots (types only), plus observedType for still-rejected structural
failures. It never returns attribute values, raw identity, URLs, secrets or customers.
This permits confirmation/refutation of the null-placeholder mechanism without
scraping, refresh, Compare Stores, writes, migration or bulk jobs.

## Offline regression coverage

Default driver BSON legacy reproduction; compact producer JSON/BSON/Mongoose round
trips; saved null placeholders; valid fact retention; malformed non-null rejection;
missing required selected structure; null volume/line remaining unverified; empty
selected persistence; original input non-mutation; unchanged identity-key/freshness;
and false-match rejection for known concentration/formulation, size, scent and pack.
The existing full category, tracking, manual-offer and Preview authorization suites
remain in the complete offline validation. Synthetic storage mutations are NOT
presented as a captured live Old Money response.

Existing legacy null records can be interpreted in memory if every remaining
required/provenance rule passes; no DB update is needed for that interpretation.
Records with different malformed types remain invalid and diagnostic-only. No
live success is claimed and no automatic refresh/backfill is added.

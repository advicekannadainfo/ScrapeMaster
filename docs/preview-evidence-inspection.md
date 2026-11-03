# One-product Preview evidence audit

Baseline a4c91bb. No live Product request or DB read was executed here: the cloud
executor has no MONGODB_URI, no env files and no Vercel account access.

Generation/persistence is intact in code: Flipkart Product API -> validated root
URL/provider identity, price/INR/stock -> selected-volume resolver -> canonical
identity + bound price observation. Mongoose declares both fields as Mixed.
trackProduct spreads scraped fields into findOneAndUpdate; refreshProduct sets
scraped fields then saves. No projection strips these fields on write. Offers
reads select them explicitly. Compare never backfills missing Product evidence.

Existing openProduct returns a found ID without fetching. Normal Track Price's
server action calls trackProduct then schedules updateOffers. Normal refresh can
send notifications and call updateOffers when stale. Product-page visits can call
refreshIfStale; cron is bulk. None is an isolated one-Product diagnostic action.
Also updatedAt is changed by comparison writes, so its recent value alone cannot
prove a recent Product fetch or metadata generation. Do not use ordinary page
visits, cron, Track Price or Refresh to enforce a one-request diagnostic budget.

With the current known Old Money title/brand/URL, a missing independently selected
quantity produces a valid partial canonical object with volume-unconfirmed, not
an absent field. Thus canonical-evidence-missing is not proof of the narrow volume
resolver failing. It can mean an older stored record, explicit null metadata,
invalid persisted schema/provenance, or an older deployment. Actual DB inspection
is needed to distinguish these; no root cause is invented without it.

A read-only endpoint is prepared: GET /api/preview/product-evidence?url=<encoded
exact Old Money Flipkart URL>. It requires VERCEL_ENV=preview and Authorization:
Bearer <server CRON_SECRET>. Missing secret fails closed; never put tokens in URL
or chat. It reports deployed Git SHA, canonical state (missing/null/valid/invalid),
validated issue codes, volume field provenance, observation presence/freshness
and field-presence booleans. It exposes no raw product values or subscribers.

It reads exactly one matching products document using a strict projection and a
native Mongo client, with retries disabled and no Mongoose schema/index setup.
There are no writes, provider calls, background jobs or refresh imports. Production
returns 404 before DB access. No endpoint call or database mutation was executed
while implementing/testing it. Tests mock all database access.

Next action is this protected read-only Preview inspection, not a paid refresh.
If fields are genuinely absent/incomplete and no captured response is available,
a new Product fetch may be necessary. Separate paid approval must precede it.
The future isolated path should resolve exactly the existing document, call only
its dedicated Product transport once (allowFallback=false,maxPaidRequests=1), parse
with the current adapter, and optionally update that same _id without upsert after
explicit refresh approval. It must bypass refreshProduct, track server actions,
notifications, compare/discovery and bulk jobs. Such a paid endpoint is deliberately
NOT armed by this read-only patch; no UI action here can initiate paid scraping.

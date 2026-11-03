# Post-tracking description and comparison presentation

Baseline d667ed0230c14569c8d3f43371eff5956b87bedd.

The Flipkart Product parser previously wrote URL/SKU/PID proof notes directly into
its description. New parsing accepts only genuine root description text, bounded
and filtered for HTML/credential-like/internal diagnostics; otherwise it returns
an honest unavailable-description message. The product page uses the same guard
for existing stored descriptions (including old Amazon/Myntra proof notes), without
mutating stored records. No fabricated marketing, highlights or variant text is
substituted. Tracking validation and product prices are unchanged.

Automatic Compare Stores already runs discoverOffers for other supported stores,
under its existing cache/budget/cooldown. A tracking-only Flipkart source remains
comparisonIdentityVerified=false because model or catalog-selection corroboration
is missing. Discovery therefore runs but its offers cannot pass the verification
gate. Category attributes and exact model/title/variant checks provide additional
constraints. Manual verification also rejects an unverified source; verifiedOffers
filters saved competitors again at render time. Existing stored offers are retained.

An independently tracked Amazon listing does not prove the Flipkart listing has
the same selected colour/configuration. No eligibility rule has been relaxed.
Existing validated model/selected-variant responses remain eligible under the
normal matcher. No new response shape, selected model, colour, identifier mapping
or price has been invented. Real ProClip model/selected-colour evidence remains
unavailable here. Synthetic independent-response tests demonstrate eligibility
only with explicit consistent main-product facts and reject model/colour changes.

The comparison UI now says "Exact matching offers not verified yet" when no verified
competitor is available. For an explicitly unverified source it explains that its
own product is tracked while other-store model/variant verification is pending,
rather than implying perpetual search. Search transport, query logic, paid request
counts/retries, cooldowns, manual links, persistence and offer merging are unchanged.

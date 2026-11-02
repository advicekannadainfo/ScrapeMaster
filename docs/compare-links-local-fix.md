# Compare Stores: candidate-link verification (local-only check)

Based on GitHub feature branch `fix/myntra-real-json-parser` commit `348bd5ca21d820fe98095833827d52753752978c` and the earlier untested manual-link draft. NOT A DEPLOYED OR BUILD-VERIFIED RELEASE.

## What this patch changes

- Keeps the existing automatic Compare Stores path and its 10-minute check cooldown.
- Adds a separate Verify Product Links action: up to two HTTPS Amazon India, Flipkart or Myntra product URLs; one paid Product API fetch maximum per eligible URL; no paid fallback.
- Stores a separate `candidateLinksCheckedAt` per tracked product to block duplicate concurrent manual paid calls and enforce its own 10-minute cooldown. The manual check does not move the automatic search timestamp.
- Merges freshly verified offers with prior valid offers by store instead of replacing all offers on manual failure. Subsequent automatic comparison retains manually confirmed offers for at most 24h, and newer automatic results take priority for the same store.
- Requires independent Product API response validation and matching brand + explicitly selected size + distinctive fragrance name for flexible cross-store perfume comparisons. Does not hardcode a specific product, URL or store price. Rejects unknown size, mismatched size, brand, model name or packs. Non-perfume matching remains strict.
- Saves offer brand and variant to support identity filtering on rendering.
- Extracts verified brand and product-title/selected-seller quantity from real Myntra Product API shape, rejecting conflicting quantities. Actual Myntra 30ml fixture is still missing, so its live parse remains unconfirmed.

## Checks run here

- 13 changed/new TypeScript/TSX files passed TypeScript parser/transpile syntax checks.
- 8 focused logic assertions passed via in-memory compilation: positive Amazon/Flipkart and Amazon/Myntra 30ml candidates, rejected 100ml/unrelated product, retained prior offers, refreshed per-store price, rejected bad persisted variant.
- Source fixture regression tests are added under `tests/`; Vitest suite was NOT executable here.
- `npm ci --offline` failed with ENOTCACHED (missing zod tarball); `npm ci` also failed due registry DNS resolution (`EAI_AGAIN`), preventing full typecheck/lint/Vitest/Next build. No live/paid ScrapingDog calls were made.

## Must verify before feature-branch Preview

On a Mac with Node.js 22 and npm registry access, run the included `VERIFY-LOCALLY.command` script (open a Terminal inside the extracted folder and enter `bash VERIFY-LOCALLY.command`). It records results in `MERIDEALS-LOCAL-VERIFY.log`. Alternatively, manually run:

```
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

If formatting check fails, format only modified files with Prettier, then rerun checks. Review added tests and tighten identity policy if real fixtures reveal ambiguities. Never push to `main` or enable scheduled paid refresh without explicit approval.

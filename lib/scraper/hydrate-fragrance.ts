import 'server-only';
import type { Offer } from '@/types';
import { verifiedOffers } from '@/lib/verified-offers';
import { highConfidenceOffers } from '@/lib/high-confidence-offers';
import {
  fragranceDecision,
  fragranceIdentity,
  independentFragrance,
  scentLine,
  readCanonicalIdentity,
} from './matching/fragrance';
import { identityKey } from './matching/observations';
import { enrichSearchFragranceIdentity } from './product-candidate-match';
import { categoryFor, titleAttributes } from './product-identity';
import { isAccessory, titleSimilarity } from './match';
import { resolveStore } from './stores';
import {
  verifyCandidateLinks,
  safeCandidateRejectionReason,
  type CandidateRejectionReason,
} from './verify-candidate-links';
import {
  previewBudgetActive,
  previewWebsiteBudgetActive,
} from './preview-provider-budget';

export const HYDRATION_FLAG = 'MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION';
export const MAX_HYDRATION_REQUESTS = 2;
const STORES = new Set(['amazon', 'flipkart', 'myntra.com']);
type Source = Parameters<typeof verifiedOffers>[0];
type Verification = Awaited<ReturnType<typeof verifyCandidateLinks>>;
export type HydrationDiagnostic = {
  status:
    | 'disabled'
    | 'source-evidence-missing'
    | 'unavailable'
    | 'no-candidate'
    | 'budget-exhausted'
    | 'product-verified'
    | 'product-high-confidence'
    | 'missing-provider-proof'
    | 'product-failed'
    | 'already-verified';
  searchCandidates: number;
  eligibleCandidates: number;
  productRequests: number;
  cacheHit: boolean;
  rejectionReason?: CandidateRejectionReason;
};
const cache = new Map<string, { until: number; pending: Promise<Verification> }>();

/** One shared reservation context per comparison. Flag must be exactly "true".
 * The returned function can try at most one URL/store; a failed URL is final.
 * No retries, pagination, fallback, refresh, notifications or database access. */
export function createFragranceHydrator(
  source: Source,
  options?: { previewDryRun?: true; allowHighConfidence?: true },
) {
  const dryRun =
    options?.previewDryRun === true &&
    process.env.VERCEL_ENV === 'preview' &&
    previewBudgetActive();
  const isolated = dryRun || previewWebsiteBudgetActive();
  const enabled = process.env[HYDRATION_FLAG] === 'true' || isolated;
  const storesUsed = new Set<string>();
  let requests = 0;
  return {
    enabled,
    async verify(
      store: string,
      listings: Offer[],
    ): Promise<{
      offer?: Offer;
      highConfidenceOffer?: Offer;
      diagnostic: HydrationDiagnostic;
    }> {
      const diagnostic: HydrationDiagnostic = {
        status: 'disabled',
        searchCandidates: Math.min(listings.length, 200),
        eligibleCandidates: 0,
        productRequests: 0,
        cacheHit: false,
      };
      const done = (
        status: HydrationDiagnostic['status'],
        offer?: Offer,
        rejectionReason?: CandidateRejectionReason,
      ) => ({
        offer,
        diagnostic: {
          ...diagnostic,
          status,
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      });
      if (!enabled) return done('disabled');
      const sourceIdentity = fragranceIdentity(source);
      const canonical = readCanonicalIdentity(source.canonicalIdentity);
      if (
        categoryFor(source.title) !== 'perfume' ||
        !sourceIdentity ||
        !canonical ||
        !independentFragrance(canonical)
      )
        return done('source-evidence-missing');
      if (
        !process.env.SCRAPINGDOG_API_KEY ||
        !STORES.has(store) ||
        store === source.store
      )
        return done('unavailable');
      const sourceAttributes = titleAttributes(`${source.title} ${source.variant ?? ''}`);
      const candidates = listings
        .slice(0, 200)
        .flatMap((listing, index) => {
          if (
            listing.store !== store ||
            listing.currency !== source.currency ||
            !Number.isFinite(listing.price) ||
            listing.price <= 0 ||
            listing.url.length > 2048 ||
            isAccessory(listing.title, source.title) ||
            /\b(pack of|combo|bundle|set of|refills?|testers?|samples?|gift sets?|miniatures?)\b/i.test(
              listing.title,
            ) ||
            !source.brand ||
            scentLine(listing.title, source.brand) !== sourceIdentity.line?.value
          )
            return [];
          const enriched = enrichSearchFragranceIdentity(source, listing);
          const attributes = titleAttributes(`${listing.title} ${listing.variant ?? ''}`);
          const decision = fragranceDecision(source, enriched);
          if (
            decision.status === 'mismatch' ||
            Object.entries(sourceAttributes).some(
              ([key, value]) => attributes[key] && attributes[key] !== value,
            )
          )
            return [];
          try {
            const url = new URL(listing.url);
            const adapter = resolveStore(url);
            if (
              url.protocol !== 'https:' ||
              url.username ||
              url.password ||
              url.port ||
              adapter.id !== store ||
              !adapter.productAPI?.matches(url)
            )
              return [];
            const normalized = adapter.normalize(url);
            return [
              {
                url: normalized,
                index,
                score:
                  (decision.status === 'verified' ? 2 : 0) +
                  titleSimilarity(source.title, listing.title),
              },
            ];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.score - a.score || a.index - b.index);
      diagnostic.eligibleCandidates = candidates.length;
      if (!candidates.length) return done('no-candidate');
      if (storesUsed.has(store)) return done('budget-exhausted');
      storesUsed.add(store);
      const target = candidates[0].url;
      // Include source identity AND price context: a cached rejection/price from a
      // different selected source must not be treated as evidence for this one.
      const key = JSON.stringify([
        source.url,
        identityKey(canonical),
        source.currentPrice,
        source.currency,
        store,
        target,
        options?.allowHighConfidence === true,
      ]);
      let entry = isolated ? undefined : cache.get(key);
      if (entry && entry.until > Date.now()) diagnostic.cacheHit = true;
      else {
        if (requests >= MAX_HYDRATION_REQUESTS) return done('budget-exhausted');
        requests++;
        diagnostic.productRequests = 1;
        entry = {
          until: Infinity, // coalesce pending work; TTL starts only after it settles
          pending: Promise.resolve().then(() =>
            options?.allowHighConfidence
              ? verifyCandidateLinks(source, [target], { allowHighConfidence: true })
              : verifyCandidateLinks(source, [target]),
          ),
        };
        const current = entry;
        current.pending = current.pending
          .then((result) => {
            current.until =
              Date.now() +
              (result.offers.length || result.highConfidenceOffers?.length
                ? 10 * 60_000
                : 60_000);
            return result;
          })
          .catch(() => {
            current.until = Date.now() + 60_000;
            return {
              offers: [],
              diagnostics: [
                { store, status: 'failed' as const, reason: 'provider-failure' as const },
              ],
            };
          });
        if (!isolated) {
          cache.set(key, current);
          if (cache.size > 200) cache.delete(cache.keys().next().value!);
        }
      }
      const result = await entry.pending;
      const offer = verifiedOffers(
        source,
        result.offers.filter((o) => o.store === store && o.url === target),
      )[0];
      if (offer) return done('product-verified', offer);
      if (options?.allowHighConfidence) {
        const candidate = highConfidenceOffers(
          source,
          (result.highConfidenceOffers ?? []).filter(
            (o) => o.store === store && o.url === target,
          ),
        )[0];
        if (candidate)
          return {
            highConfidenceOffer: candidate,
            diagnostic: { ...diagnostic, status: 'product-high-confidence' },
          };
      }
      const rejected = result.diagnostics.find((d) => d.status !== 'verified');
      const reason =
        safeCandidateRejectionReason(rejected?.reason) ??
        (result.offers.length &&
        !result.offers.some((o) => o.store === store && o.url === target)
          ? 'requested-url-mismatch'
          : 'post-verification-rejected');
      return done(
        result.diagnostics.some((d) => d.status === 'failed')
          ? 'product-failed'
          : 'missing-provider-proof',
        undefined,
        reason,
      );
    },
  };
}

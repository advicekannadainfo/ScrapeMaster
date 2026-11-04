import {
  readCanonicalIdentity,
  fragranceIdentity,
  independentFragrance,
} from './matching/fragrance';
import { categoryDecision } from './matching';
import { createFragranceHydrator, type HydrationDiagnostic } from './hydrate-fragrance';
import { profileOfferObservationStatus } from './matching/observations';
import { exactMatch, readExactEvidence } from './exact-evidence';
import {
  comparisonEvidenceState,
  comparisonFailureClass,
  type FailureClass,
} from './matching/reliability';
import { titleAttributes, categoryFor } from './product-identity';
import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { isAccessory, comparisonPriceStatus, titleSimilarity } from './match';
import { regionFromCurrency, searchableStores } from './stores';
import {
  comparisonSearchQuery,
  identityFieldsAgree,
  verifiedOffers,
  isVerifiedProductMatch,
  fragranceProductEvidenceMissing,
} from '@/lib/verified-offers';
import {
  enrichSearchFragranceIdentity,
  fragranceDiscoveryQuery,
} from './product-candidate-match';
import {
  discoverOffers,
  DISCOVERY_POOL_LIMIT,
  type DiscoveryObservation,
} from './discovery';

/**
 * Search every store that supports the product's region for the same item
 * and return the best-matching offer per store, cheapest first.
 */
export async function findOffersWithDiagnostics(
  product: Pick<
    ScrapedProduct,
    | 'title'
    | 'currency'
    | 'store'
    | 'storeName'
    | 'url'
    | 'currentPrice'
    | 'image'
    | 'brand'
    | 'variant'
    | 'comparisonIdentityVerified'
    | 'exactEvidence'
    | 'canonicalIdentity'
    | 'priceObservation'
  >,
) {
  const region = regionFromCurrency(product.currency);
  const query = fragranceDiscoveryQuery(product) ?? comparisonSearchQuery(product.title);
  const stores = searchableStores(region).filter((store) => store.id !== product.store);
  const hydrator = createFragranceHydrator(product);
  const diagnostics: {
    store: string;
    status: 'no-results' | 'rejected' | 'matched' | 'failed';
    candidates: number;
    verified: number;
    reason?: string;
    hydration?: HydrationDiagnostic;
    sourceEvidence?:
      'eligible' | 'selected-volume-unconfirmed' | 'selected-identity-unconfirmed';
    discovery?: DiscoveryObservation;
    rejections?: Record<string, number>;
    profile?: string;
    confidence?: string;
    sourceIndependentlyValidated?: boolean;
    sourceConfidence?: 'independent-main' | 'legacy-only' | 'insufficient-selected';
    sourceIssues?: string[];
    sourceVolumeEvidence?: { state: 'independent-selected' | 'missing'; field?: string };
    identityAssessment?: { verified: number; mismatch: number; insufficient: number };
    identityReasons?: Record<string, number>;
    failureClasses?: Partial<Record<FailureClass, number>>;
    sourceRecord?: ReturnType<typeof comparisonEvidenceState>;
    candidateEvidence?: {
      independentProduct: number;
      partialProduct: number;
      listingOnly: number;
      legacy: number;
      invalid: number;
    };
  }[] = [];

  const results = await Promise.allSettled(
    stores.map(async (adapter) => {
      let discovery: DiscoveryObservation | undefined;
      const offers = await discoverOffers(
        adapter,
        query,
        region,
        undefined,
        (result) => {
          discovery = result;
        },
        DISCOVERY_POOL_LIMIT,
      );
      const rejections: Record<string, number> = {};
      const identityAssessment = { verified: 0, mismatch: 0, insufficient: 0 };
      const identityReasons: Record<string, number> = {};
      const candidateEvidence = {
        independentProduct: 0,
        partialProduct: 0,
        listingOnly: 0,
        legacy: 0,
        invalid: 0,
      };
      const failureClasses: Partial<Record<FailureClass, number>> = {};
      const sourceCanonical = readCanonicalIdentity(product.canonicalIdentity);
      const sourceRecord = comparisonEvidenceState(product);
      const independent = sourceRecord.state === 'independent';
      const sourceEligible = product.comparisonIdentityVerified !== false || independent;
      const sourceEvidence = sourceEligible
        ? 'eligible'
        : categoryFor(product.title) === 'perfume' && product.brand && !product.variant
          ? 'selected-volume-unconfirmed'
          : 'selected-identity-unconfirmed';
      const ranked = offers
        .flatMap((original) => {
          const offer = enrichSearchFragranceIdentity(product, original);
          if (categoryFor(product.title) === 'perfume') {
            const e = readCanonicalIdentity(offer.canonicalIdentity);
            if (offer.canonicalIdentity == null) candidateEvidence.legacy++;
            else if (!e || !fragranceIdentity(offer)) candidateEvidence.invalid++;
            else if (e.source.kind === 'search') candidateEvidence.listingOnly++;
            else if (independentFragrance(e)) candidateEvidence.independentProduct++;
            else candidateEvidence.partialProduct++;
          }
          const profile = categoryDecision(product, offer);
          const a = titleAttributes(`${product.title} ${product.variant ?? ''}`),
            b = titleAttributes(`${offer.title} ${offer.variant ?? ''}`);
          const conflict =
            exactMatch(product.exactEvidence, offer.exactEvidence) === 'mismatch' ||
            !identityFieldsAgree(product, offer) ||
            Object.entries(a).some(([key, value]) => b[key] && b[key] !== value);
          let reason: string | undefined;
          let identityVerified = false;
          if (!sourceEligible) reason = 'insufficient-selected-identity';
          else if (isAccessory(offer.title, product.title)) reason = 'accessory-rejected';
          else if (profile?.status === 'mismatch' || conflict)
            reason = 'explicit-mismatch';
          else if (fragranceProductEvidenceMissing(product, offer))
            reason = 'insufficient-product-evidence';
          else if (profile) {
            identityVerified = isVerifiedProductMatch(product, offer);
            if (!identityVerified)
              reason =
                profile.status === 'verified'
                  ? 'render-identity-rejected'
                  : profile.reason === 'concentration-ambiguous' ||
                      profile.reason === 'declaration-conflict'
                    ? 'ambiguous-concentration'
                    : 'insufficient-identity';
          } else {
            // The final verifier already requires independently complete main
            // facts for the strong-ID route, and strict attributes for legacy
            // listings. Do not apply a different title/flag gate in discovery.
            identityVerified = isVerifiedProductMatch(product, offer);
            if (!identityVerified) reason = 'insufficient-identity';
          }
          const identityState = identityVerified
            ? 'verified'
            : reason === 'explicit-mismatch' || reason === 'accessory-rejected'
              ? 'mismatch'
              : 'insufficient';
          identityAssessment[identityState]++;
          const identityReason = identityVerified
            ? 'verified'
            : !sourceEligible
              ? 'source-selection-unconfirmed'
              : (profile?.reason ?? reason ?? 'identity-unconfirmed');
          identityReasons[identityReason] = (identityReasons[identityReason] ?? 0) + 1;
          // A price anomaly is reported only after identity is verified. It never
          // certifies a candidate and never triggers paid confirmation automatically.
          if (!reason) {
            const observation = profileOfferObservationStatus(offer);
            if (!identityVerified) reason = 'render-identity-rejected';
            else if (
              readExactEvidence(offer.exactEvidence)?.inStock === false ||
              observation === 'out-of-stock'
            )
              reason = 'stock-unavailable';
            else if (observation === 'invalid') reason = 'price-observation-invalid';
            else if (offer.currency !== product.currency) reason = 'currency-rejected';
            else {
              const price = comparisonPriceStatus(offer.price, product.currentPrice);
              if (price !== 'accepted')
                reason = profile
                  ? price
                  : price === 'price-anomaly'
                    ? 'price-rejected'
                    : price;
            }
          }
          if (!reason && !verifiedOffers(product, [offer]).length)
            reason =
              categoryFor(product.title) === 'perfume'
                ? 'price-observation-stale-or-missing'
                : 'render-identity-rejected';
          if (reason) {
            rejections[reason] = (rejections[reason] ?? 0) + 1;
            const failureClass = comparisonFailureClass(reason);
            failureClasses[failureClass] = (failureClasses[failureClass] ?? 0) + 1;
            return [];
          }
          return [
            {
              offer,
              score: titleSimilarity(product.title, offer.title),
              confidence:
                profile?.status === 'verified' ? 'category-exact' : 'legacy-strict',
            },
          ];
        })
        .sort((x, y) => y.score - x.score || x.offer.price - y.offer.price);
      let hydration: HydrationDiagnostic | undefined;
      if (hydrator.enabled && categoryFor(product.title) === 'perfume') {
        if (ranked.length)
          hydration = {
            status: 'already-verified',
            searchCandidates: offers.length,
            eligibleCandidates: 0,
            productRequests: 0,
            cacheHit: false,
          };
        else {
          const result = await hydrator.verify(adapter.id, offers);
          hydration = result.diagnostic;
          if (result.offer)
            ranked.push({ offer: result.offer, score: 1, confidence: 'category-exact' });
        }
      }
      diagnostics.push({
        ...(hydration ? { hydration } : {}),
        reason: !offers.length
          ? 'no-search-results'
          : ranked.length
            ? 'verified-competitor'
            : Object.keys(rejections).length === 1
              ? Object.keys(rejections)[0]
              : 'mixed-rejections',
        sourceEvidence,
        sourceRecord,
        ...(categoryFor(product.title) === 'perfume' ? { candidateEvidence } : {}),
        failureClasses: !offers.length
          ? { 'search-discovery-gap': 1 }
          : { ...failureClasses, ...(ranked.length ? { verified: ranked.length } : {}) },
        sourceIndependentlyValidated: independent,
        sourceConfidence: independent
          ? 'independent-main'
          : sourceEligible
            ? 'legacy-only'
            : 'insufficient-selected',
        sourceIssues: sourceCanonical?.issues ?? ['canonical-evidence-missing'],
        sourceVolumeEvidence: {
          state:
            sourceCanonical?.source.kind === 'product' && sourceCanonical.selected.volume
              ? 'independent-selected'
              : 'missing',
          ...(sourceCanonical?.source.kind === 'product' &&
          sourceCanonical.selected.volume
            ? { field: sourceCanonical.selected.volume.field }
            : {}),
        },
        identityAssessment,
        identityReasons,
        profile: categoryFor(product.title) === 'perfume' ? 'fragrance-v1' : 'legacy',
        confidence: ranked[0]?.confidence ?? 'none',
        discovery,
        rejections,
        store: adapter.id,
        status: !offers.length ? 'no-results' : !ranked.length ? 'rejected' : 'matched',
        candidates: offers.length,
        verified: ranked.length,
      });
      return ranked[0]?.offer;
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      // Store errors are independent: never erase valid offers from other stores.
      // Keep detailed provider errors in server logs, not customer-facing UI.
      const observedKind =
        r.reason && typeof r.reason === 'object' && 'kind' in r.reason
          ? String((r.reason as { kind: unknown }).kind)
          : r.reason instanceof Error
            ? r.reason.name
            : 'Unknown search failure';
      const reason = [
        'blocked',
        'rate-limited',
        'unavailable',
        'timeout',
        'not-found',
        'disallowed',
        'parse',
        'unsupported',
      ].includes(observedKind)
        ? observedKind
        : 'provider-search-failure';
      diagnostics.push({
        store: stores[i].id,
        status: 'failed',
        candidates: 0,
        verified: 0,
        reason,
        failureClasses: { [comparisonFailureClass(reason)]: 1 },
        sourceRecord: comparisonEvidenceState(product),
      });
    }
  });
  const found = results.flatMap((r) =>
    r.status === 'fulfilled' && r.value ? [r.value] : [],
  );
  const own: Offer = {
    store: product.store,
    storeName: product.storeName,
    title: product.title,
    url: product.url,
    price: product.currentPrice,
    currency: product.currency,
    image: product.image,
  };

  const byStore = new Map<string, Offer>([[own.store, own]]);
  for (const offer of found)
    if (!byStore.has(offer.store)) byStore.set(offer.store, offer);
  return {
    offers: [...byStore.values()].sort((a, b) => a.price - b.price),
    diagnostics: diagnostics.sort((a, b) => a.store.localeCompare(b.store)),
  };
}

/** Preserve the existing caller contract; diagnostics are opt-in and contain no secrets. */
export async function findOffers(
  product: Parameters<typeof findOffersWithDiagnostics>[0],
) {
  const result = await findOffersWithDiagnostics(product);
  // A failed source must not turn a partial comparison into a server error.
  // updateOffers() can still merge previously verified manual offers.
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.status === 'failed') {
      console.warn('[compare] Search failed', {
        store: diagnostic.store,
        reason: diagnostic.reason,
        failureClasses: diagnostic.failureClasses,
        sourceRecord: diagnostic.sourceRecord,
      });
    } else {
      console.info('[compare] Search result', {
        store: diagnostic.store,
        status: diagnostic.status,
        reason: diagnostic.reason,
        candidates: diagnostic.candidates,
        verified: diagnostic.verified,
        sourceEvidence: diagnostic.sourceEvidence,
        sourceIndependentlyValidated: diagnostic.sourceIndependentlyValidated,
        sourceConfidence: diagnostic.sourceConfidence,
        sourceIssues: diagnostic.sourceIssues,
        sourceVolumeEvidence: diagnostic.sourceVolumeEvidence,
        identityAssessment: diagnostic.identityAssessment,
        identityReasons: diagnostic.identityReasons,
        candidateEvidence: diagnostic.candidateEvidence,
        hydration: diagnostic.hydration,
        failureClasses: diagnostic.failureClasses,
        sourceRecord: diagnostic.sourceRecord,
        profile: diagnostic.profile,
        confidence: diagnostic.confidence,
        discovery: diagnostic.discovery,
        rejections: diagnostic.rejections,
      });
    }
  }
  return result.offers;
}

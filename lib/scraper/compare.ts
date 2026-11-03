import { readCanonicalIdentity, independentFragrance } from './matching/fragrance';
import { categoryDecision } from './matching';
import { compatibleAttributes, titleAttributes, categoryFor } from './product-identity';
import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { isAccessory, comparisonPriceStatus, titleSimilarity } from './match';
import { regionFromCurrency, searchableStores } from './stores';
import {
  isVerifiedMatch,
  comparisonSearchQuery,
  identityFieldsAgree,
  verifiedOffers,
  isVerifiedProductMatch,
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
  const diagnostics: {
    store: string;
    status: 'no-results' | 'rejected' | 'matched' | 'failed';
    candidates: number;
    verified: number;
    reason?: string;
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
      const sourceCanonical = readCanonicalIdentity(product.canonicalIdentity);
      const independent = independentFragrance(product.canonicalIdentity);
      const sourceEligible =
        product.comparisonIdentityVerified !== false ||
        independentFragrance(product.canonicalIdentity);
      const sourceEvidence = sourceEligible
        ? 'eligible'
        : categoryFor(product.title) === 'perfume' && product.brand && !product.variant
          ? 'selected-volume-unconfirmed'
          : 'selected-identity-unconfirmed';
      const ranked = offers
        .flatMap((original) => {
          const offer = enrichSearchFragranceIdentity(product, original);
          const profile = categoryDecision(product, offer);
          const a = titleAttributes(`${product.title} ${product.variant ?? ''}`),
            b = titleAttributes(`${offer.title} ${offer.variant ?? ''}`);
          const conflict =
            !identityFieldsAgree(product, offer) ||
            Object.entries(a).some(([key, value]) => b[key] && b[key] !== value);
          let reason: string | undefined;
          let identityVerified = false;
          if (!sourceEligible) reason = 'insufficient-selected-identity';
          else if (isAccessory(offer.title, product.title)) reason = 'accessory-rejected';
          else if (profile) {
            identityVerified = isVerifiedProductMatch(product, offer);
            if (!identityVerified)
              reason =
                profile.status === 'verified'
                  ? 'render-identity-rejected'
                  : profile.status === 'mismatch' || conflict
                    ? 'explicit-mismatch'
                    : profile.reason === 'concentration-ambiguous' ||
                        profile.reason === 'declaration-conflict'
                      ? 'ambiguous-concentration'
                      : 'insufficient-identity';
          } else if (conflict) reason = 'explicit-mismatch';
          else if (!(
            compatibleAttributes(product, offer) &&
            (isVerifiedMatch(product, offer) || offer !== original)
          ))
            reason = 'insufficient-identity';
          else identityVerified = isVerifiedProductMatch(product, offer);
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
            if (!identityVerified) reason = 'render-identity-rejected';
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
            reason = 'render-identity-rejected';
          if (reason) {
            rejections[reason] = (rejections[reason] ?? 0) + 1;
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
      diagnostics.push({
        reason: !offers.length
          ? 'no-search-results'
          : ranked.length
            ? 'verified-competitor'
            : Object.keys(rejections).length === 1
              ? Object.keys(rejections)[0]
              : 'mixed-rejections',
        sourceEvidence,
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
      diagnostics.push({
        store: stores[i].id,
        status: 'failed',
        candidates: 0,
        verified: 0,
        reason: [
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
          : 'provider-search-failure',
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
        profile: diagnostic.profile,
        confidence: diagnostic.confidence,
        discovery: diagnostic.discovery,
        rejections: diagnostic.rejections,
      });
    }
  }
  return result.offers;
}

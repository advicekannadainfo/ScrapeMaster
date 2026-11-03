import { independentFragrance } from './matching/fragrance';
import { categoryDecision } from './matching';
import { compatibleAttributes, titleAttributes, categoryFor } from './product-identity';
import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { isAccessory, isPlausiblePrice, titleSimilarity } from './match';
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
          if (!sourceEligible) reason = 'insufficient-selected-identity';
          else if (offer.currency !== product.currency) reason = 'currency-rejected';
          else if (isAccessory(offer.title, product.title)) reason = 'accessory-rejected';
          else if (!isPlausiblePrice(offer.price, product.currentPrice))
            reason = 'price-rejected';
          else if (profile) {
            reason = isVerifiedProductMatch(product, offer)
              ? undefined
              : profile.status === 'verified'
                ? 'render-identity-rejected'
                : profile.status === 'mismatch'
                  ? 'explicit-mismatch'
                  : profile.reason === 'concentration-ambiguous' ||
                      profile.reason === 'declaration-conflict'
                    ? 'ambiguous-concentration'
                    : conflict
                      ? 'explicit-mismatch'
                      : 'insufficient-identity';
          } else if (conflict) reason = 'explicit-mismatch';
          else if (!(
            compatibleAttributes(product, offer) &&
            (isVerifiedMatch(product, offer) || offer !== original)
          ))
            reason = 'insufficient-identity';
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
        sourceIndependentlyValidated: independentFragrance(product.canonicalIdentity),
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
        profile: diagnostic.profile,
        confidence: diagnostic.confidence,
        discovery: diagnostic.discovery,
        rejections: diagnostic.rejections,
      });
    }
  }
  return result.offers;
}

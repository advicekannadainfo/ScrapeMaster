import { categoryDecision } from './scraper/matching';
import {
  freshProfilePrice,
  profileOfferObservationStatus,
} from './scraper/matching/observations';
import {
  exactMatch,
  freshSavedPrice,
  readExactEvidence,
  recordExactEvidence,
} from './scraper/exact-evidence';
import { compatibleAttributes, normalizedValue } from './scraper/product-identity';
import type { Offer } from '@/types';
import { isAccessory, comparisonPriceStatus } from './scraper/match';
import { matchingFetchedFragrance } from './scraper/product-candidate-match';
import { independentFragrance } from './scraper/matching/fragrance';
import { categoryFor } from './scraper/product-identity';

/** Candidate compatibility alone is not independent selected-Product proof. */
export function fragranceProductEvidenceMissing(
  source: MatchIdentity,
  candidate?: MatchIdentity,
) {
  if (
    categoryFor(source.title) !== 'perfume' &&
    (!candidate || categoryFor(candidate.title) !== 'perfume')
  )
    return false;
  return (
    !independentFragrance(source.canonicalIdentity) ||
    (candidate !== undefined && !independentFragrance(candidate.canonicalIdentity))
  );
}

export type MatchIdentity = {
  canonicalIdentity?: unknown;
  priceObservation?: unknown;
  url?: string;
  store?: string;
  currentPrice?: number;
  price?: number;
  currency?: string;
  exactEvidence?: unknown;
  comparisonIdentityVerified?: boolean;
  title: string;
  brand?: string;
  model?: string;
  variant?: string;
  gtin?: string;
  mpn?: string;
};

/** Flexible category matching must never override contradictory identifiers. */
export function identityFieldsAgree(source: MatchIdentity, candidate: MatchIdentity) {
  return (['brand', 'model', 'variant', 'gtin', 'mpn'] as const).every((key) => {
    const left = source[key],
      right = candidate[key];
    if (!left || !right) return true;
    const normalize = (value: string) =>
      key === 'brand'
        ? value.toLowerCase().replace(/[^a-z0-9]/g, '')
        : normalizedValue(value);
    return normalize(left) === normalize(right);
  });
}

// Marketing/category words provide no evidence that two listings are identical.
// Preserve names, colours, model suffixes, quantities and concentration variants.
const NOISE = new Set(
  (
    'the and for with from of in on by to a an at or buy online best price new original genuine india warranty offer deal ' +
    'premium long lasting longlasting perfume fragrance perfumes wireless bluetooth smartphone mobile phone device ' +
    'headphones headphone ear over mic microphone clear calling active noise cancelling cancellation ' +
    'ergonomic optical ultra fast scrolling edition storage'
  ).split(' '),
);

function words(title: string) {
  return title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/eau\s+de\s+parfum/g, 'edp')
    .replace(/eau\s+de\s+toilette/g, 'edt')
    .replace(
      /(\d+(?:\.\d+)?)\s*(millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|kilograms?|kg|grams?|g)\b/g,
      (_, value, unit: string) => {
        const volume = /^(ml|mill|l|lit)/.test(unit);
        const multiplier =
          /^(l|lit|kg|kilogram)/.test(unit) && !unit.startsWith('mill') ? 1000 : 1;
        return `${Number(value) * multiplier}${volume ? 'ml' : 'g'}`;
      },
    )
    .replace(/(\d+)\s+(gb|tb|mah|w|hz|mm|inch|hr)\b/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w));
}

/** Keep distinctive identity and quantity instead of truncating to eight words. */
export function comparisonSearchQuery(title: string) {
  return words(title).join(' ');
}

/** Conservative title evidence. Missing details do not prove an exact match. */
export function isVerifiedMatch(source: MatchIdentity, candidate: MatchIdentity) {
  if (
    source.comparisonIdentityVerified === false ||
    candidate.comparisonIdentityVerified === false
  )
    return false;
  if (!compatibleAttributes(source, candidate)) return false;
  for (const key of ['brand', 'model', 'variant', 'gtin', 'mpn'] as const) {
    if (
      source[key] &&
      candidate[key] &&
      source[key]!.trim().toLowerCase() !== candidate[key]!.trim().toLowerCase()
    )
      return false;
  }
  if (
    isAccessory(candidate.title, source.title) ||
    isAccessory(source.title, candidate.title)
  )
    return false;
  const a = words(source.title),
    b = words(candidate.title);
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return false;
  const x = new Set(a),
    y = new Set(b);
  return x.size === y.size && [...x].every((w) => y.has(w));
}

/** Discovery may use a partial query, but every distinctive query word must occur. */
export function matchesDiscoveryQuery(query: string, title: string) {
  const q = words(query),
    t = new Set(words(title));
  return q.length >= 2 && q.every((word) => t.has(word));
}

type Source = MatchIdentity & {
  url: string;
  store: string;
  currency: string;
  currentPrice: number;
  offers?: Offer[];
  isOutOfStock?: boolean;
};

/** Recheck persisted offers at render time; never mutate the database or source. */
/** Exact title checks for search; independently fetched same-size fragrance pages may
 * additionally use explicit brand, selected variant and full scent-name evidence. */
// Pair compatibility is not permission to display a fragrance price: callers
// must use verifiedOffers for independent Product proof and observation freshness.
export function isVerifiedProductMatch(source: MatchIdentity, candidate: MatchIdentity) {
  const consistent = (identity: MatchIdentity) =>
    identity.exactEvidence == null || Boolean(recordExactEvidence(identity));
  if (!consistent(source) || !consistent(candidate)) return false;
  if (
    ['model', 'mpn', 'gtin'].some((field) => {
      const key = field as 'model' | 'mpn' | 'gtin';
      return (
        source[key] &&
        candidate[key] &&
        normalizedValue(source[key]!) !== normalizedValue(candidate[key]!)
      );
    })
  )
    return false;
  const decision = exactMatch(source.exactEvidence, candidate.exactEvidence);
  if (decision === 'mismatch') return false;
  const profile = categoryDecision(source, candidate);
  if (profile)
    return (
      identityFieldsAgree(source, candidate) &&
      !isAccessory(source.title, candidate.title) &&
      !isAccessory(candidate.title, source.title) &&
      (profile.status === 'verified' ||
        (source.canonicalIdentity == null &&
          candidate.canonicalIdentity == null &&
          isVerifiedMatch(source, candidate)))
    );
  if (decision === 'verified')
    return (
      !isAccessory(source.title, candidate.title) &&
      !isAccessory(candidate.title, source.title) &&
      ['pro', 'plus', 'max', 'ultra', 'lite'].every(
        (word) =>
          source.title
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .includes(word) ===
          candidate.title
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .includes(word),
      )
    );
  if (
    source.comparisonIdentityVerified === false ||
    candidate.comparisonIdentityVerified === false
  )
    return false;
  if (!identityFieldsAgree(source, candidate)) return false;
  return (
    isVerifiedMatch(source, candidate) ||
    (compatibleAttributes(source, candidate) &&
      !isAccessory(candidate.title, source.title) &&
      !isAccessory(source.title, candidate.title) &&
      matchingFetchedFragrance(source, candidate))
  );
}

export function verifiedOffers(
  product: Source,
  candidates: Offer[] = product.offers ?? [],
) {
  return candidates
    .filter((offer) => {
      if (
        !Number.isFinite(offer.price) ||
        offer.price <= 0 ||
        offer.currency !== product.currency
      )
        return false;
      if (
        offer.store !== product.store &&
        readExactEvidence(offer.exactEvidence)?.inStock === false
      )
        return false;
      if (
        offer.store !== product.store &&
        ['invalid', 'out-of-stock'].includes(profileOfferObservationStatus(offer))
      )
        return false;
      try {
        if (!['http:', 'https:'].includes(new URL(offer.url).protocol)) return false;
      } catch {
        return false;
      }
      if (offer.savedTrackedProduct) {
        const sourceFresh =
          product.canonicalIdentity != null
            ? freshProfilePrice(product)
            : freshSavedPrice(product);
        const candidate = {
          title: offer.title,
          brand: offer.brand,
          variant: offer.variant,
          url: offer.url,
          store: offer.store,
          currentPrice: offer.price,
          currency: offer.currency,
          isOutOfStock: false,
          canonicalIdentity: offer.canonicalIdentity,
          priceObservation: offer.priceObservation,
          exactEvidence: offer.exactEvidence,
        };
        const candidateFresh =
          offer.canonicalIdentity != null
            ? freshProfilePrice(candidate)
            : freshSavedPrice(candidate);
        if (!sourceFresh || !candidateFresh) return false;
      }
      if (offer.store === product.store) {
        return (
          offer.url === product.url &&
          offer.title === product.title &&
          offer.price === product.currentPrice
        );
      }
      if (fragranceProductEvidenceMissing(product, offer)) return false;
      if (
        categoryFor(product.title) === 'perfume' ||
        categoryFor(offer.title) === 'perfume'
      ) {
        if (
          categoryDecision(product, offer)?.reason === 'independent-package-evidence' &&
          !freshProfilePrice(product)
        )
          return false;
        if (
          profileOfferObservationStatus(offer) !== 'consistent' ||
          !freshProfilePrice({
            ...offer,
            currentPrice: offer.price,
            isOutOfStock: false,
          })
        )
          return false;
      }
      return (
        isVerifiedProductMatch(product, offer) &&
        comparisonPriceStatus(offer.price, product.currentPrice) === 'accepted'
      );
    })
    .sort((a, b) => a.price - b.price);
}

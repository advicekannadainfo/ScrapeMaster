import type { Offer } from '@/types';
import { identityFieldsAgree } from './verified-offers';
import { exactMatch, recordExactEvidence } from './scraper/exact-evidence';
import { categoryFor } from './scraper/product-identity';
import {
  fragranceIdentity,
  independentFragrance,
  fragranceDecision,
} from './scraper/matching/fragrance';
import {
  freshProfilePrice,
  profileOfferObservationStatus,
} from './scraper/matching/observations';
import { isAccessory, isPlausiblePrice } from './scraper/match';

type Record = {
  title: string;
  brand?: string;
  variant?: string;
  url?: string;
  store: string;
  currency: string;
  currentPrice: number;
  isOutOfStock?: boolean;
  canonicalIdentity?: unknown;
  priceObservation?: unknown;
  exactEvidence?: unknown;
};
/** Separately labelled confidence, NEVER an exact-pack verification or link.
 * Unknown optional metadata is not filled. Every displayed price still needs
 * its own fresh, in-stock, URL-bound Product observation. No provider calls. */
export function highConfidenceProductMatch(source: Record, candidate: Record) {
  if (
    !source.url ||
    !candidate.url ||
    source.store === candidate.store ||
    source.url === candidate.url ||
    source.currency !== '₹' ||
    candidate.currency !== '₹' ||
    source.isOutOfStock !== false ||
    candidate.isOutOfStock !== false ||
    categoryFor(source.title) !== 'perfume' ||
    categoryFor(candidate.title) !== 'perfume' ||
    !independentFragrance(source.canonicalIdentity) ||
    !independentFragrance(candidate.canonicalIdentity) ||
    !freshProfilePrice({ ...source, url: source.url }) ||
    !freshProfilePrice({ ...candidate, url: candidate.url }) ||
    !identityFieldsAgree(source, candidate) ||
    isAccessory(source.title, candidate.title) ||
    isAccessory(candidate.title, source.title) ||
    !isPlausiblePrice(candidate.currentPrice, source.currentPrice)
  )
    return false;
  if (
    (source.exactEvidence != null && !recordExactEvidence(source)) ||
    (candidate.exactEvidence != null && !recordExactEvidence(candidate)) ||
    exactMatch(source.exactEvidence, candidate.exactEvidence) === 'mismatch'
  )
    return false;
  const a = fragranceIdentity(source),
    b = fragranceIdentity(candidate);
  if (
    !a ||
    !b ||
    a.source?.kind !== 'product' ||
    b.source?.kind !== 'product' ||
    a.brand.value !== b.brand.value ||
    !a.line ||
    !b.line ||
    a.line.value !== b.line.value ||
    !a.selected.volume ||
    !b.selected.volume ||
    a.selected.volume.scope !== 'selected' ||
    b.selected.volume.scope !== 'selected' ||
    a.selected.volume.value !== b.selected.volume.value ||
    a.context?.risk ||
    b.context?.risk ||
    a.issues.length ||
    b.issues.length ||
    a.negated.length ||
    b.negated.length ||
    fragranceDecision(source, candidate).status === 'mismatch'
  )
    return false;
  if ([a.selected.pack, b.selected.pack].some((p) => p && p.value !== '1')) return false;
  for (const key of ['concentration', 'edition'] as const) {
    if (a.selected[key]?.value !== b.selected[key]?.value) return false;
  }
  const x = a.selected.formulation,
    y = b.selected.formulation;
  if (x && y && x.value !== y.value) return false;
  if (Boolean(x) !== Boolean(y)) {
    const known = x ? a : b,
      unknown = x ? b : a;
    if (
      known.selected.formulation?.value !== 'perfume-oil' ||
      known.selected.formulation.field !==
        'product_information.Fragrance Concentration' ||
      known.context?.formulation?.value !== 'concentration-label-only' ||
      unknown.context?.formulation?.value !== 'parfum-strength'
    )
      return false;
  }
  return true;
}

export function highConfidenceOffers(source: Record, offers: Offer[] = []) {
  return offers
    .filter(
      (o) =>
        o.matchConfidence === 'high-confidence' &&
        profileOfferObservationStatus(o) === 'consistent' &&
        highConfidenceProductMatch(source, {
          ...o,
          currentPrice: o.price,
          isOutOfStock: false,
        }),
    )
    .sort((a, b) => a.price - b.price);
}

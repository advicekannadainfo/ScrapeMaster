import {
  readExactEvidence,
  recordExactEvidence,
  sufficientExactEvidence,
} from '../exact-evidence';
import { categoryFor } from '../product-identity';
import {
  fragranceIdentity,
  independentFragrance,
  readCanonicalIdentity,
} from './fragrance';
import { freshProfilePrice } from './observations';
import { freshSavedPrice } from '../exact-evidence';
import type { MatchIdentity } from '@/lib/verified-offers';

export type FailureClass =
  | 'verified'
  | 'wrong-product'
  | 'missing-api-evidence'
  | 'parser-gap'
  | 'saved-record-invalid'
  | 'saved-price-unavailable'
  | 'search-discovery-gap'
  | 'price-anomaly'
  | 'stock-unavailable'
  | 'provider-failure';

/** Stable bounded classes for logs; never include error messages or values. */
export function comparisonFailureClass(reason: string): FailureClass {
  if (reason === 'verified-competitor') return 'verified';
  if (['explicit-mismatch', 'accessory-rejected', 'currency-rejected'].includes(reason))
    return 'wrong-product';
  if (
    [
      'price-anomaly',
      'price-rejected',
      'invalid-price',
      'price-observation-invalid',
    ].includes(reason)
  )
    return 'price-anomaly';
  if (reason === 'parse') return 'parser-gap';
  if (reason === 'stock-unavailable') return 'stock-unavailable';
  if (reason === 'no-search-results') return 'search-discovery-gap';
  if (reason === 'source-record-invalid') return 'saved-record-invalid';
  if (reason === 'source-price-unavailable-or-stale') return 'saved-price-unavailable';
  if (
    [
      'blocked',
      'rate-limited',
      'unavailable',
      'timeout',
      'not-found',
      'disallowed',
      'unsupported',
      'provider-search-failure',
    ].includes(reason)
  )
    return 'provider-failure';
  return 'missing-api-evidence';
}

/** Report structural state separately from legacy eligibility and price age.
 * This is read-only and does not make a new category eligible for comparison. */
export function comparisonEvidenceState(
  record: MatchIdentity & { isOutOfStock?: boolean },
) {
  const category = categoryFor(record.title);
  const canonical = record.canonicalIdentity;
  const exact = record.exactEvidence;
  let state: 'missing' | 'invalid' | 'partial' | 'independent' | 'binding-conflict' =
    'missing';
  if (canonical != null) {
    const e = readCanonicalIdentity(canonical);
    state = !e
      ? 'invalid'
      : !fragranceIdentity(record)
        ? 'binding-conflict'
        : independentFragrance(e)
          ? 'independent'
          : 'partial';
  } else if (exact != null) {
    const e = readExactEvidence(exact);
    state = !e
      ? 'invalid'
      : !recordExactEvidence(record)
        ? 'binding-conflict'
        : sufficientExactEvidence(e)
          ? 'independent'
          : 'partial';
  }
  const bound =
    record.url &&
    record.store &&
    record.currency &&
    (record.currentPrice ?? record.price) !== undefined;
  const priceRecord = bound
    ? {
        ...record,
        url: record.url!,
        store: record.store!,
        currency: record.currency!,
        currentPrice: (record.currentPrice ?? record.price)!,
      }
    : undefined;
  const fresh =
    priceRecord &&
    (canonical != null ? freshProfilePrice(priceRecord) : freshSavedPrice(priceRecord));
  return {
    category,
    state,
    savedPrice: !bound
      ? ('not-assessed' as const)
      : fresh
        ? ('fresh-bound' as const)
        : ('unavailable-or-stale' as const),
  };
}

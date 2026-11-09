import { independentFragrance } from './matching/fragrance';
import { sufficientExactEvidence } from './exact-evidence';
import { freshProfilePrice } from './matching/observations';
import { categoryFor } from './product-identity';
import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import {
  isVerifiedProductMatch,
  fragranceProductEvidenceMissing,
} from '@/lib/verified-offers';
import { isPlausiblePrice } from './match';
import { scrapeProduct } from './index';
import { resolveStore } from './stores';
import { categoryDecision } from './matching';
import { readCanonicalIdentity } from './matching/fragrance';
import { ScrapeError } from './errors';

/** A deliberately small, explicit per-click budget. Never attempt arbitrary hosts. */
const SUPPORTED = new Set(['amazon', 'flipkart', 'myntra.com']);
export const MAX_CANDIDATE_LINKS = 2;

const REJECTION_REASONS = [
  'source-evidence-missing',
  'invalid-url',
  'unsupported-store',
  'duplicate-url',
  'product-missing',
  'out-of-stock',
  'currency-mismatch',
  'invalid-price',
  'missing-selected-size',
  'missing-product-evidence',
  'identity-mismatch',
  'formulation-conflict',
  'formulation-unconfirmed',
  'concentration-conflict',
  'concentration-unconfirmed',
  'pack-conflict',
  'pack-unconfirmed',
  'variant-mismatch',
  'stale-or-unbound-price',
  'price-anomaly',
  'provider-failure',
  'provider-parse-failure',
  'requested-url-mismatch',
  'post-verification-rejected',
] as const;
export type CandidateRejectionReason = (typeof REJECTION_REASONS)[number];
export function safeCandidateRejectionReason(
  value: unknown,
): CandidateRejectionReason | undefined {
  return typeof value === 'string' &&
    (REJECTION_REASONS as readonly string[]).includes(value)
    ? (value as CandidateRejectionReason)
    : undefined;
}
export type LinkResult = {
  store: string;
  status: 'verified' | 'rejected' | 'failed';
  reason?: CandidateRejectionReason;
};
function identityRejectionReason(
  source: Parameters<typeof isVerifiedProductMatch>[0],
  candidate: Parameters<typeof isVerifiedProductMatch>[1],
): CandidateRejectionReason {
  const profile = categoryDecision(source, candidate);
  const specific = safeCandidateRejectionReason(profile?.reason);
  if (specific) return specific;
  if (profile?.reason === 'volume-conflict' || profile?.reason === 'edition-conflict')
    return 'variant-mismatch';
  if (profile) {
    const e = readCanonicalIdentity(candidate.canonicalIdentity);
    if (e?.source.kind === 'product' && !e.selected.volume)
      return 'missing-selected-size';
    if (!independentFragrance(candidate.canonicalIdentity))
      return 'missing-product-evidence';
  }
  return 'identity-mismatch';
}
export async function verifyCandidateLinks(
  source: Pick<
    ScrapedProduct,
    | 'title'
    | 'brand'
    | 'variant'
    | 'currency'
    | 'currentPrice'
    | 'store'
    | 'comparisonIdentityVerified'
    | 'exactEvidence'
    | 'canonicalIdentity'
    | 'priceObservation'
  >,
  links: string[],
): Promise<{ offers: Offer[]; diagnostics: LinkResult[] }> {
  if (links.length > MAX_CANDIDATE_LINKS)
    throw new Error('Maximum two candidate links per check');
  if (
    fragranceProductEvidenceMissing(source) ||
    (source.comparisonIdentityVerified === false &&
      !sufficientExactEvidence(source.exactEvidence) &&
      !independentFragrance(source.canonicalIdentity))
  )
    return {
      offers: [],
      diagnostics: links.map(() => ({
        store: 'unknown',
        status: 'rejected' as const,
        reason: 'source-evidence-missing' as const,
      })),
    };
  const seen = new Set<string>();
  const tasks = links.map(
    async (input): Promise<{ offer?: Offer; result: LinkResult }> => {
      let store = 'unknown';
      let productAttempted = false;
      try {
        const url = new URL(input.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.port)
          return { result: { store, status: 'rejected', reason: 'invalid-url' } };
        const adapter = resolveStore(url);
        store = adapter.id;
        if (
          !SUPPORTED.has(store) ||
          store === source.store ||
          !adapter.productAPI?.matches(url)
        )
          return { result: { store, status: 'rejected', reason: 'unsupported-store' } };
        const normalized = adapter.normalize(url);
        if (seen.has(normalized))
          return { result: { store, status: 'rejected', reason: 'duplicate-url' } };
        seen.add(normalized);
        // One paid product request maximum per URL, with no paid fallback.
        productAttempted = true;
        const candidate = await scrapeProduct(normalized, {
          allowFallback: false,
          maxPaidRequests: 1,
        });
        // Same predicate order and acceptance conditions as before; report only
        // the first failed check. Never expose values, URLs or exception text.
        let reason: CandidateRejectionReason | undefined;
        if (!candidate) reason = 'product-missing';
        else if (candidate.isOutOfStock) reason = 'out-of-stock';
        else if (candidate.currency !== source.currency) reason = 'currency-mismatch';
        else if (!Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0)
          reason = 'invalid-price';
        else if (!isVerifiedProductMatch(source, candidate))
          reason = identityRejectionReason(source, candidate);
        else if (fragranceProductEvidenceMissing(source, candidate))
          reason = identityRejectionReason(source, candidate);
        else if (categoryFor(source.title) === 'perfume' && !freshProfilePrice(candidate))
          reason = 'stale-or-unbound-price';
        else if (!isPlausiblePrice(candidate.currentPrice, source.currentPrice))
          reason = 'price-anomaly';
        if (reason || !candidate)
          return { result: { store, status: 'rejected', reason } };
        return {
          offer: {
            exactEvidence: candidate.exactEvidence,
            canonicalIdentity: candidate.canonicalIdentity,
            priceObservation: candidate.priceObservation,
            brand: candidate.brand,
            variant: candidate.variant,
            store: candidate.store,
            storeName: candidate.storeName,
            title: candidate.title,
            url: candidate.url,
            price: candidate.currentPrice,
            originalPrice: candidate.originalPrice,
            currency: candidate.currency,
            image: candidate.image,
          },
          result: { store, status: 'verified' },
        };
      } catch (error) {
        return {
          result: {
            store,
            status: 'failed',
            reason: !productAttempted
              ? 'invalid-url'
              : error instanceof ScrapeError && error.kind === 'parse'
                ? 'provider-parse-failure'
                : 'provider-failure',
          },
        };
      }
    },
  );
  const results = await Promise.all(tasks);
  return {
    offers: results.flatMap(({ offer }) => (offer ? [offer] : [])),
    diagnostics: results.map(({ result }) => result),
  };
}

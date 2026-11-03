import { independentFragrance } from './matching/fragrance';
import { sufficientExactEvidence } from './exact-evidence';
import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { isVerifiedProductMatch } from '@/lib/verified-offers';
import { isPlausiblePrice } from './match';
import { scrapeProduct } from './index';
import { resolveStore } from './stores';

/** A deliberately small, explicit per-click budget. Never attempt arbitrary hosts. */
const SUPPORTED = new Set(['amazon', 'flipkart', 'myntra.com']);
export const MAX_CANDIDATE_LINKS = 2;

export type LinkResult = { store: string; status: 'verified' | 'rejected' | 'failed' };
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
    source.comparisonIdentityVerified === false &&
    !sufficientExactEvidence(source.exactEvidence) &&
    !independentFragrance(source.canonicalIdentity)
  )
    return {
      offers: [],
      diagnostics: links.map(() => ({ store: 'unknown', status: 'rejected' as const })),
    };
  const seen = new Set<string>();
  const tasks = links.map(
    async (input): Promise<{ offer?: Offer; result: LinkResult }> => {
      let store = 'unknown';
      try {
        const url = new URL(input.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.port)
          return { result: { store, status: 'rejected' } };
        const adapter = resolveStore(url);
        store = adapter.id;
        if (
          !SUPPORTED.has(store) ||
          store === source.store ||
          !adapter.productAPI?.matches(url)
        )
          return { result: { store, status: 'rejected' } };
        const normalized = adapter.normalize(url);
        if (seen.has(normalized)) return { result: { store, status: 'rejected' } };
        seen.add(normalized);
        // One paid product request maximum per URL, with no paid fallback.
        const candidate = await scrapeProduct(normalized, {
          allowFallback: false,
          maxPaidRequests: 1,
        });
        if (
          !candidate ||
          candidate.isOutOfStock ||
          candidate.currency !== source.currency ||
          !Number.isFinite(candidate.currentPrice) ||
          candidate.currentPrice <= 0 ||
          !isVerifiedProductMatch(source, candidate) ||
          !isPlausiblePrice(candidate.currentPrice, source.currentPrice)
        )
          return { result: { store, status: 'rejected' } };
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
      } catch {
        return { result: { store, status: 'failed' } };
      }
    },
  );
  const results = await Promise.all(tasks);
  return {
    offers: results.flatMap(({ offer }) => (offer ? [offer] : [])),
    diagnostics: results.map(({ result }) => result),
  };
}

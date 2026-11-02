import 'server-only';
import type { Offer } from '@/types';
import ProductModel from '@/lib/models/product.model';
import { findOffers } from '@/lib/scraper/compare';
import { verifiedOffers } from '@/lib/verified-offers';
import {
  verifyCandidateLinks,
  MAX_CANDIDATE_LINKS,
  type LinkResult,
} from '@/lib/scraper/verify-candidate-links';

export const OFFERS_TTL_MS = 24 * 60 * 60 * 1000;

/** Existing automatic discovery route stays unchanged. */
export async function updateOffers(id: string) {
  const product = await ProductModel.findById(id)
    .select('title currency store storeName url currentPrice image brand variant')
    .lean();
  if (!product) return [];
  const discovered = await findOffers({
    ...product,
    image: product.image ?? undefined,
    brand: product.brand ?? undefined,
    variant: product.variant ?? undefined,
  });
  // Preserve independently verified manual offers during a subsequent auto-search,
  // but only while their separate last-check timestamp is still fresh.
  const latest = await ProductModel.findById(id)
    .select(
      'title currency store storeName url currentPrice image brand variant offers candidateLinksCheckedAt',
    )
    .lean();
  if (!latest) return discovered;
  const source = {
    ...latest,
    image: latest.image ?? undefined,
    brand: latest.brand ?? undefined,
    variant: latest.variant ?? undefined,
    // Mongoose lean offers may contain nullable brand/variant/image; normalize
    // before passing them into our strict Offer matching functions.
    offers: (latest.offers ?? []).map((offer) => ({
      ...offer,
      brand: offer.brand ?? undefined,
      variant: offer.variant ?? undefined,
      image: offer.image ?? undefined,
    })),
  };
  const manualIsFresh = Boolean(
    latest.candidateLinksCheckedAt &&
    Date.now() - new Date(latest.candidateLinksCheckedAt).getTime() < OFFERS_TTL_MS,
  );
  const earlier = manualIsFresh
    ? latest.offers
        .filter((offer) => offer.brand && offer.variant)
        .map((offer) => ({
          ...offer,
          brand: offer.brand ?? undefined,
          variant: offer.variant ?? undefined,
          image: offer.image ?? undefined,
        }))
    : [];
  const storedManual = verifiedOffers(source, earlier);
  // New automatic search wins over older manual prices for the same store.
  const offers = mergeVerifiedCandidateOffers(source, [...storedManual, ...discovered]);
  await ProductModel.updateOne(
    { _id: id },
    { $set: { offers, offersCheckedAt: new Date() } },
  );
  return offers;
}

/** Merge only freshly verified URLs, never replace valid existing store offers on failure. */
export function mergeVerifiedCandidateOffers(
  product: {
    title: string;
    brand?: string;
    variant?: string;
    store: string;
    storeName: string;
    url: string;
    currency: string;
    currentPrice: number;
    image?: string;
    offers?: Offer[];
  },
  incoming: Offer[],
): Offer[] {
  const own: Offer = {
    store: product.store,
    storeName: product.storeName,
    title: product.title,
    brand: product.brand,
    variant: product.variant,
    url: product.url,
    currency: product.currency,
    price: product.currentPrice,
    image: product.image,
  };
  const validExisting = verifiedOffers(product, product.offers ?? []);
  const validNew = verifiedOffers(product, incoming).filter(
    (o) => o.store !== product.store,
  );
  const byStore = new Map<string, Offer>();
  for (const candidate of [own, ...validExisting, ...validNew]) {
    // Freshly fetched candidates win over previous prices from their store.
    byStore.set(candidate.store, candidate);
  }
  return [...byStore.values()].sort((a, b) => a.price - b.price);
}

export async function verifyAndUpdateCandidateOffers(
  id: string,
  links: string[],
): Promise<{ offers: Offer[]; verified: number; diagnostics: LinkResult[] }> {
  if (!links.length || links.length > MAX_CANDIDATE_LINKS)
    throw new Error('Enter one or two candidate links');
  const product = await ProductModel.findById(id)
    .select('title currency store storeName url currentPrice image brand variant')
    .lean();
  if (!product) throw new Error('Product not found');
  const source = {
    ...product,
    image: product.image ?? undefined,
    brand: product.brand ?? undefined,
    variant: product.variant ?? undefined,
  };
  const checked = await verifyCandidateLinks(source, links);
  // A failed check must not wipe previously discovered offers.
  if (!checked.offers.length)
    return { offers: [], verified: 0, diagnostics: checked.diagnostics };
  // Reload after paid work so we preserve any automatic offers saved concurrently.
  const latest = await ProductModel.findById(id)
    .select('title currency store storeName url currentPrice image brand variant offers')
    .lean();
  if (!latest) throw new Error('Product not found');
  const offers = mergeVerifiedCandidateOffers(
    {
      ...latest,
      image: latest.image ?? undefined,
      brand: latest.brand ?? undefined,
      variant: latest.variant ?? undefined,
      offers: latest.offers.map((o) => ({
        ...o,
        brand: o.brand ?? undefined,
        variant: o.variant ?? undefined,
        image: o.image ?? undefined,
      })),
    },
    checked.offers,
  );
  // Manual verification does NOT reset the automatic search's 10-minute cooldown.
  await ProductModel.updateOne({ _id: id }, { $set: { offers } });
  return { offers, verified: checked.offers.length, diagnostics: checked.diagnostics };
}

export function offersAreStale(checkedAt?: Date | string | null) {
  return !checkedAt || Date.now() - new Date(checkedAt).getTime() > OFFERS_TTL_MS;
}

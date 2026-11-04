import { independentFragrance } from '@/lib/scraper/matching/fragrance';
import {
  validAssociations,
  type ProductAssociation,
} from '@/lib/scraper/matching/observations';
import { savedProductOffers } from './saved-product-offers';
import { sufficientExactEvidence } from '@/lib/scraper/exact-evidence';
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

/** Retain evidence without renewing timestamps; rendering checks it separately. */
export function retainOfferEvidence(previous: Offer[], visible: Offer[]) {
  return [
    ...new Map([...previous, ...visible].map((offer) => [offer.store, offer])).values(),
  ];
}

/** Existing automatic discovery route stays unchanged. */
export async function updateOffers(id: string) {
  const product = await ProductModel.findById(id)
    .select(
      'title currency store storeName url currentPrice image brand variant comparisonIdentityVerified exactEvidence canonicalIdentity priceObservation productLinks isOutOfStock',
    )
    .lean();
  if (!product) return [];
  const automatic = await findOffers({
    ...product,
    image: product.image ?? undefined,
    comparisonIdentityVerified: product.comparisonIdentityVerified ?? undefined,
    brand: product.brand ?? undefined,
    variant: product.variant ?? undefined,
  });
  // Saved-product discovery is local/zero-API-cost, with an independent freshness gate.
  let saved: Offer[] = [];
  let links: ProductAssociation[] | undefined;
  try {
    saved = await savedProductOffers(product, (result) => {
      links = result;
    });
  } catch {
    console.warn('[compare] Saved product lookup failed');
  }
  const discovered = [...automatic, ...saved];
  // Preserve independently verified manual offers during a subsequent auto-search,
  // but only while their separate last-check timestamp is still fresh.
  const latest = await ProductModel.findById(id)
    .select(
      'title currency store storeName url currentPrice image brand variant comparisonIdentityVerified exactEvidence canonicalIdentity priceObservation productLinks isOutOfStock offers candidateLinksCheckedAt',
    )
    .lean();
  if (
    !latest ||
    (latest.comparisonIdentityVerified === false &&
      !sufficientExactEvidence(latest.exactEvidence) &&
      !independentFragrance(latest.canonicalIdentity))
  )
    return discovered;
  const source = {
    ...latest,
    image: latest.image ?? undefined,
    comparisonIdentityVerified: latest.comparisonIdentityVerified ?? undefined,
    brand: latest.brand ?? undefined,
    variant: latest.variant ?? undefined,
    // Mongoose lean offers may contain nullable brand/variant/image; normalize
    // before passing them into our strict Offer matching functions.
    offers: (latest.offers ?? []).map((offer) => ({
      ...offer,
      savedTrackedProduct: offer.savedTrackedProduct ?? undefined,
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
          savedTrackedProduct: offer.savedTrackedProduct ?? undefined,
          brand: offer.brand ?? undefined,
          variant: offer.variant ?? undefined,
          image: offer.image ?? undefined,
        }))
    : [];
  const storedManual = verifiedOffers(source, earlier);
  // New automatic search wins over older manual prices for the same store.
  const offers = mergeVerifiedCandidateOffers(source, [...storedManual, ...discovered]);
  console.info('[compare] Offer merge', {
    stores: ['amazon', 'flipkart', 'myntra.com']
      .filter((store) => store !== source.store)
      .map((store) => ({
        store,
        discovered: discovered.some((offer) => offer.store === store),
        previouslySaved: source.offers.some((offer) => offer.store === store),
        retained: offers.some((offer) => offer.store === store),
      })),
  });
  await ProductModel.updateOne(
    { _id: id },
    {
      $set: {
        offers: retainOfferEvidence(source.offers, offers),
        offersCheckedAt: new Date(),
        ...(links ? { productLinks: validAssociations(source, links) } : {}),
      },
    },
  );
  return offers;
}

/** Merge only freshly verified URLs, never replace valid existing store offers on failure. */
export function mergeVerifiedCandidateOffers(
  product: {
    title: string;
    exactEvidence?: unknown;
    canonicalIdentity?: unknown;
    priceObservation?: unknown;
    isOutOfStock?: boolean;
    comparisonIdentityVerified?: boolean;
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
    .select(
      'title currency store storeName url currentPrice image brand variant comparisonIdentityVerified exactEvidence canonicalIdentity priceObservation productLinks isOutOfStock',
    )
    .lean();
  if (!product) throw new Error('Product not found');
  const source = {
    ...product,
    image: product.image ?? undefined,
    comparisonIdentityVerified: product.comparisonIdentityVerified ?? undefined,
    brand: product.brand ?? undefined,
    variant: product.variant ?? undefined,
  };
  const checked = await verifyCandidateLinks(source, links);
  // A failed check must not wipe previously discovered offers.
  if (!checked.offers.length)
    return { offers: [], verified: 0, diagnostics: checked.diagnostics };
  // Reload after paid work so we preserve any automatic offers saved concurrently.
  const latest = await ProductModel.findById(id)
    .select(
      'title currency store storeName url currentPrice image brand variant comparisonIdentityVerified exactEvidence canonicalIdentity priceObservation productLinks isOutOfStock offers',
    )
    .lean();
  if (!latest) throw new Error('Product not found');
  const offers = mergeVerifiedCandidateOffers(
    {
      ...latest,
      image: latest.image ?? undefined,
      comparisonIdentityVerified: latest.comparisonIdentityVerified ?? undefined,
      brand: latest.brand ?? undefined,
      variant: latest.variant ?? undefined,
      offers: latest.offers.map((o) => ({
        ...o,
        savedTrackedProduct: o.savedTrackedProduct ?? undefined,
        brand: o.brand ?? undefined,
        variant: o.variant ?? undefined,
        image: o.image ?? undefined,
      })),
    },
    checked.offers,
  );
  // Manual verification does NOT reset the automatic search's 10-minute cooldown.
  await ProductModel.updateOne(
    { _id: id },
    {
      $set: {
        offers: retainOfferEvidence(
          latest.offers.map((o) => ({
            ...o,
            brand: o.brand ?? undefined,
            variant: o.variant ?? undefined,
            image: o.image ?? undefined,
            savedTrackedProduct: o.savedTrackedProduct ?? undefined,
          })),
          offers,
        ),
      },
    },
  );
  return { offers, verified: checked.offers.length, diagnostics: checked.diagnostics };
}

export function offersAreStale(checkedAt?: Date | string | null) {
  return !checkedAt || Date.now() - new Date(checkedAt).getTime() > OFFERS_TTL_MS;
}

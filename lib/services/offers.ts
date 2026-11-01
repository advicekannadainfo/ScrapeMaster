import 'server-only';
import ProductModel from '@/lib/models/product.model';
import { findOffers } from '@/lib/scraper/compare';

export const OFFERS_TTL_MS = 24 * 60 * 60 * 1000;

/** Search other stores for the product and persist the matching offers. */
export async function updateOffers(id: string) {
  const product = await ProductModel.findById(id)
    .select('title currency store storeName url currentPrice image brand variant')
    .lean();
  if (!product) return [];

  const offers = await findOffers({
    ...product,
    image: product.image ?? undefined,
    brand: product.brand ?? undefined,
    variant: product.variant ?? undefined,
  });
  // Bumps updatedAt, so open product pages receive the offers via the live stream.
  await ProductModel.updateOne(
    { _id: id },
    { $set: { offers, offersCheckedAt: new Date() } },
  );
  return offers;
}

export function offersAreStale(checkedAt?: Date | string | null) {
  return !checkedAt || Date.now() - new Date(checkedAt).getTime() > OFFERS_TTL_MS;
}

import { mainFragranceIdentity } from '@/lib/scraper/matching/fragrance';
import { observeProduct } from '@/lib/scraper/matching/observations';
/** Synthetic selected MAIN evidence for positive policy tests; not a live capture. */
export function withFragranceProduct<
  T extends {
    title: string;
    store: string;
    url: string;
    brand?: string;
    currency: string;
    price?: number;
    currentPrice?: number;
  },
>(p: T) {
  const canonicalIdentity = mainFragranceIdentity({
    title: p.title,
    brand: p.brand ?? 'BLA BLI BLU',
    store: p.store,
    url: p.url,
    selectedVolume: 30,
    volumeField:
      p.store === 'amazon'
        ? 'product_information.Item Volume'
        : p.store === 'flipkart'
          ? 'specifications.General.Quantity'
          : 'selectedSeller.netQuantity',
  });
  return {
    ...p,
    canonicalIdentity,
    priceObservation: observeProduct(
      canonicalIdentity,
      (p.price ?? p.currentPrice)!,
      p.currency,
      false,
    ),
  };
}

import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { isAccessory, isPlausiblePrice, titleSimilarity } from './match';
import { regionFromCurrency, searchableStores } from './stores';
import { isVerifiedMatch, comparisonSearchQuery } from '@/lib/verified-offers';
import { discoverOffers } from './discovery';
import { ScrapeError } from './errors';

/**
 * Search every store that supports the product's region for the same item
 * and return the best-matching offer per store, cheapest first.
 */
export async function findOffersWithDiagnostics(
  product: Pick<
    ScrapedProduct,
    'title' | 'currency' | 'store' | 'storeName' | 'url' | 'currentPrice' | 'image'
  >,
) {
  const region = regionFromCurrency(product.currency);
  const query = comparisonSearchQuery(product.title);
  const stores = searchableStores(region).filter((store) => store.id !== product.store);
  const diagnostics: {
    store: string;
    status: 'no-results' | 'rejected' | 'matched' | 'failed';
    candidates: number;
    verified: number;
  }[] = [];

  const results = await Promise.allSettled(
    stores.map(async (adapter) => {
      const offers = await discoverOffers(adapter, query, region);
      const ranked = offers
        .map((offer) => ({ offer, score: titleSimilarity(product.title, offer.title) }))
        .filter(
          ({ offer }) =>
            isVerifiedMatch(product, offer) &&
            offer.currency === product.currency &&
            !isAccessory(offer.title, product.title) &&
            isPlausiblePrice(offer.price, product.currentPrice),
        )
        .sort((x, y) => y.score - x.score || x.offer.price - y.offer.price);
      diagnostics.push({
        store: adapter.id,
        status: !offers.length ? 'no-results' : !ranked.length ? 'rejected' : 'matched',
        candidates: offers.length,
        verified: ranked.length,
      });
      return ranked[0]?.offer;
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected')
      diagnostics.push({
        store: stores[i].id,
        status: 'failed',
        candidates: 0,
        verified: 0,
      });
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
  if (result.diagnostics.some((d) => d.status === 'failed')) {
    console.warn('[compare] Store search failed; inspect discovery diagnostics.');
    if (result.offers.length === 1)
      throw new ScrapeError(
        'Store search failed; verified comparison is unavailable, not confirmed empty.',
        'unavailable',
      );
  }
  return result.offers;
}

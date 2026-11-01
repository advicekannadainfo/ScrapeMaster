import 'server-only';
import type { Offer, ScrapedProduct } from '@/types';
import { loadAndParse } from './load';
import { isAccessory, isPlausiblePrice, searchQuery, titleSimilarity } from './match';
import { regionFromCurrency, searchableStores } from './stores';
import { isVerifiedMatch } from '@/lib/verified-offers';

/**
 * Search every store that supports the product's region for the same item
 * and return the best-matching offer per store, cheapest first.
 */
export async function findOffers(
  product: Pick<
    ScrapedProduct,
    'title' | 'currency' | 'store' | 'storeName' | 'url' | 'currentPrice' | 'image'
  >,
) {
  const region = regionFromCurrency(product.currency);
  const query = searchQuery(product.title);
  const stores = searchableStores(region);

  const results = await Promise.allSettled(
    stores.map(async (adapter) => {
      const url = adapter.search!.url(query, region);
      const offers = await loadAndParse(
        adapter,
        url,
        (html) => adapter.search!.parse(html, url),
        { headers: adapter.search!.headers?.() },
      );
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
      return ranked[0]?.offer;
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected')
      console.error(`[compare] ${stores[i].name} search failed`, r.reason);
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
  return [...byStore.values()].sort((a, b) => a.price - b.price);
}

import type { Offer } from '@/types';
import { flipkartProductInput } from './retail-product-input';

const TTL = 10 * 60_000;
const entries = new Map<string, { until: number; offer: Offer }>();
function key(input: string) {
  const target = flipkartProductInput(input);
  const url = new URL(target.url);
  return `${url.pathname}:${target.pid ?? ''}`;
}

/** Only already validated dedicated Search rows; no network, no price/stock proof. */
export function rememberFlipkartSearch(offers: Offer[]) {
  for (const offer of offers) {
    const target = flipkartProductInput(offer.url);
    if (!target.pid || target.pid !== offer.storeProductId) continue;
    entries.set(key(offer.url), { until: Date.now() + TTL, offer: { ...offer } });
    if (entries.size > 200) entries.delete(entries.keys().next().value!);
  }
}

export function cachedFlipkartSearch(input: string): Offer | undefined {
  const id = key(input);
  const entry = entries.get(id);
  if (!entry) return;
  if (entry.until <= Date.now()) {
    entries.delete(id);
    return;
  }
  return { ...entry.offer };
}

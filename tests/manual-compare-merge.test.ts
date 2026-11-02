import { describe, expect, it } from 'vitest';
import { mergeVerifiedCandidateOffers } from '@/lib/services/offers';
import type { Offer } from '@/types';

const source = {
  store: 'amazon',
  storeName: 'Amazon',
  title: 'BLABLIBLU Love Drunk Unisex Perfume for Men & Women 30ml',
  url: 'https://www.amazon.in/dp/B0FYGRL51R',
  brand: 'BLA BLI BLU',
  variant: '30ml',
  currency: '₹',
  currentPrice: 184,
};
const offer = (store: string, price: number): Offer => ({
  store,
  storeName: store,
  title: 'BLA BLI BLU Love Drunk Perfume 30ml',
  brand: 'BLA BLI BLU',
  variant: '30ml',
  price,
  currency: '₹',
  url:
    store === 'flipkart'
      ? 'https://www.flipkart.com/p/itm111?pid=PER123'
      : 'https://www.myntra.com/perfume/38312143/buy',
});

describe('manual verification merge', () => {
  it('preserves prior offers when a new link verification fails', () => {
    const merged = mergeVerifiedCandidateOffers(
      { ...source, offers: [offer('flipkart', 250)] },
      [],
    );
    expect(merged.map((o) => o.store)).toEqual(['amazon', 'flipkart']);
  });
  it('overwrites only the same store with a verified fresh price', () => {
    const merged = mergeVerifiedCandidateOffers(
      { ...source, offers: [offer('flipkart', 250), offer('myntra.com', 198)] },
      [offer('flipkart', 240)],
    );
    expect(merged.map((o) => [o.store, o.price])).toEqual([
      ['amazon', 184],
      ['myntra.com', 198],
      ['flipkart', 240],
    ]);
  });
  it('does not preserve wrong variant or unrelated offers', () => {
    const merged = mergeVerifiedCandidateOffers(
      {
        ...source,
        offers: [
          { ...offer('flipkart', 250), variant: '100ml' },
          { ...offer('myntra.com', 198), title: 'AL ADHEEM Wrong perfume 30ml' },
        ],
      },
      [],
    );
    expect(merged).toHaveLength(1);
  });
});

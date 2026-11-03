import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Offer } from '@/types';

const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
vi.mock('@/lib/scraper/stores', () => ({
  regionFromCurrency: () => 'in',
  searchableStores: () => [
    { id: 'amazon', name: 'Amazon' },
    { id: 'flipkart', name: 'Flipkart' },
    { id: 'myntra', name: 'Myntra' },
  ],
}));
import { findOffersWithDiagnostics, findOffers } from '@/lib/scraper/compare';

const source = {
  title: 'BLA BLI BLU Love Drunk Perfume 30 ml',
  currency: '₹',
  store: 'amazon',
  storeName: 'Amazon',
  url: 'https://www.amazon.in/dp/B0FYGRL51R',
  currentPrice: 184,
  image: '',
  brand: 'BLA BLI BLU',
  variant: '30ml',
};
const flipkart: Offer = {
  store: 'flipkart',
  storeName: 'Flipkart',
  title: source.title,
  url: 'https://www.flipkart.com/item/p/itmx?pid=PERHHD9GPW6NNYRQ',
  price: 250,
  currency: '₹',
};

beforeEach(() => {
  mocks.discover.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('automatic comparison partial failures', () => {
  it('keeps valid Flipkart result if Myntra search fails', async () => {
    mocks.discover.mockImplementation((adapter: { id: string }) =>
      adapter.id === 'myntra'
        ? Promise.reject(new Error('provider unavailable'))
        : Promise.resolve([flipkart]),
    );
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers.map((offer) => offer.store)).toEqual(['amazon', 'flipkart']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ store: 'myntra', status: 'failed' }),
        expect.objectContaining({ store: 'flipkart', status: 'matched' }),
      ]),
    );
    expect(await findOffers(source)).toHaveLength(2);
  });
  it('automatically discovers a same-scent Myntra listing with explicit 30ml title', async () => {
    mocks.discover.mockImplementation((adapter: { id: string }, query: string) => {
      expect(query).toBe('BLA BLI BLU love drunk 30ml');
      return Promise.resolve(
        adapter.id === 'myntra'
          ? [
              {
                store: 'myntra.com',
                storeName: 'Myntra',
                title: 'BLA BLI BLU Love Drunk Long Lasting Perfume - 30ml',
                brand: 'BLA BLI BLU',
                url: 'https://www.myntra.com/perfume/bla-bli-blu/38312143/buy',
                price: 225, // Synthetic test-only price.
                currency: '₹',
              },
            ]
          : [],
      );
    });
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers.map((offer) => offer.store)).toContain('myntra.com');
    expect(result.offers.find((offer) => offer.store === 'myntra.com')?.variant).toBe(
      '30ml',
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ store: 'myntra', status: 'matched' }),
      ]),
    );
  });
  it('does not throw when every store fails; returns source listing', async () => {
    mocks.discover.mockRejectedValue(new Error('temporary source failure'));
    expect((await findOffers(source)).map((offer) => offer.store)).toEqual(['amazon']);
  });
  it('rejects different 100ml variant even if found in a search', async () => {
    mocks.discover.mockResolvedValue([
      { ...flipkart, title: 'BLA BLI BLU Love Drunk Perfume 100ml' },
    ]);
    expect((await findOffers(source)).map((offer) => offer.store)).toEqual(['amazon']);
  });
});

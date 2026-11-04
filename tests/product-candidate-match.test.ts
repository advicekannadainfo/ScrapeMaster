import { describe, expect, it } from 'vitest';
import { matchingFetchedFragrance } from '@/lib/scraper/product-candidate-match';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
import type { Offer } from '@/types';

const amazon = {
  title:
    'BLABLIBLU Love Drunk Unisex Perfume for Men & Women 30ml Long-Lasting Parfum Fragrances',
  brand: 'BLA BLI BLU',
  variant: '30ml',
  store: 'amazon',
  storeName: 'Amazon',
  url: 'https://www.amazon.in/dp/B0FYGRL51R',
  currentPrice: 184,
  currency: '₹',
};
const flipkart: Offer = {
  store: 'flipkart',
  storeName: 'Flipkart',
  title:
    'BLA BLI BLU Love Drunk Perfume for Men & Women|Cinnamon & Date Notes Long Lasting Perfume - 30 ml',
  url: 'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
  brand: 'BLA BLI BLU',
  variant: '30ml',
  currency: '₹',
  price: 250,
};
const myntra: Offer = {
  store: 'myntra.com',
  storeName: 'Myntra',
  title: 'BLA BLI BLU Love Drunk Long Lasting Perfume - 30 ml',
  url: 'https://www.myntra.com/Perfume/BLA+BLI+BLU/BLA-BLI-BLU-Love-Drunk-Long-Lasting-Perfume---30ml/38312143/buy',
  brand: 'BLA BLI BLU',
  variant: '30ml',
  currency: '₹',
  price: 198, // Synthetic test-only value; never used for real offers.
};

describe('independently fetched, explicitly sized fragrance identity', () => {
  it('matches Amazon 30ml against same-model Flipkart 30ml and Myntra 30ml', () => {
    expect(isVerifiedProductMatch(amazon, flipkart)).toBe(true);
    expect(isVerifiedProductMatch(amazon, myntra)).toBe(true);
    expect(verifiedOffers(amazon, [flipkart, myntra])).toHaveLength(0); // legacy links have no Product evidence
  });
  it('rejects different size, fragrance, brands and unknown variants', () => {
    expect(matchingFetchedFragrance(amazon, { ...flipkart, variant: '100ml' })).toBe(
      false,
    );
    expect(
      matchingFetchedFragrance(amazon, {
        ...flipkart,
        title: 'BLA BLI BLU Love Drunk Intense Perfume - 30 ml',
      }),
    ).toBe(false);
    expect(matchingFetchedFragrance(amazon, { ...flipkart, brand: 'AL ADHEEM' })).toBe(
      false,
    );
    expect(matchingFetchedFragrance(amazon, { ...flipkart, variant: undefined })).toBe(
      false,
    );
    expect(
      matchingFetchedFragrance(amazon, {
        ...flipkart,
        title: 'BLA BLI BLU Love Drunk Perfume 100ml',
      }),
    ).toBe(false);
    expect(verifiedOffers(amazon, [{ ...myntra, variant: '100ml' }])).toHaveLength(0);
  });
  it('does not use the relaxed rule on non-fragrance products', () => {
    expect(
      matchingFetchedFragrance(
        { title: 'Apple iPhone 15 Pro Black', brand: 'Apple', variant: '128GB' },
        { title: 'Apple iPhone 15 Black', brand: 'Apple', variant: '128GB' },
      ),
    ).toBe(false);
  });
  it('rejects multipacks', () => {
    expect(
      isVerifiedProductMatch(amazon, {
        ...flipkart,
        title: `${flipkart.title} pack of 2`,
      }),
    ).toBe(false);
  });
});

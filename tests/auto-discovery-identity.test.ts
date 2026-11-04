import { describe, expect, it } from 'vitest';
import {
  enrichSearchFragranceIdentity,
  fragranceDiscoveryQuery,
} from '@/lib/scraper/product-candidate-match';
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
const myntraSearch: Offer = {
  store: 'myntra.com',
  storeName: 'Myntra',
  title: 'BLA BLI BLU Love Drunk Long Lasting Perfume - 30ml',
  brand: 'BLA BLI BLU',
  url: 'https://www.myntra.com/perfume/bla-bli-blu/38312143/buy',
  price: 245, // Synthetic test price, never a claimed real listing.
  currency: '₹',
};

function normalized(candidate: Offer) {
  return enrichSearchFragranceIdentity(amazon, candidate);
}

describe('safe automatic fragrance discovery (offline)', () => {
  it('searches distinctive brand, scent and selected size without long marketing keywords', () => {
    expect(fragranceDiscoveryQuery(amazon)).toBe('BLA BLI BLU love drunk 30ml');
  });
  it('keeps title volume as listing metadata without Product verification', () => {
    const candidate = normalized(myntraSearch);
    expect(candidate.variant).toBe('30ml');
    expect(isVerifiedProductMatch(amazon, candidate)).toBe(true);
    expect(verifiedOffers(amazon, [candidate])).toEqual([]);
  });
  it('normalizes a Flipkart search listing with no explicit brand field', () => {
    const candidate = normalized({
      ...myntraSearch,
      store: 'flipkart',
      storeName: 'Flipkart',
      brand: undefined,
      title: 'BLA BLI BLU Love Drunk Perfume for Men & Women Cinnamon Date Notes - 30 ml',
      url: 'https://www.flipkart.com/love-drunk/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
    });
    expect(candidate).toMatchObject({ brand: 'BLA BLI BLU', variant: '30ml' });
    expect(verifiedOffers(amazon, [candidate])).toHaveLength(0);
  });
  it.each([
    'BLA BLI BLU Love Drunk Perfume 100ml',
    'BLA BLI BLU Love Drunk Intense Perfume 30ml',
    'AL ADHEEM Love Drunk Perfume 30ml',
    'BLA BLI BLU Love Drunk Perfume 30ml pack of 2',
    'BLA BLI BLU Love Drunk Perfume 30ml + 100ml',
    'BLA BLI BLU Love Drunk Eau de Toilette Perfume 30ml',
    'BLA BLI BLU Love Drunk Perfume',
  ])('rejects unsupported or wrong search candidate: %s', (title) => {
    const candidate = normalized({ ...myntraSearch, title });
    expect(verifiedOffers(amazon, [candidate])).toEqual([]);
  });
  it('does not add a variant to listings with contradictory brand or selected size', () => {
    expect(normalized({ ...myntraSearch, brand: 'AL ADHEEM' }).variant).toBeUndefined();
    expect(normalized({ ...myntraSearch, variant: '100ml' }).variant).toBe('100ml');
    expect(
      verifiedOffers(amazon, [normalized({ ...myntraSearch, variant: '100ml' })]),
    ).toEqual([]);
  });
  it('never uses relaxed matching for phones or quantity-ambiguous fragrance', () => {
    const phone = {
      title: 'Apple iPhone 15 Pro Black 128GB',
      brand: 'Apple',
      variant: '128GB',
    };
    expect(fragranceDiscoveryQuery(phone)).toBeUndefined();
    expect(
      enrichSearchFragranceIdentity(phone, {
        title: 'Apple iPhone 15 Black 128GB',
        brand: 'Apple',
      }),
    ).not.toHaveProperty('variant');
    expect(
      fragranceDiscoveryQuery({ ...amazon, title: amazon.title.replace('30ml', '') }),
    ).toBeUndefined();
  });
});

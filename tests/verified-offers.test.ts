import { describe, expect, it } from 'vitest';
import {
  comparisonSearchQuery,
  isVerifiedMatch,
  verifiedOffers,
  matchesDiscoveryQuery,
} from '@/lib/verified-offers';
import type { Offer } from '@/types';

const title = 'BLA BLI BLU Love Drunk Long Lasting Perfume - 100 ml';
const wrong = 'Blu C Chanel by AL ADHEEM | Premium Long-Lasting Perfume 100 ml';
const product = {
  title,
  store: 'myntra.com',
  url: 'https://www.myntra.com/perfume/36340100/buy',
  currency: '₹',
  currentPrice: 650,
};
const offer = (name: string, price = 600): Offer => ({
  title: name,
  store: 'amazon',
  storeName: 'Amazon',
  url: 'https://www.amazon.in/dp/B012345678',
  currency: '₹',
  price,
});

describe('verified cross-store identity', () => {
  it('retains product identity and quantity after removing marketing words from discovery queries', () => {
    const query = comparisonSearchQuery(title);
    expect(query).toBe('bla bli blu love drunk 100ml');
    expect(matchesDiscoveryQuery(query, 'BLA BLI BLU Love Drunk Perfume 100 ml')).toBe(
      true,
    );
    expect(matchesDiscoveryQuery(query, wrong)).toBe(false);
  });
  it('rejects the reported AL ADHEEM false match despite overlapping marketing words', () => {
    expect(isVerifiedMatch({ title }, { title: wrong })).toBe(false);
    expect(matchesDiscoveryQuery('BLA BLI BLU Love Drunk 100 ml', wrong)).toBe(false);
  });
  it('accepts the real product with reordered words and equivalent quantity notation', () => {
    expect(
      isVerifiedMatch({ title }, { title: 'BLA BLI BLU Love Drunk Perfume 0.1 L' }),
    ).toBe(true);
    expect(
      isVerifiedMatch({ title }, { title: 'BLA BLI BLU Love Drunk 100ml Eau de Parfum' }),
    ).toBe(false);
  });
  it.each([
    'BLA BLI BLU Love Drunk Perfume 50 ml',
    'BLA BLI BLU Love Drunk Perfume',
    'BLA BLI BLU Another Love Perfume 100 ml',
    'AL ADHEEM Love Drunk Perfume 100 ml',
    'BLA BLI BLU Love Drunk Perfume 100 ml pack of 2',
  ])('rejects variant/quantity ambiguity: %s', (candidate) => {
    expect(isVerifiedMatch({ title }, { title: candidate })).toBe(false);
  });
  it('does not combine different colours or model suffixes', () => {
    expect(
      isVerifiedMatch(
        { title: 'Apple iPhone 15 128GB Black' },
        { title: 'Apple iPhone 15 128GB Blue' },
      ),
    ).toBe(false);
    expect(
      isVerifiedMatch(
        { title: 'Apple iPhone 15 Pro 128GB' },
        { title: 'Apple iPhone 15 128GB' },
      ),
    ).toBe(false);
  });
  it('checks explicit brand/model/variant/global identifiers when supplied', () => {
    for (const field of ['brand', 'model', 'variant', 'gtin', 'mpn']) {
      expect(isVerifiedMatch({ title, [field]: 'one' }, { title, [field]: 'two' })).toBe(
        false,
      );
    }
  });
  it('filters persisted wrong offers without changing the cached data or source price', () => {
    const cached = [offer(wrong, 1499), offer('BLA BLI BLU Love Drunk Perfume 100ml')];
    expect(verifiedOffers({ ...product, offers: cached })).toEqual([]);
    expect(cached).toHaveLength(2);
    expect(product.currentPrice).toBe(650);
    expect(verifiedOffers(product, [cached[0]])).toEqual([]);
  });
  it('rejects invalid prices, currencies, URLs, and forged own-store listings', () => {
    expect(
      verifiedOffers(product, [
        offer(title, 0),
        offer(title, NaN),
        { ...offer(title), currency: '$' },
        { ...offer(title), url: 'javascript:alert(1)' },
        { ...offer(wrong), store: product.store },
      ]),
    ).toEqual([]);
  });
  it('preserves source tracking but hides an unobserved legacy competitor', () => {
    expect(
      verifiedOffers(product, [
        { ...offer(title, 650), store: product.store, url: product.url },
        offer(title),
      ]),
    ).toHaveLength(1);
  });
});

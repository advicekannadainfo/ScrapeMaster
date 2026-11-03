import { afterEach, describe, expect, it, vi } from 'vitest';
import real from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import { parseFlipkartSearchAPI } from '@/lib/scraper/stores/flipkart';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
const url =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds-air-conduction-tech-52h-battery-app-support-btv6-0-bluetooth/p/itmff4c9a382c887?pid=ACCHN7ZPTFV2ZACN';
function contract() {
  // Reproduces CONFIRMED structure only. Other values are synthetic/copied from
  // a known offline fixture; this is not a captured full ProClip API response.
  return {
    product_results: {
      ...structuredClone(real).product_results,
      title: 'boAt Airdopes ProClip OWS Earbuds',
      brand: 'boAt',
      specifications: { General: {} },
      highlights: [],
      variants: [{ color: 'Black', price: 1, selected: true, sku: 'UNSELECTED' }],
      display_sizes: ['White'],
    },
  };
}
const parse = (data: unknown = contract(), input = url) =>
  parseFlipkartAPIProduct(JSON.stringify(data), input);
afterEach(() => vi.restoreAllMocks());
describe('URL-bound root tracking with unknown optional colour/model', () => {
  it('tracks the root product despite a nonempty catalog, without inventing selected identity', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = parse();
    expect(p).toMatchObject({
      url,
      title: 'boAt Airdopes ProClip OWS Earbuds',
      brand: 'boAt',
      currentPrice: 250,
      currency: '₹',
      isOutOfStock: false,
      comparisonIdentityVerified: false,
    });
    expect(p.variant).toBeUndefined();
    expect(p).not.toHaveProperty('model');
    expect(p).not.toHaveProperty('storeProductId');
    expect(isVerifiedProductMatch(p, p)).toBe(false);
    const own = {
      store: p.store,
      storeName: p.storeName,
      title: p.title,
      url: p.url,
      price: p.currentPrice,
      currency: p.currency,
    };
    expect(verifiedOffers(p, [own])).toEqual([own]);
  });
  it('does not let cached search matching turn missing colour into a tracking prerequisite', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cachedUrl = url.replace('ACCHN7ZPTFV2ZACN', 'CACHEUNKNOWN');
    parseFlipkartSearchAPI(
      JSON.stringify({
        search_results: [
          {
            title: contract().product_results.title,
            url: cachedUrl,
            product_id: 'CACHEUNKNOWN',
            price: 999,
          },
        ],
      }),
    );
    expect(parse(contract(), cachedUrl)).toMatchObject({
      currentPrice: 250,
      comparisonIdentityVerified: false,
      variant: undefined,
    });
  });
  it('rejects conflicting PID/canonical URL, unrelated identity, invalid root price and unknown stock', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const change of [
      { pid: 'OTHER' },
      { canonical_url: 'https://www.flipkart.com/other/p/itmother?pid=OTHER' },
      { title: 'boAt Different Earbuds' },
      { brand: 'Other Brand' },
      { price: '₹0' },
      { price: '$250' },
      { availability: 'Unknown' },
    ])
      expect(() =>
        parse({ product_results: { ...contract().product_results, ...change } }),
      ).toThrow();
  });
  it('cannot rescue a missing root price from any alternative entry', () => {
    const p = contract();
    Reflect.deleteProperty(p.product_results, 'price');
    expect(() => parse(p)).toThrow(/price/);
  });
  it('still rejects contradictory selected colour instead of treating it as missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = contract();
    p.product_results.title += ' Black';
    Object.assign(p.product_results.specifications.General, { Color: 'White' });
    expect(() => parse(p)).toThrow(/conflicts/);
  });
  it('does not promote a missing root colour even when explicit Model Name is present', () => {
    const p = contract();
    Object.assign(p.product_results.specifications.General, {
      'Model Name': 'Airdopes ProClip',
    });
    expect(parse(p)).toMatchObject({
      comparisonIdentityVerified: false,
      currentPrice: 250,
      variant: undefined,
    });
  });
});

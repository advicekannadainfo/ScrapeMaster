import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from './fixtures/standard-india-product.json';
import { ajio, nykaa, croma, resolveStore, searchableStores } from '@/lib/scraper/stores';
import { isVerifiedMatch } from '@/lib/verified-offers';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/scraper/http', async (original) => ({
  ...(await original<typeof import('@/lib/scraper/http')>()),
  fetchHtml: mocks.fetch,
}));
import { scrapeProduct } from '@/lib/scraper';
beforeEach(() => {
  vi.clearAllMocks();
});
const html = (p: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(p)}</script>`;

describe.each([ajio, nykaa, croma])(
  '$name standard-only product contract (synthetic fixture; not captured HTML)',
  (store) => {
    const url = `https://www.${store.id}/example-product`;
    const sample = () => ({ ...structuredClone(fixture), url });
    it('routes exact store domains and extracts only explicit standard product data', () => {
      expect(resolveStore(new URL(url))).toBe(store);
      expect(store.parse(html(sample()), url)).toMatchObject({
        store: store.id,
        title: 'Example Cotton Shirt Red M',
        brand: 'Example',
        variant: 'Red / M',
        storeProductId: 'EXAMPLE-PRODUCT',
        currentPrice: 650,
        originalPrice: 1000,
        currency: '₹',
        isOutOfStock: false,
        stars: 4.5,
        reviewsCount: 10,
      });
      expect(store.matches(new URL(`https://${store.id}.evil.example/product`))).toBe(
        false,
      );
      expect(searchableStores('in')).not.toContain(store);
    });
    it('uses the existing product URL pipeline without making any live request', async () => {
      mocks.fetch.mockResolvedValue(html(sample()));
      expect(await scrapeProduct(url)).toMatchObject({
        currentPrice: 650,
        store: store.id,
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
    it('preserves variant selectors while stripping tracking', () => {
      const normalized = store.normalize(
        new URL(`${url}?variant=RED-M&utm_source=mail#details`),
      );
      expect(normalized).toBe(`${url}?variant=RED-M`);
      expect(() => store.parse(html(sample()), `${url}?variant=BLUE-L`)).toThrow(
        /exact URL/,
      );
    });
    it('does not accept wrong products or choose a recommendation', () => {
      const p = sample();
      p.url = `${url}-other`;
      expect(() => store.parse(html({ '@graph': [p] }), url)).toThrow(/exact URL/);
      expect(() => store.parse(html([sample(), sample()]), url)).toThrow(/one JSON-LD/);
    });
    it('rejects missing price, stock, currency, identity or brand', () => {
      for (const key of ['price', 'priceCurrency', 'availability']) {
        const p = sample();
        Reflect.deleteProperty(p.offers, key);
        expect(() => store.parse(html(p), url)).toThrow();
      }
      const p = sample();
      Reflect.deleteProperty(p, 'sku');
      Reflect.deleteProperty(p, 'productID');
      expect(() => store.parse(html(p), url)).toThrow(/identifier/);
      const noBrand = sample();
      Reflect.deleteProperty(noBrand, 'brand');
      expect(() => store.parse(html(noBrand), url)).toThrow();
    });
    it('does not use a group minimum, list price or unit price as selling price', () => {
      const p = sample();
      Reflect.set(p, 'offers', {
        '@type': 'AggregateOffer',
        lowPrice: 184,
        priceCurrency: 'INR',
      });
      expect(() => store.parse(html(p), url)).toThrow(/aggregate/);
      const q = sample();
      Reflect.deleteProperty(q.offers, 'price');
      expect(() => store.parse(html(q), url)).toThrow();
    });
    it('does not choose the lowest of multiple sellers/variants', () => {
      const p = sample();
      Reflect.set(p, 'offers', [p.offers, { ...p.offers, price: 184 }]);
      expect(() => store.parse(html(p), url)).toThrow(/ambiguous/);
    });
    it('uses explicit stock and rejects different variants at comparison', () => {
      const p = sample();
      p.offers.availability = 'https://schema.org/OutOfStock';
      const red = store.parse(html(p), url);
      expect(red.isOutOfStock).toBe(true);
      const q = sample();
      q.color = 'Blue';
      const blue = store.parse(html(q), url);
      expect(isVerifiedMatch(red, blue)).toBe(false);
    });
    it('rejects non-INR, zero prices and access/maintenance pages', () => {
      const p = sample();
      p.offers.priceCurrency = 'USD';
      expect(() => store.parse(html(p), url)).toThrow();
      p.offers.priceCurrency = 'INR';
      p.offers.price = '0';
      expect(() => store.parse(html(p), url)).toThrow();
      expect(() => store.parse('<h1>CAPTCHA</h1>', url)).toThrow();
    });
  },
);

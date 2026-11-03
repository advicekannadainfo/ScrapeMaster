import { describe, it, expect } from 'vitest';
import real from './fixtures/myntra-product-real.json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
const url = 'https://www.myntra.com/perfume/bla-bli-blu/36340100/buy';
const parse = (body: unknown) => parseMyntraAPIProduct(JSON.stringify(body), url);
// Mutations of the known full fixture, NOT a captured SKINN response or live price.
describe('Myntra optional/null seller netQuantity', () => {
  it.each(['null', 'missing', 'empty'])(
    'tracks trustworthy source price with %s quantity, but no fabricated selected volume',
    (kind) => {
      const p = structuredClone(real);
      if (kind === 'missing')
        Reflect.deleteProperty(p.product_results.selectedSeller, 'netQuantity');
      else
        Object.assign(p.product_results.selectedSeller, {
          netQuantity: kind === 'null' ? null : [],
        });
      const result = parse(p);
      expect(result).toMatchObject({
        currentPrice: 650,
        originalPrice: 1000,
        isOutOfStock: false,
        comparisonIdentityVerified: false,
      });
      expect(result.variant).toBeUndefined();
      expect(isVerifiedProductMatch(result, result)).toBe(false);
      const own = {
        store: result.store,
        storeName: result.storeName,
        title: result.title,
        url: result.url,
        price: result.currentPrice,
        currency: result.currency,
      };
      expect(verifiedOffers(result, [own])).toEqual([own]);
    },
  );
  it('keeps valid independently confirmed quantity and existing 30ml comparison confidence', () => {
    expect(parse(real)).toMatchObject({
      variant: '100ml',
      comparisonIdentityVerified: true,
    });
    const p = structuredClone(real);
    p.product_results.name = p.product_results.name.replace('100 ml', '30 ml');
    p.product_results.selectedSeller.netQuantity[0].quantity = 30;
    expect(parse(p)).toMatchObject({ variant: '30ml', comparisonIdentityVerified: true });
  });
  it.each([
    { quantity: 'invalid', unit: 'ml' },
    { quantity: 20, unit: null },
    { unit: 'ml' },
  ])('keeps non-null entry validation strict %#', (entry) => {
    const p = structuredClone(real);
    Object.assign(p.product_results.selectedSeller, { netQuantity: [entry] });
    expect(() => parse(p)).toThrow(/invalid real product data/);
  });
  it('rejects conflicting quantity rather than preferring title or another size', () => {
    const p = structuredClone(real);
    p.product_results.selectedSeller.netQuantity[0].quantity = 20;
    expect(() => parse(p)).toThrow(/quantity conflict/);
  });
  it('keeps seller/SKU, linked-offer and price conflict checks despite null netQuantity', () => {
    for (const change of ['seller', 'sku', 'price', 'link'] as const) {
      const p = structuredClone(real);
      Object.assign(p.product_results.selectedSeller, { netQuantity: null });
      if (change === 'seller') p.product_results.selectedSeller.sellerPartnerId = 999;
      if (change === 'sku') p.product_results.buyButtonSellerOrder[0].skuId = 999;
      if (change === 'price') p.product_results.selectedSeller.discountedPrice = 184;
      if (change === 'link')
        p.product_results.sizes.forEach((size) => {
          size.frg_list_link = 'https://example.test/free-gift-list';
        });
      expect(() => parse(p)).toThrow();
    }
  });
});

import { describe, expect, it } from 'vitest';
import fixture from './fixtures/myntra-product.json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';

const url = 'https://www.myntra.com/jeans/powerlook/jeans/31076617/buy';
const parse = (data: unknown) => parseMyntraAPIProduct(JSON.stringify(data), url);
const sample = () => structuredClone(fixture);

describe('Myntra Product API parser (synthetic documented-shape fixture)', () => {
  it('maps ID, title, price, image, currency and ratings', () => {
    expect(parse(fixture)).toMatchObject({
      store: 'myntra.com',
      title: fixture.product_results.name,
      currency: '₹',
      currentPrice: 1159,
      originalPrice: 2899,
      stars: 4.17,
      reviewsCount: 1164,
      image: fixture.product_results.images[0],
      isOutOfStock: false,
      description: 'Myntra product 31076617. Price for size: 28.',
    });
  });
  it('rejects a missing selling price instead of returning zero or MRP', () => {
    const data = sample();
    const size: Partial<(typeof data.product_results.sizes)[number]> = {
      ...data.product_results.sizes[0],
    };
    delete size.discounted_price;
    expect(() =>
      parse({ product_results: { ...data.product_results, sizes: [size] } }),
    ).toThrow(/price is missing/);
  });
  it('does not use an unavailable size price', () => {
    const data = sample();
    data.product_results.sizes.forEach((s) => {
      s.available = false;
    });
    expect(() => parse(data)).toThrow(/No available/);
  });
  it('ignores zero placeholder prices on unavailable sizes', () => {
    const data = sample();
    data.product_results.sizes[1].discounted_price = 0;
    expect(parse(data).currentPrice).toBe(1159);
  });
  it('tracks a common price without inventing a selected size or MRP when options disagree', () => {
    const data = sample();
    data.product_results.sizes[1].available = true;
    data.product_results.sizes[1].stock = 5;
    data.product_results.sizes[1].discounted_price = 1159;
    data.product_results.sizes.reverse();
    expect(parse(data)).toMatchObject({
      currentPrice: 1159,
      originalPrice: 1159,
      comparisonIdentityVerified: false,
      description:
        'Myntra product 31076617. No selected size; price common to available sizes.',
    });
  });
  it('treats zero stock as unavailable even if available is true', () => {
    const data = sample();
    data.product_results.sizes[0].stock = 0;
    expect(() => parse(data)).toThrow(/No available/);
  });
  it('rejects differing size prices rather than advertising an arbitrary size', () => {
    const data = sample();
    data.product_results.sizes[1].available = true;
    data.product_results.sizes[1].stock = 5;
    expect(() => parse(data)).toThrow(/select a size/);
  });
  it('uses the selected size MRP, never another size or product MRP', () => {
    const data = sample();
    data.product_results.mrp = 9999;
    expect(parse(data).originalPrice).toBe(2899);
    const size: Partial<(typeof data.product_results.sizes)[number]> = {
      ...data.product_results.sizes[0],
    };
    delete size.mrp;
    expect(
      parse({ product_results: { ...data.product_results, sizes: [size] } })
        .originalPrice,
    ).toBe(1159);
  });
  it.each(['<html>Maintenance</html>', '{}', 'null', '{"product_results": []}'])(
    'rejects malformed response %s',
    (body) => {
      expect(() => parseMyntraAPIProduct(body, url)).toThrow();
    },
  );
  it('rejects a response for a different product', () => {
    const data = sample();
    data.product_results.productId = 123;
    expect(() => parse(data)).toThrow(/different product ID/);
  });
  it.each([0, -10, Infinity])('rejects invalid price %s', (price) => {
    const data = sample();
    data.product_results.sizes[0].discounted_price = price;
    expect(() => parse(data)).toThrow();
  });
});

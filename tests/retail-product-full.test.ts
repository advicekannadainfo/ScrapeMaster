import { describe, it, expect } from 'vitest';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-full.json';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { isVerifiedMatch, verifiedOffers } from '@/lib/verified-offers';
const url = 'https://www.amazon.in/dp/B0FYGRL51R';
const parse = (data: unknown = amazon) =>
  parseAmazonAPIProduct(JSON.stringify(data), url);
describe('complete sanitized user-provided Product fixtures, offline', () => {
  it('extracts the real requested ASIN, 30ml, 184 INR, image, stock and rating', () => {
    expect(parse()).toMatchObject({
      storeProductId: 'B0FYGRL51R',
      variant: '30ml',
      currentPrice: 184,
      currency: '₹',
      image: amazon.main_image,
      isOutOfStock: false,
      stars: 4.1,
      reviewsCount: amazon.extracted_total_reviews,
    });
  });
  it('preserves size in the shortened main_title and does not duplicate spaced/compact brand', () => {
    expect(parse().title).toBe(
      'BLABLIBLU Love Drunk Unisex Perfume for Men & Women 30ml',
    );
    expect(parse().brand).toBe('BLA BLI BLU');
  });
  it('does not treat the related 100ml listing at 649 as a fetched/verified product', () => {
    const related = amazon.related_product_sections
      .flatMap((section) => section.items)
      .find((item) => item.asin === 'B0FLWST1D4');
    expect(related?.extracted_price).toBe(649);
    expect(parse().storeProductId).not.toBe(related?.asin);
    expect(parse().currentPrice).not.toBe(649);
    expect(() =>
      parseAmazonAPIProduct(
        JSON.stringify(amazon),
        'https://www.amazon.in/dp/B0FLWST1D4',
      ),
    ).toThrow(/different ASIN/);
  });
  it('cannot rescue missing selected price from complete related-product sections', () => {
    const data = structuredClone(amazon);
    Reflect.deleteProperty(data, 'extracted_price');
    expect(() => parse(data)).toThrow(/missing or invalid/);
  });
  it('rejects 30ml against the Myntra 100ml source even with the same fragrance name', () => {
    const p = parse();
    const source = {
      title: 'BLA BLI BLU Love Drunk Long Lasting Perfume 100ml',
      currentPrice: 650,
      currency: '₹',
      store: 'myntra.com',
      url: 'https://www.myntra.com/x/36340100/buy',
    };
    expect(isVerifiedMatch(source, p)).toBe(false);
    expect(
      verifiedOffers(source, [
        {
          title: p.title,
          price: p.currentPrice,
          store: p.store,
          storeName: p.storeName,
          url: p.url,
          currency: p.currency,
        },
      ]),
    ).toEqual([]);
  });
  it('still fails if selected quantity changes to 100ml while the full title says 30ml', () => {
    const data = structuredClone(amazon);
    data.product_information['Item Volume'] = '100 Millilitres';
    data.product_information['Package Size Name'] = '100ml';
    expect(() => parse(data)).toThrow(/title quantity conflicts/);
  });
  it('full Flipkart example provides model identity, not PID/SKU/product URL or stock', () => {
    const p = flipkart.product_results;
    expect(p.specifications.General['Model Name']).toBe('LS22D300GAWXXL');
    expect(p.brand_url).toContain('/samsung/pr?');
    for (const key of [
      'product_id',
      'pid',
      'sku',
      'url',
      'canonical_url',
      'availability',
      'stock',
      'in_stock',
    ])
      expect(p).not.toHaveProperty(key);
    expect(() =>
      parseFlipkartAPIProduct(
        JSON.stringify(flipkart),
        'https://www.flipkart.com/monitor/p/itmexample?pid=MONITOR',
      ),
    ).toThrow(/identity and stock cannot be verified/);
  });
});

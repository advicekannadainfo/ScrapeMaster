import { describe, expect, it, vi, afterEach } from 'vitest';
import fixture from './fixtures/flipkart-product-real.json';
import amazon from './fixtures/amazon-india-product-full.json';
import {
  inspectFlipkartAPIProduct,
  parseFlipkartAPIProduct,
  parseAmazonAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { flipkart } from '@/lib/scraper/stores/flipkart';
import { isVerifiedMatch } from '@/lib/verified-offers';

// Synthetic request context, not a claimed canonical URL from the response.
const url = 'https://www.flipkart.com/perfume/p/itmexample?pid=PERHHD9GPW6NNYRQ';
const inspect = (data: unknown = fixture, input = url) =>
  inspectFlipkartAPIProduct(JSON.stringify(data), input);
afterEach(() => vi.unstubAllEnvs());
describe('full sanitized real Flipkart Product response', () => {
  it('validates selected 30ml price, explicit stock, SKU, brand, rating and HTTPS image', () => {
    expect(inspect()).toMatchObject({
      sku: 'PERHHD9GPW6NNYRQ',
      brand: 'BLA BLI BLU',
      variant: '30ml',
      currentPrice: 250,
      originalPrice: 275,
      currency: '₹',
      isOutOfStock: false,
      stars: 4.4,
      reviewsCount: 18505,
      image: fixture.product_results.main_image,
      model: fixture.product_results.specifications.General['Model Name'],
      requestedIdentityVerified: false,
    });
  });
  it('does not use seller rating, bank cashback, or stale description price', () => {
    expect(inspect().currentPrice).toBe(250);
    expect(inspect().stars).toBe(4.4);
  });
  it('does not invent PID or canonical URL from SKU even when request PID equals SKU', () => {
    expect(inspect()).not.toHaveProperty('storeProductId');
    expect(inspect()).not.toHaveProperty('url');
    expect(() => parseFlipkartAPIProduct(JSON.stringify(fixture), url)).toThrow(
      /SKU is not proof/,
    );
  });
  it('does not treat a different requested PID as proven by response SKU', () => {
    expect(
      inspect(fixture, url.replace('PERHHD9GPW6NNYRQ', 'OTHERPID'))
        .requestedIdentityVerified,
    ).toBe(false);
  });
  it('activates dedicated routing and preserves generic parser', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    expect(flipkart.productAPI).toBeDefined();
    expect(flipkart.parse).toBeTypeOf('function');
  });
  it('Amazon and Flipkart have compatible explicit 30ml quantities/brands, without claiming a verified offer', () => {
    const a = parseAmazonAPIProduct(
      JSON.stringify(amazon),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    const f = inspect();
    expect(a.variant).toBe(f.variant);
    expect(a.brand).toBe(f.brand);
    expect(a.title).toMatch(/Love Drunk/);
    expect(f.model).toMatch(/Love Drunk/);
    expect(f.requestedIdentityVerified).toBe(false);
    // Even equivalent fragrance names cannot override a selected-size mismatch.
    for (const candidate of [a, f])
      expect(
        isVerifiedMatch(
          { title: candidate.title, brand: candidate.brand, variant: '100ml' },
          candidate,
        ),
      ).toBe(false);
  });
  it.each(['price', 'sku', 'availability', 'brand'])('rejects missing %s', (field) => {
    const data = structuredClone(fixture);
    Reflect.deleteProperty(data.product_results, field);
    expect(() => inspect(data)).toThrow();
  });
  it.each(['₹0', '$250', '₹250 off', '₹2,50', '250'])(
    'rejects invalid selling price %s',
    (price) => {
      const data = structuredClone(fixture);
      data.product_results.price = price;
      expect(() => inspect(data)).toThrow();
    },
  );
  it('rejects quantity, brand and model conflicts', () => {
    for (const field of ['Quantity', 'Net Quantity', 'Brand', 'Model Name'] as const) {
      const data = structuredClone(fixture);
      data.product_results.specifications.General[field] = field.includes('Quantity')
        ? '100 ml'
        : 'Different product';
      expect(() => inspect(data)).toThrow(/conflict/);
    }
  });
  it('rejects ambiguous variant payloads and unsupported packs', () => {
    const data = structuredClone(fixture);
    data.product_results.specifications.General.Quantity = '2 x 30 ml';
    expect(() => inspect(data)).toThrow(/unsupported/);
    expect(
      inspect({
        product_results: { ...fixture.product_results, variants: [{ size: '100ml' }] },
      }),
    ).toMatchObject({
      currentPrice: 250,
      variant: '30ml',
      comparisonIdentityVerified: false,
    });
  });
  it('rejects conflicting extra response PID and canonical URL without interpreting them as proof', () => {
    for (const extra of [
      { pid: 'OTHER' },
      { product_id: 'OTHER' },
      { canonical_url: 'https://www.flipkart.com/other/p/itmother?pid=OTHER' },
    ])
      expect(() =>
        inspect({ product_results: { ...fixture.product_results, ...extra } }),
      ).toThrow(/conflict/);
  });
  it('requires known stock and HTTPS images and rejects MRP below selling price', () => {
    for (const extra of [
      { availability: 'Unknown' },
      { main_image: 'http://example.com/image.jpg' },
      { previous_price: '₹200' },
    ])
      expect(() =>
        inspect({ product_results: { ...fixture.product_results, ...extra } }),
      ).toThrow();
    expect(
      inspect({
        product_results: { ...fixture.product_results, availability: 'OutOfStock' },
      }).isOutOfStock,
    ).toBe(true);
  });
  it('rejects malformed JSON before producing a candidate', () => {
    expect(() => inspectFlipkartAPIProduct('{', url)).toThrow(/invalid JSON/);
  });
});

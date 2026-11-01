import { describe, it, expect, vi, afterEach } from 'vitest';
import fixture from './fixtures/amazon-search.json';
import { amazon, parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import { isVerifiedMatch } from '@/lib/verified-offers';
const sample = () => structuredClone(fixture);
const parse = (data: unknown) => parseAmazonSearchAPI(JSON.stringify(data));
afterEach(() => vi.unstubAllEnvs());
describe('documented Amazon Search object schema (offline)', () => {
  it('normalizes ASIN, URL and INR while preserving missing availability as unknown', () => {
    expect(parse(fixture)[0]).toMatchObject({
      title: fixture.results[0].title,
      price: 700,
      currency: '₹',
      storeProductId: 'B0EXAMPL01',
      url: 'https://www.amazon.in/dp/B0EXAMPL01',
    });
    expect(parse(fixture)[0]).not.toHaveProperty('inStock');
  });
  it('prefers positive extracted price over presentation strings', () => {
    const data = sample();
    data.results[0].price_string = '₹1,299.00';
    expect(parse(data)[0].price).toBe(700);
  });
  it.each([
    ['₹1,299.00', 1299],
    ['INR 1,29,999.50', 129999.5],
  ])(
    'safely supports formatted INR %s when extracted price is invalid',
    (text, price) => {
      const data = sample();
      data.results[0].extracted_price = 0;
      data.results[0].price_string = String(text);
      data.results[0].price = String(text);
      expect(parse(data)[0].price).toBe(price);
    },
  );
  it.each(['$1,299.00', '₹1,2,3', '₹100 - ₹200', '700'])(
    'rejects ambiguous/non-INR price %s',
    (text) => {
      const data = sample();
      data.results[0].extracted_price = 0;
      data.results[0].price_string = text;
      data.results[0].price = text;
      expect(() => parse(data)).toThrow(/no valid product/);
    },
  );
  it('filters sponsored and explicitly zero-availability listings', () => {
    const data = sample();
    data.results[0].sponsored = true;
    expect(parse(data)).toEqual([]);
    data.results[0].sponsored = false;
    Object.assign(data.results[0], { availability_quantity: 0 });
    expect(parse(data)).toEqual([]);
  });
  it('rejects non-India, unsafe URLs, ASIN conflicts and non-INR currency', () => {
    for (const change of [
      { optimized_url: 'https://www.amazon.com/dp/B0EXAMPL01' },
      { optimized_url: 'https://evil.example/dp/B0EXAMPL01' },
      { asin: 'B0EXAMPL02' },
      { currency: '$' },
    ]) {
      const data = sample();
      Object.assign(data.results[0], change);
      expect(() => parse(data)).toThrow();
    }
  });
  it('filters invalid rows in mixed responses but rejects wholly invalid payloads', () => {
    expect(
      parse({ results: [null, fixture.results[0], { type: 'metadata' }] }),
    ).toHaveLength(1);
    expect(() => parse({ results: [null] })).toThrow();
    expect(parse({ results: [] })).toEqual([]);
    for (const data of [fixture.results, [fixture], {}, null])
      expect(() => parse(data)).toThrow(/unsupported response shape/);
  });
  it('keeps strict product identity: exact perfume accepted and AL ADHEEM rejected', () => {
    const source = { title: 'BLA BLI BLU Love Drunk Long Lasting Perfume 100ml' };
    expect(isVerifiedMatch(source, parse(fixture)[0])).toBe(true);
    const data = sample();
    data.results[0].title = 'Blu C Chanel by AL ADHEEM Perfume 100ml';
    expect(isVerifiedMatch(source, parse(data)[0])).toBe(false);
  });
  it('prefers a dedicated route with a key and preserves generic fallback', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    expect(amazon.search!.load).toBeDefined();
    expect(amazon.search!.fallback?.paid).toBe(true);
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(amazon.search!.load).toBeUndefined();
  });
});

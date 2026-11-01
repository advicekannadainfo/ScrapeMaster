import { describe, it, expect, vi, afterEach } from 'vitest';
import fixture from './fixtures/myntra-search.json';
import { parseMyntraSearch, myntra } from '@/lib/scraper/stores/myntra';
import { isVerifiedMatch } from '@/lib/verified-offers';
const sample = () => structuredClone(fixture);
const parse = (data: unknown) => parseMyntraSearch(JSON.stringify(data));
afterEach(() => vi.unstubAllEnvs());
describe('documented Myntra Search schema, no network', () => {
  it('normalizes identity, price, URL and HTTPS image without inventing a selected size', () => {
    expect(parse(fixture)[0]).toMatchObject({
      store: 'myntra.com',
      brand: 'Nike',
      storeProductId: '25503840',
      price: 4995,
      currency: '₹',
      image: 'https://assets.myntassets.com/assets/images/example.jpg',
      title: fixture.search_results[0].productName,
    });
    expect(parse(fixture)[0].title).not.toContain('UK6');
  });
  it('distinguishes empty results from invalid/error responses', () => {
    expect(parse({ search_results: [] })).toEqual([]);
    for (const data of [{ error: 'provider failure' }, {}, null])
      expect(() => parse(data)).toThrow(/invalid search data/);
    expect(() => parseMyntraSearch('<html>maintenance</html>')).toThrow(/invalid JSON/);
  });
  it('excludes zero inventory or unavailable items', () => {
    const data = sample();
    data.search_results[0].inventoryInfo[0].inventory = 0;
    expect(parse(data)).toEqual([]);
    data.search_results[0].inventoryInfo[0].inventory = 1;
    data.search_results[0].inventoryInfo[0].available = false;
    expect(parse(data)).toEqual([]);
  });
  it('rejects wrong product IDs and unsafe landing hosts', () => {
    const data = sample();
    data.search_results[0].productId = 123;
    expect(() => parse(data)).toThrow(/conflicts/);
    data.search_results[0].landingPageUrl = 'https://evil.example/x/123/buy';
    expect(() => parse(data)).toThrow();
  });
  it('does not use zero or missing prices', () => {
    const data = sample();
    data.search_results[0].price = 0;
    expect(() => parse(data)).toThrow();
    Reflect.deleteProperty(data.search_results[0], 'price');
    expect(() => parse(data)).toThrow();
  });
  it('accepts exact perfume and rejects AL ADHEEM from a catalog of candidates', () => {
    const data = sample();
    const p = data.search_results[0];
    p.productName = 'BLA BLI BLU Love Drunk Perfume 100 ml';
    p.brand = 'BLA BLI BLU';
    const genuine = parse(data)[0];
    expect(
      isVerifiedMatch(
        { title: 'BLA BLI BLU Love Drunk Long Lasting Perfume 100ml' },
        genuine,
      ),
    ).toBe(true);
    p.productName = 'Blu C Chanel by AL ADHEEM Premium Long Lasting Perfume 100ml';
    p.brand = 'AL ADHEEM';
    expect(isVerifiedMatch(genuine, parse(data)[0])).toBe(false);
  });
  it('enables only with the existing secret and builds a full search URL', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(myntra.search?.enabled?.()).toBe(false);
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'fake-offline');
    expect(myntra.search?.enabled?.()).toBe(true);
    const url = new URL(myntra.search!.url('love drunk 100ml', 'in'));
    expect(url.hostname).toBe('www.myntra.com');
    expect(url.searchParams.get('rawQuery')).toBe('love drunk 100ml');
  });
});

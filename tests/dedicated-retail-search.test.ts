import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fixture from './fixtures/flipkart-search.json';
import amazonEmpty from './fixtures/amazon-search-empty.json';
import amazonProducts from './fixtures/amazon-search.json';
import { amazon } from '@/lib/scraper/stores/amazon';
const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn(), throttle: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    get: mocks.get,
    isAxiosError: (e: { isAxiosError?: boolean }) => e?.isAxiosError === true,
  },
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('@/lib/scraper/throttle', () => ({ throttle: mocks.throttle }));
import { fetchAmazonSearchJSON, fetchFlipkartSearchJSON } from '@/lib/scraper/http';
import { parseFlipkartSearchAPI, flipkart } from '@/lib/scraper/stores/flipkart';
import { isVerifiedMatch } from '@/lib/verified-offers';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
  mocks.get.mockResolvedValue({ data: JSON.stringify(fixture) });
});
afterEach(() => vi.unstubAllEnvs());
describe('verified portions of dedicated retailer search (offline)', () => {
  it('uses the existing Amazon adapter to load and parse dedicated India results', async () => {
    mocks.get.mockResolvedValue({ data: JSON.stringify(amazonProducts) });
    const search = amazon.search!;
    const url = search.url('love drunk 100ml', 'in');
    expect(search.parse(await search.load!(url), url)[0]).toMatchObject({
      store: 'amazon',
      price: 700,
      storeProductId: 'B0EXAMPL01',
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe('https://api.scrapingdog.com/amazon/search');
  });
  it('routes Flipkart to dedicated search when key exists', async () => {
    const search = flipkart.search!;
    const url = search.url('love drunk', 'in');
    const result = search.parse(await search.load!(url), url);
    expect(result[0]).toMatchObject({
      price: 700,
      storeProductId: 'PERFUME100ML',
      currency: '₹',
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      'https://api.scrapingdog.com/flipkart/search',
      expect.objectContaining({
        params: { api_key: 'offline-key', url },
        maxRedirects: 0,
      }),
    );
  });
  it('preserves the existing Affiliate search when no ScrapingDog key is set', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(flipkart.search!.url('test', 'in')).toContain('affiliate-api.flipkart.net');
    expect(flipkart.search!.load).toBeUndefined();
  });
  it('normalizes valid product identity and rejects AL ADHEEM', () => {
    const source = { title: 'BLA BLI BLU Love Drunk Long Lasting Perfume 100ml' };
    expect(
      isVerifiedMatch(source, parseFlipkartSearchAPI(JSON.stringify(fixture))[0]),
    ).toBe(true);
    const changed = structuredClone(fixture);
    changed.search_results[0].title = 'Blu C Chanel by AL ADHEEM Perfume 100ml';
    expect(
      isVerifiedMatch(source, parseFlipkartSearchAPI(JSON.stringify(changed))[0]),
    ).toBe(false);
  });
  it('rejects conflicting product ID, missing price, ambiguous price strings and unsafe URLs', () => {
    for (const change of [
      { product_id: 'OTHER' },
      { price: 0 },
      { price: '₹700 off' },
      { url: 'https://evil.example/p/item?pid=PERFUME100ML' },
    ]) {
      const changed = structuredClone(fixture);
      Object.assign(changed.search_results[0], change);
      expect(() => parseFlipkartSearchAPI(JSON.stringify(changed))).toThrow();
    }
  });

  it('accepts the documented Flipkart currency-price and pid-less product URLs', () => {
    const documented = structuredClone(fixture);
    documented.search_results[0].price = '₹34,990' as never;
    documented.search_results[0].url = 'https://www.flipkart.com/love-drunk/p/itmexample';
    documented.search_results[0].product_id = 'PERFUME100ML';
    const offers = parseFlipkartSearchAPI(JSON.stringify(documented));
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      store: 'flipkart',
      price: 34990,
      storeProductId: 'PERFUME100ML',
      url: 'https://www.flipkart.com/love-drunk/p/itmexample?pid=PERFUME100ML',
    });
  });
  it('skips an invalid search row when another verified row exists', () => {
    const sample = structuredClone(fixture);
    const bad = { ...sample.search_results[0], url: 'https://evil.example/p/itmexample' };
    const results = { search_results: [bad, sample.search_results[0]] };
    expect(parseFlipkartSearchAPI(JSON.stringify(results))).toHaveLength(1);
    expect(() =>
      parseFlipkartSearchAPI(JSON.stringify({ search_results: [bad] })),
    ).toThrow(/no verifiable search rows/);
  });
  it('rejects conflicting pid, altered currency and malformed INR strings', () => {
    for (const price of ['₹1,23', '$700', '₹700 discount', '₹0', '₹1,2,3']) {
      const sample = structuredClone(fixture);
      sample.search_results[0].price = price as never;
      expect(() => parseFlipkartSearchAPI(JSON.stringify(sample))).toThrow();
    }
    const badPid = structuredClone(fixture);
    badPid.search_results[0].url += '&pid=DIFFERENT';
    expect(() => parseFlipkartSearchAPI(JSON.stringify(badPid))).toThrow();
  });
  it('distinguishes empty results from malformed/error payloads', () => {
    expect(parseFlipkartSearchAPI('{"search_results":[]}')).toEqual([]);
    for (const body of ['null', '{}', '<html>maintenance</html>'])
      expect(() => parseFlipkartSearchAPI(body)).toThrow();
  });
  it('constructs only the verified Amazon request contract; response remains unparsed', async () => {
    mocks.get.mockResolvedValue({ data: JSON.stringify(amazonEmpty) });
    expect(await fetchAmazonSearchJSON('love drunk')).toBe(JSON.stringify(amazonEmpty));
    expect(mocks.get).toHaveBeenCalledWith(
      'https://api.scrapingdog.com/amazon/search',
      expect.objectContaining({
        params: {
          api_key: 'offline-key',
          query: 'love drunk',
          domain: 'in',
          page: '1',
          country: 'in',
        },
        maxRedirects: 0,
      }),
    );
  });
  it.each(['amazon', 'flipkart'])(
    'never retries %s failures and sanitizes errors',
    async (store) => {
      mocks.get.mockRejectedValue({
        isAxiosError: true,
        response: { status: 429 },
        message: 'offline-key',
      });
      const run = () =>
        store === 'amazon'
          ? fetchAmazonSearchJSON('test')
          : fetchFlipkartSearchJSON('https://www.flipkart.com/search?q=test');
      await expect(run()).rejects.toThrow('Search API failed (HTTP 429)');
      expect(mocks.get).toHaveBeenCalledTimes(1);
    },
  );
  it('requires the existing key before a provider request', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    await expect(fetchAmazonSearchJSON('test')).rejects.toThrow(/key is missing/);
    await expect(
      fetchFlipkartSearchJSON('https://www.flipkart.com/search?q=test'),
    ).rejects.toThrow(/key is missing/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

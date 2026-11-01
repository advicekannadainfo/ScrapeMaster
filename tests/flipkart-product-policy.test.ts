import { afterEach, describe, expect, it, vi } from 'vitest';
import real from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import { parseFlipkartSearchAPI, flipkart } from '@/lib/scraper/stores/flipkart';
import { cachedFlipkartSearch } from '@/lib/scraper/flipkart-evidence';

const descriptive =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itmreal?pid=PERHHD9GPW6NNYRQ';
const opaque = (suffix: string) =>
  `https://www.flipkart.com/product/p/itm${suffix}?pid=EXAMPLE${suffix.toUpperCase()}`;
const parse = (url = descriptive, body: unknown = real) =>
  parseFlipkartAPIProduct(JSON.stringify(body), url);
function cache(url: string, title = real.product_results.title) {
  parseFlipkartSearchAPI(
    JSON.stringify({
      search_results: [
        { title, url, product_id: new URL(url).searchParams.get('pid'), price: 999 },
      ],
    }),
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('URL-based provider trust with supplementary cached Search evidence', () => {
  it('preserves the exact validated request URL with dedicated routing', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    expect(flipkart.normalize(new URL(`${descriptive}&lid=SELLER1`))).toBe(
      `${descriptive}&lid=SELLER1`,
    );
  });
  it('rejects unsupported pack/variant selectors instead of silently changing selected quantity', () => {
    for (const selector of ['quantity=2', 'size=100ml', 'sku=OTHER'])
      expect(() => parse(`${descriptive}&${selector}`)).toThrow(/unsupported/);
  });
  it('keeps the HTML fallback fail-closed without canonical identity and explicit stock', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    const fallback = flipkart.productAPI!.fallback!;
    expect(() => fallback.parse('<h1>Wrong product</h1>', descriptive)).toThrow(
      /canonical product identity/,
    );
    expect(() =>
      fallback.parse(
        `<link rel="canonical" href="${descriptive}"><h1>Product</h1>`,
        descriptive,
      ),
    ).toThrow(/stock is unknown/);
  });
  it('accepts a consistent real response without response PID using descriptive URL evidence', () => {
    expect(parse()).toMatchObject({
      currentPrice: 250,
      originalPrice: 275,
      variant: '30ml',
      currency: '₹',
      isOutOfStock: false,
    });
    expect(parse()).not.toHaveProperty('storeProductId');
    expect(parse().description).toContain('response PID not independently verified');
  });
  it('does not require SKU equality with request PID or claim that proves identity', () => {
    expect(
      parse(descriptive.replace('PERHHD9GPW6NNYRQ', 'DIFFERENTREQUESTID')).currentPrice,
    ).toBe(250);
  });
  it('accepts cached Search URL/product_id/title as supplementary corroboration for opaque URLs', () => {
    const url = opaque('cached');
    cache(url);
    expect(parse(url).currentPrice).toBe(250); // Cached price 999 must not replace selected Product price.
    expect(parse(url).description).toContain('cached Search');
  });
  it('requires semantic evidence, never request PID or SKU alone', () => {
    expect(() => parse(opaque('unknown'))).toThrow(/corroboration/);
    expect(() =>
      parse('https://www.flipkart.com/perfume/p/itmunknown?pid=PERHHD9GPW6NNYRQ'),
    ).toThrow(/corroboration/);
  });
  it('rejects cached wrong fragrance/brand instead of trusting URL/PID alone', () => {
    const url = opaque('wrong');
    cache(url, 'Blu C Chanel by AL ADHEEM Perfume 30 ml');
    expect(() => parse(url)).toThrow(/cached search identity conflicts/);
  });
  it('rejects cached 100ml against selected 30ml', () => {
    const url = opaque('size');
    cache(url, real.product_results.title.replace('30 ml', '100 ml'));
    expect(() => parse(url)).toThrow(/cached search identity conflicts/);
  });
  it('expires cached corroboration and does not request more evidence', () => {
    vi.useFakeTimers();
    const url = opaque('expiry');
    cache(url);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(cachedFlipkartSearch(url)).toBeUndefined();
    expect(() => parse(url)).toThrow(/corroboration/);
  });
  it('cached evidence cannot leak across request PID or canonical path', () => {
    const url = opaque('bound');
    cache(url);
    expect(() => parse(url.replace('EXAMPLEBOUND', 'OTHER'))).toThrow(/corroboration/);
    expect(() => parse(url.replace('itmbound', 'itmother'))).toThrow(/corroboration/);
  });
  it('rejects response identity, URL quantity and model conflicts', () => {
    expect(() => parse(descriptive.replace('30-ml', '100-ml'))).toThrow(
      /quantity conflicts/,
    );
    expect(() => parse(descriptive.replace('love-drunk', 'other-fragrance'))).toThrow(
      /corroboration/,
    );
    expect(() =>
      parse(descriptive, { product_results: { ...real.product_results, pid: 'OTHER' } }),
    ).toThrow(/identity conflicts/);
  });
  it('does not cache any rows from partially invalid Search payloads', () => {
    const url = opaque('invalidbatch');
    expect(() =>
      parseFlipkartSearchAPI(
        JSON.stringify({
          search_results: [
            {
              title: real.product_results.title,
              url,
              product_id: 'EXAMPLEINVALIDBATCH',
              price: 250,
            },
            { title: 'Invalid', url, product_id: 'WRONG', price: 1 },
          ],
        }),
      ),
    ).toThrow();
    expect(cachedFlipkartSearch(url)).toBeUndefined();
  });
  it('uses opt-in paid fallback and disables dedicated routing without a key', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    expect(flipkart.productAPI?.matches(new URL(descriptive))).toBe(true);
    expect(flipkart.productAPI?.fallback?.paid).toBe(true);
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(flipkart.productAPI).toBeUndefined();
  });
});

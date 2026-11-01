import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn(), throttle: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    get: mocks.get,
    isAxiosError: (e: { isAxiosError?: boolean }) => e?.isAxiosError === true,
  },
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('@/lib/scraper/throttle', () => ({ throttle: mocks.throttle }));
import { fetchAmazonProductJSON, fetchFlipkartProductJSON } from '@/lib/scraper/http';
import {
  amazonIndiaProductInput,
  flipkartProductInput,
} from '@/lib/scraper/retail-product-input';
import { amazon } from '@/lib/scraper/stores/amazon';
import { flipkart } from '@/lib/scraper/stores/flipkart';
import amazonProduct from './fixtures/amazon-india-product.json';
import flipkartProduct from './fixtures/flipkart-product-real.json';
import { scrapeProduct } from '@/lib/scraper';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only-key');
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
  mocks.get.mockResolvedValue({
    data: 'opaque offline response; deliberately not a guessed Product schema',
  });
});
afterEach(() => vi.unstubAllEnvs());
const amazonURL = 'https://www.amazon.in/perfume/dp/B0EXAMPL01?tag=example';
const flipkartURL = 'https://www.flipkart.com/perfume/p/itmexample?pid=PERFUME100ML';
describe('prepared Product transports; no live network', () => {
  it('routes Flipkart exact URL to Product API once and returns selected 30ml, not a verified PID', async () => {
    const url =
      'https://www.flipkart.com/bla-bli-blu-love-drunk-cinnamon-date-perfume-30-ml/p/itmreal?pid=PERHHD9GPW6NNYRQ';
    mocks.get.mockResolvedValue({ data: JSON.stringify(flipkartProduct) });
    const product = await scrapeProduct(url);
    expect(product).toMatchObject({ currentPrice: 250, variant: '30ml', url });
    expect(product).not.toHaveProperty('storeProductId');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe(
      'https://api.scrapingdog.com/flipkart/product',
    );
    expect(mocks.get.mock.calls[0][1]).toMatchObject({
      params: { url },
      maxRedirects: 0,
    });
  });
  it('does not retry or fall back after a paid Flipkart request fails', async () => {
    mocks.get.mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
    await expect(scrapeProduct(flipkartURL)).rejects.toThrow(/HTTP 429/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('does not retry or pay for fallback after Flipkart identity rejection even with fallback budget', async () => {
    mocks.get.mockResolvedValue({ data: JSON.stringify(flipkartProduct) });
    await expect(
      scrapeProduct(flipkartURL, { allowFallback: true, maxPaidRequests: 2 }),
    ).rejects.toThrow(/corroboration/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('runs Amazon URL -> dedicated transport -> exact product parser without database work', async () => {
    mocks.get.mockResolvedValue({ data: JSON.stringify(amazonProduct) });
    expect(await scrapeProduct('https://www.amazon.in/dp/B0FYGRL51R')).toMatchObject({
      currentPrice: 184,
      storeProductId: 'B0FYGRL51R',
      variant: '30ml',
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe('https://api.scrapingdog.com/amazon/product');
  });
  it('extracts ASIN and sends only the supplied Amazon India request contract', async () => {
    await fetchAmazonProductJSON(amazonURL);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      'https://api.scrapingdog.com/amazon/product',
      expect.objectContaining({
        params: {
          api_key: 'offline-only-key',
          asin: 'B0EXAMPL01',
          domain: 'in',
          country: 'in',
        },
        maxRedirects: 0,
      }),
    );
  });
  it('preserves Flipkart URL selectors and sends only the dedicated request', async () => {
    await fetchFlipkartProductJSON(flipkartURL);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      'https://api.scrapingdog.com/flipkart/product',
      expect.objectContaining({
        params: { api_key: 'offline-only-key', url: flipkartURL },
        maxRedirects: 0,
      }),
    );
  });
  it.each([
    'http://www.amazon.in/dp/B0EXAMPL01',
    'https://amazon.in.evil.test/dp/B0EXAMPL01',
    'https://www.amazon.com/dp/B0EXAMPL01',
    'https://user:password@www.amazon.in/dp/B0EXAMPL01',
    'https://www.amazon.in/dp/B0EXAMPL011',
    'https://www.amazon.in/search',
    'https://www.amazon.in/dp/B0EXAMPL01?quantity=2',
  ])('rejects unsupported Amazon target %s', (url) => {
    expect(() => amazonIndiaProductInput(url)).toThrow();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([
    'https://flipkart.com.evil.test/x/p/itmexample',
    'https://www.flipkart.com/search?q=test',
    'https://127.0.0.1/x/p/itmexample',
    'https://www.flipkart.com/x/p/itmexample?pid=A&pid=B',
  ])('rejects unsupported Flipkart target %s', (url) => {
    expect(() => flipkartProductInput(url)).toThrow();
  });
  it('requires a secret before network work', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    await expect(fetchAmazonProductJSON(amazonURL)).rejects.toThrow(/key is missing/);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('retains private-address rejection', async () => {
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1' }]);
    await expect(fetchFlipkartProductJSON(flipkartURL)).rejects.toThrow(/not allowed/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('does not retry or leak Axios details', async () => {
    mocks.get.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429 },
      message: 'offline-only-key',
    });
    await expect(fetchAmazonProductJSON(amazonURL)).rejects.toThrow(
      'amazon Product API failed (HTTP 429)',
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('activates Amazon India and URL-trusted Flipkart Product routes', () => {
    expect(amazon.productAPI).toBeDefined();
    expect(flipkart.productAPI).toBeDefined();
  });
});

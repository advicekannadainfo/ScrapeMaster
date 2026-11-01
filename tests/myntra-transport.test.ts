import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/myntra-product.json';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  lookup: vi.fn(),
  robots: vi.fn(),
  throttle: vi.fn(),
}));
vi.mock('axios', () => ({
  default: {
    get: mocks.get,
    isAxiosError: (e: { isAxiosError?: boolean }) => e?.isAxiosError === true,
  },
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('@/lib/scraper/robots', () => ({ assertRobotsAllowed: mocks.robots }));
vi.mock('@/lib/scraper/throttle', () => ({ throttle: mocks.throttle }));

import { scrapeProduct } from '@/lib/scraper';
import { fetchMyntraProductJSON } from '@/lib/scraper/http';
import {
  HealthRegistry,
  getHealthRegistry,
  setHealthRegistry,
} from '@/lib/scraper/health';

const url = 'https://www.myntra.com/jeans/powerlook/jeans/31076617/buy';
describe('dedicated Myntra transport (all network calls mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-test-key');
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
    mocks.get.mockResolvedValue({ data: JSON.stringify(fixture) });
    setHealthRegistry(new HealthRegistry());
  });
  afterEach(() => vi.unstubAllEnvs());

  it('routes product scraping to the dedicated API and parses the JSON', async () => {
    expect(await scrapeProduct(url)).toMatchObject({ currentPrice: 1159, currency: '₹' });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      'https://api.scrapingdog.com/myntra/product',
      expect.objectContaining({
        params: { api_key: 'offline-test-key', url },
        maxRedirects: 0,
        responseType: 'text',
      }),
    );
    expect(mocks.robots).toHaveBeenCalledWith(url);
    expect(mocks.throttle).toHaveBeenCalledWith(url);
    expect(getHealthRegistry().all()[0]).toMatchObject({
      source: 'myntra.com:product',
      recent: [true],
    });
  });
  it.each([429, 500])(
    'does not retry paid requests on HTTP %s and sanitizes errors',
    async (status) => {
      mocks.get.mockRejectedValue({
        isAxiosError: true,
        response: { status },
        message: 'offline-test-key',
      });
      await expect(scrapeProduct(url)).rejects.toThrow(
        `Myntra Product API failed (HTTP ${status})`,
      );
      expect(mocks.get).toHaveBeenCalledTimes(1);
      expect(getHealthRegistry().all()[0].recent).toEqual([false]);
    },
  );
  it('does not retry timeouts', async () => {
    mocks.get.mockRejectedValue({ isAxiosError: true, code: 'ECONNABORTED' });
    await expect(scrapeProduct(url)).rejects.toMatchObject({ kind: 'timeout' });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('does not fall back or retry malformed provider responses', async () => {
    mocks.get.mockResolvedValue({ data: '<html>Site Maintenance</html>' });
    await expect(scrapeProduct(url)).rejects.toThrow(/invalid JSON/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('honors the circuit breaker before making any further paid request', async () => {
    mocks.get.mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
    for (let i = 0; i < 3; i++) await expect(scrapeProduct(url)).rejects.toThrow();
    expect(mocks.get).toHaveBeenCalledTimes(3);
    mocks.get.mockClear();
    await expect(scrapeProduct(url)).rejects.toMatchObject({ name: 'CircuitOpenError' });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('requires a key before issuing a request', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    await expect(scrapeProduct(url)).rejects.toThrow(/key is missing/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([
    'https://myntra.com.evil.test/x/31076617/buy',
    'http://www.myntra.com/x/31076617/buy',
    'https://user:password@www.myntra.com/x/31076617/buy',
    'https://www.myntra.com:8443/x/31076617/buy',
    'https://127.0.0.1/x/31076617/buy',
  ])('rejects unsafe target %s', async (target) => {
    await expect(fetchMyntraProductJSON(target)).rejects.toThrow(/Invalid Myntra/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('retains DNS private address protection', async () => {
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1' }]);
    await expect(scrapeProduct(url)).rejects.toThrow(/not allowed/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('honors robots refusal before the paid request', async () => {
    mocks.robots.mockRejectedValue(new Error('robots disallowed'));
    await expect(scrapeProduct(url)).rejects.toThrow(/robots disallowed/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

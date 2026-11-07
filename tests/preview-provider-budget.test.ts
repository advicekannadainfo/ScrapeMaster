import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mocks.get, isAxiosError: () => false } }));
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
}));
vi.mock('@/lib/scraper/robots', () => ({ assertRobotsAllowed: vi.fn() }));
vi.mock('@/lib/scraper/throttle', () => ({ throttle: vi.fn() }));
import {
  withPreviewProviderBudget,
  reservePreviewProviderRequest,
} from '@/lib/scraper/preview-provider-budget';
import {
  fetchAmazonProductJSON,
  fetchFlipkartProductJSON,
  fetchAmazonSearchJSON,
  fetchMyntraSearchJSON,
  fetchMyntraProductJSON,
  fetchHtml,
} from '@/lib/scraper/http';
import { DRY_RUN_URL } from '@/lib/preview-fragrance-dry-run';
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  mocks.get.mockReset();
  mocks.get.mockResolvedValue({ data: '{}' });
});
afterEach(() => vi.unstubAllEnvs());
describe('actual dedicated transport boundary hard cap; axios/DNS/robots ALL mocked', () => {
  it('allows only five approved routes, at most once each, and rejects generic fallback', async () => {
    await withPreviewProviderBudget(async (budget) => {
      await fetchFlipkartProductJSON(DRY_RUN_URL);
      await Promise.all([
        fetchAmazonSearchJSON('test perfume'),
        fetchMyntraSearchJSON('https://www.myntra.com/test-perfume'),
      ]);
      await Promise.all([
        fetchAmazonProductJSON('https://www.amazon.in/dp/B0TEST0001'),
        fetchMyntraProductJSON('https://www.myntra.com/perfume/12345678/buy'),
      ]);
      expect(budget.used).toBe(5);
      await expect(fetchAmazonSearchJSON('another')).rejects.toThrow(/budget/);
      await expect(fetchHtml('https://www.amazon.in/dp/B0TEST0001')).rejects.toThrow(
        /Generic/,
      );
      expect(mocks.get).toHaveBeenCalledTimes(5);
      expect(mocks.get.mock.calls[0][1].params.url).toBe(DRY_RUN_URL);
      for (const [, options] of mocks.get.mock.calls)
        expect(options.maxRedirects).toBe(0);
    });
  });
  it('does not reset a nested budget or retry a failed provider', async () => {
    mocks.get.mockRejectedValue(new Error('PRIVATE_TOKEN'));
    await withPreviewProviderBudget(async (budget) => {
      await expect(fetchAmazonSearchJSON('test')).rejects.toThrow('Search API failed');
      await expect(fetchAmazonSearchJSON('test')).rejects.toThrow(/budget/);
      await expect(withPreviewProviderBudget(async () => {})).rejects.toThrow(/Nested/);
      expect(budget.used).toBe(1);
      expect(mocks.get).toHaveBeenCalledTimes(1);
    });
  });
  it('rejects non-approved store routes and non-preview invocation before transport', async () => {
    await withPreviewProviderBudget(async () =>
      expect(() => reservePreviewProviderRequest('flipkart', 'search')).toThrow(/denied/),
    );
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(withPreviewProviderBudget(async () => {})).rejects.toThrow(/Preview/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

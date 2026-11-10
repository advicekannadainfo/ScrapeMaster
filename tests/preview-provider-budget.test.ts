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
  createPreviewTrackingBudget,
  previewBudgetActive,
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
  vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'false');
  mocks.get.mockReset();
  mocks.get.mockResolvedValue({ data: '{}' });
});
describe('Preview website budget shared across explicitly deferred lifecycle phases', () => {
  beforeEach(() => {
    vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'true');
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  });
  it('re-enters the same budget after tracking scope has exited and caps all five HTTP attempts', async () => {
    const flow = createPreviewTrackingBudget();
    await flow.track(async () => {
      await fetchFlipkartProductJSON(DRY_RUN_URL);
      await expect(fetchFlipkartProductJSON(DRY_RUN_URL)).rejects.toThrow(/budget/);
      await expect(fetchAmazonSearchJSON('too early')).rejects.toThrow(/budget/);
    });
    expect(previewBudgetActive()).toBe(false);
    await expect(fetchAmazonSearchJSON('outside flow')).rejects.toThrow(/bounded/);
    await flow.compare(async () => {
      await Promise.all([
        fetchAmazonSearchJSON('test perfume'),
        fetchMyntraSearchJSON('https://www.myntra.com/test-perfume'),
      ]);
      await Promise.all([
        fetchAmazonProductJSON('https://www.amazon.in/dp/B0TEST0001'),
        fetchMyntraProductJSON('https://www.myntra.com/perfume/12345678/buy'),
      ]);
      await expect(fetchAmazonSearchJSON('second page')).rejects.toThrow(/budget/);
      await expect(fetchMyntraSearchJSON('https://www.myntra.com/page2')).rejects.toThrow(
        /budget/,
      );
      await expect(
        fetchAmazonProductJSON('https://www.amazon.in/dp/B0TEST0002'),
      ).rejects.toThrow(/budget/);
      await expect(
        fetchMyntraProductJSON('https://www.myntra.com/perfume/12345679/buy'),
      ).rejects.toThrow(/budget/);
      await expect(fetchFlipkartProductJSON(DRY_RUN_URL)).rejects.toThrow(/budget/);
      await expect(fetchHtml(DRY_RUN_URL)).rejects.toThrow(/Generic/);
    });
    await expect(flow.compare(async () => {})).rejects.toThrow(/unavailable/);
    await expect(flow.track(async () => {})).rejects.toThrow(/already/);
    expect(flow.summary()).toMatchObject({ maximum: 5, used: 5 });
    expect(mocks.get).toHaveBeenCalledTimes(5);
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
  });
  it('consumes failed source attempts and cannot start comparison or retry', async () => {
    const flow = createPreviewTrackingBudget();
    mocks.get.mockRejectedValue(new Error('PRIVATE_TOKEN'));
    await expect(flow.track(() => fetchFlipkartProductJSON(DRY_RUN_URL))).rejects.toThrow(
      /failed/,
    );
    await expect(flow.track(() => fetchFlipkartProductJSON(DRY_RUN_URL))).rejects.toThrow(
      /already/,
    );
    await expect(flow.compare(async () => {})).rejects.toThrow(/unavailable/);
    expect(flow.summary().used).toBe(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('fails closed with global hydration enabled and cannot create a website scope in Production', async () => {
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'true');
    expect(() => createPreviewTrackingBudget()).toThrow(/unavailable/);
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => createPreviewTrackingBudget()).toThrow(/unavailable/);
    await fetchAmazonSearchJSON('normal production transport');
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
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
  it('enforces the three-slot Amazon-only budget at the HTTP boundary, denying Myntra and every repeat', async () => {
    await withPreviewProviderBudget(async (budget) => {
      expect(budget.maximum).toBe(3);
      await expect(
        fetchMyntraSearchJSON('https://www.myntra.com/test-perfume'),
      ).rejects.toThrow(/denied/);
      await expect(
        fetchMyntraProductJSON('https://www.myntra.com/perfume/12345678/buy'),
      ).rejects.toThrow(/denied/);
      expect(budget.used).toBe(0);
      await fetchFlipkartProductJSON(DRY_RUN_URL);
      await fetchAmazonSearchJSON('test perfume');
      await fetchAmazonProductJSON('https://www.amazon.in/dp/B0TEST0001');
      await expect(fetchAmazonSearchJSON('second page')).rejects.toThrow(/budget/);
      await expect(
        fetchAmazonProductJSON('https://www.amazon.in/dp/B0TEST0002'),
      ).rejects.toThrow(/budget/);
      await expect(fetchFlipkartProductJSON(DRY_RUN_URL)).rejects.toThrow(/budget/);
      await expect(fetchHtml(DRY_RUN_URL)).rejects.toThrow(/Generic/);
      expect(budget.used).toBe(3);
      expect(budget.routes).toEqual({
        'flipkart:product': 1,
        'amazon:search': 1,
        'amazon:product': 1,
      });
      expect(mocks.get).toHaveBeenCalledTimes(3);
      for (const [, options] of mocks.get.mock.calls)
        expect(options.maxRedirects).toBe(0);
    }, 'amazon-only');
  });
  it('counts a failed Amazon-only attempt and never retries or accepts a nested wider budget', async () => {
    mocks.get.mockRejectedValue(new Error('PRIVATE_TOKEN'));
    await withPreviewProviderBudget(async (budget) => {
      await expect(fetchAmazonSearchJSON('test')).rejects.toThrow('Search API failed');
      await expect(fetchAmazonSearchJSON('test')).rejects.toThrow(/budget/);
      await expect(withPreviewProviderBudget(async () => {})).rejects.toThrow(/Nested/);
      expect(budget.used).toBe(1);
      expect(mocks.get).toHaveBeenCalledTimes(1);
    }, 'amazon-only');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/scraper/stores', async () => {
  const { reservePreviewProviderRequest } =
    await import('@/lib/scraper/preview-provider-budget');
  const adapter = (id: string) => ({
    id,
    normalize: (u: URL) => u.toString(),
    productAPI: {
      matches: () => true,
      load: async (url: string) => {
        reservePreviewProviderRequest(id === 'myntra.com' ? 'myntra' : id, 'product');
        return mocks.load(id, url);
      },
      parse: JSON.parse,
    },
    search: {
      url: () => `https://${id}/search`,
      load: async () => {
        reservePreviewProviderRequest(id === 'myntra.com' ? 'myntra' : id, 'search');
        return mocks.search(id);
      },
      parse: JSON.parse,
    },
  });
  const flipkart = adapter('flipkart'),
    amazon = adapter('amazon'),
    myntra = adapter('myntra.com');
  return {
    flipkart,
    amazon,
    myntra,
    resolveStore: (url: URL) =>
      url.hostname.includes('amazon')
        ? amazon
        : url.hostname.includes('myntra')
          ? myntra
          : flipkart,
  };
});
vi.mock('@/lib/scraper/index', async () => {
  const { resolveStore } = await import('@/lib/scraper/stores');
  return {
    scrapeProduct: async (url: string, policy: unknown) => {
      expect(policy).toEqual({ allowFallback: false, maxPaidRequests: 1 });
      const api = resolveStore(new URL(url)).productAPI!;
      return api.parse(await api.load(url), url);
    },
  };
});
vi.mock('@/lib/services/offers', () => {
  throw new Error('WRITE SERVICE MUST NEVER BE IMPORTED');
});
vi.mock('@/lib/services/refresh', () => {
  throw new Error('REFRESH MUST NEVER BE IMPORTED');
});
import {
  runFragranceDryRun,
  DRY_RUN_URL,
  DRY_RUN_INPUT_URL,
} from '@/lib/preview-fragrance-dry-run';
import { withFragranceProduct } from './support/fragrance-product';
import { createFragranceHydrator } from '@/lib/scraper/hydrate-fragrance';
const urls: Record<string, string> = {
  flipkart: DRY_RUN_URL,
  amazon: 'https://www.amazon.in/dp/B0TEST0001',
  'myntra.com': 'https://www.myntra.com/perfume/acme/12345678/buy',
};
// Synthetic selected-main contracts, not captured Old Money responses.
function product(store = 'flipkart') {
  return {
    ...withFragranceProduct({
      title: 'BLA BLI BLU Old Money Perfume 30ml',
      brand: 'BLA BLI BLU',
      variant: '30ml',
      store,
      storeName: store,
      url: urls[store],
      currentPrice: 200,
      currency: '₹',
    }),
    image: 'https://example.com/image.jpg',
    isOutOfStock: false,
  };
}
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  mocks.load.mockReset();
  mocks.search.mockReset();
  mocks.load.mockImplementation(async (store: string) => JSON.stringify(product(store)));
  mocks.search.mockImplementation(async (store: string) =>
    JSON.stringify([
      {
        ...product(store),
        canonicalIdentity: undefined,
        priceObservation: undefined,
        price: 200,
      },
    ]),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe('ephemeral Preview orchestration; every provider boundary mocked', () => {
  it('cannot enable normal UI or override hydration outside an isolated Preview budget', async () => {
    expect(createFragranceHydrator(product()).enabled).toBe(false);
    expect(createFragranceHydrator(product(), { previewDryRun: true }).enabled).toBe(
      false,
    );
    await runFragranceDryRun(product());
    expect(createFragranceHydrator(product(), { previewDryRun: true }).enabled).toBe(
      false,
    );
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
  });
  it('uses four requests with a fresh stored source, leaves flag and record unchanged', async () => {
    const source = product(),
      before = JSON.stringify(source);
    const result = await runFragranceDryRun(source);
    expect(result.budget.used).toBe(4);
    expect(result.stores.every((s) => s.verification === 'verified')).toBe(true);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(
      /Old Money|https|offline-key|PERHH|canonicalIdentity/,
    );
  });
  it('uses at most five with exactly one ephemeral source fetch, never saving fresh data', async () => {
    const source = { ...product(), canonicalIdentity: null, priceObservation: null };
    const result = await runFragranceDryRun(source);
    expect(result.budget.used).toBe(5);
    expect(result.source).toMatchObject({ fetched: true, status: 'verified' });
    expect(mocks.load.mock.calls.map((c) => c[0]).sort()).toEqual([
      'amazon',
      'flipkart',
      'myntra.com',
    ]);
    expect(source.canonicalIdentity).toBeNull();
    expect(mocks.load.mock.calls.filter((c) => c[0] === 'flipkart')).toEqual([
      ['flipkart', DRY_RUN_URL],
    ]);
    expect(result.budget.maximum).toBe(5);
  });
  it('stops after the one source fetch if independently selected volume is still missing', async () => {
    const p = product();
    const e = structuredClone(p.canonicalIdentity)!;
    delete e.selected.volume;
    e.issues = ['volume-unconfirmed'];
    p.canonicalIdentity = e;
    mocks.load.mockResolvedValue(JSON.stringify(p));
    const result = await runFragranceDryRun({ ...product(), canonicalIdentity: null });
    expect(result.source.status).toBe('selected-product-proof-missing');
    expect(result.budget.used).toBe(1);
    expect(result.stores).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it('does not retry or try another candidate and preserves the other store result on failure', async () => {
    mocks.load.mockImplementation(async (store: string) => {
      if (store === 'amazon') throw new Error('PRIVATE_API_KEY');
      return JSON.stringify(product(store));
    });
    const result = await runFragranceDryRun(product());
    expect(result.budget.used).toBe(4);
    expect(result.stores.find((s) => s.store === 'amazon')?.verification).toBe(
      'rejected',
    );
    expect(result.stores.find((s) => s.store === 'myntra.com')?.verification).toBe(
      'verified',
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('does not accept another stored product or reuse global hydration cache in a new dry run', async () => {
    expect(
      (await runFragranceDryRun({ ...product(), url: urls.amazon })).budget.used,
    ).toBe(0);
    expect((await runFragranceDryRun(product())).budget.used).toBe(4);
    expect((await runFragranceDryRun(product())).budget.used).toBe(4);
    expect(mocks.load).toHaveBeenCalledTimes(4);
  });
  it('does not rebind short-URL evidence to the full stored URL without a fresh Product response', async () => {
    const stored = product();
    const e = structuredClone(stored.canonicalIdentity)!;
    e.source.url = DRY_RUN_INPUT_URL;
    stored.canonicalIdentity = e;
    const before = JSON.stringify(stored);
    const result = await runFragranceDryRun(stored);
    expect(result.source).toMatchObject({ fetched: true, status: 'verified' });
    expect(mocks.load.mock.calls.filter((c) => c[0] === 'flipkart')).toEqual([
      ['flipkart', DRY_RUN_URL],
    ]);
    expect(result.budget.used).toBe(5);
    expect(JSON.stringify(stored)).toBe(before);
    expect(
      (await runFragranceDryRun({ ...stored, url: DRY_RUN_INPUT_URL })).budget.used,
    ).toBe(0);
  });
  it('returns the sanitized per-store rejection code without retaining raw provider evidence', async () => {
    mocks.load.mockImplementation(async (store: string) =>
      JSON.stringify({ ...product(store), currentPrice: store === 'amazon' ? 201 : 200 }),
    );
    const result = await runFragranceDryRun({ ...product(), canonicalIdentity: null });
    expect(result.budget.used).toBe(5);
    expect(result.stores.find((s) => s.store === 'amazon')).toMatchObject({
      reason: 'missing-provider-proof',
      rejectionReason: 'stale-or-unbound-price',
    });
    expect(result.stores.find((s) => s.store === 'myntra.com')?.verification).toBe(
      'verified',
    );
    expect(JSON.stringify(result)).not.toMatch(
      /Old Money|https|offline-key|canonicalIdentity|priceObservation/,
    );
  });
  it.each([false, true])(
    'Amazon-only uses at most three attempts (source refresh=%s), never Myntra or DB writes',
    async (refresh) => {
      const source = product();
      const record = refresh ? { ...source, canonicalIdentity: null } : source;
      const before = JSON.stringify(record);
      const result = await runFragranceDryRun(record, 'amazon-only');
      expect(result.budget).toEqual({
        maximum: 3,
        used: refresh ? 3 : 2,
        routes: {
          ...(refresh ? { 'flipkart:product': 1 } : {}),
          'amazon:search': 1,
          'amazon:product': 1,
        },
      });
      expect(result.stores).toHaveLength(1);
      expect(result.stores[0]).toMatchObject({
        store: 'amazon',
        verification: 'verified',
        searchFound: 1,
        eligibleCandidates: 1,
      });
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(mocks.search).toHaveBeenCalledWith('amazon');
      expect(mocks.load.mock.calls).toEqual([
        ...(refresh ? [['flipkart', DRY_RUN_URL]] : []),
        ['amazon', urls.amazon],
      ]);
      expect(JSON.stringify(record)).toBe(before);
      expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
    },
  );
  it('Amazon-only stops after source proof failure, preserving strict URL binding', async () => {
    const p = product();
    delete p.canonicalIdentity!.selected.volume;
    p.canonicalIdentity!.issues = ['volume-unconfirmed'];
    mocks.load.mockResolvedValue(JSON.stringify(p));
    const result = await runFragranceDryRun(
      { ...product(), canonicalIdentity: null },
      'amazon-only',
    );
    expect(result.source.status).toBe('selected-product-proof-missing');
    expect(result.budget).toMatchObject({ maximum: 3, used: 1 });
    expect(result.stores).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
    const unbound = await runFragranceDryRun(
      { ...product(), url: DRY_RUN_INPUT_URL },
      'amazon-only',
    );
    expect(unbound.budget.used).toBe(0);
  });
  it('Amazon-only preserves sanitized rejection details without trying a second candidate or another store', async () => {
    mocks.load.mockImplementation(async (store: string) =>
      JSON.stringify({ ...product(store), currentPrice: store === 'amazon' ? 201 : 200 }),
    );
    mocks.search.mockResolvedValue(
      JSON.stringify([
        { ...product('amazon'), price: 200 },
        { ...product('amazon'), url: 'https://www.amazon.in/dp/B0TEST0002', price: 200 },
      ]),
    );
    const result = await runFragranceDryRun(
      { ...product(), canonicalIdentity: null },
      'amazon-only',
    );
    expect(result.budget.used).toBe(3);
    expect(result.stores[0]).toMatchObject({
      store: 'amazon',
      searchFound: 2,
      eligibleCandidates: 2,
      verification: 'rejected',
      rejectionReason: 'stale-or-unbound-price',
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith('amazon');
    expect(JSON.stringify(result)).not.toMatch(
      /Old Money|https|offline-key|canonicalIdentity/,
    );
  });
  it('Amazon-only does not retry failed Search or Product attempts', async () => {
    mocks.search.mockRejectedValueOnce(new Error('PRIVATE_SEARCH_TOKEN'));
    const searchFailure = await runFragranceDryRun(product(), 'amazon-only');
    expect(searchFailure.budget.used).toBe(1);
    expect(searchFailure.stores[0].reason).toBe('search-failed');
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.load.mockRejectedValueOnce(new Error('PRIVATE_PRODUCT_TOKEN'));
    const productFailure = await runFragranceDryRun(product(), 'amazon-only');
    expect(productFailure.budget.used).toBe(2);
    expect(productFailure.stores[0]).toMatchObject({
      rejectionReason: 'provider-failure',
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([searchFailure, productFailure])).not.toContain('PRIVATE');
  });
});

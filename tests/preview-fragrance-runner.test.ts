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
import { runFragranceDryRun, DRY_RUN_URL } from '@/lib/preview-fragrance-dry-run';
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
});

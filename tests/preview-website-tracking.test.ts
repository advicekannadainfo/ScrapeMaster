import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  after: vi.fn(),
  connect: vi.fn(),
  write: vi.fn(),
  email: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: mocks.get, isAxiosError: () => false } }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connect }));
vi.mock('@/lib/nodemailer', () => ({
  generateEmailBody: vi.fn(),
  sendEmail: mocks.email,
}));
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
}));
vi.mock('@/lib/scraper/robots', () => ({ assertRobotsAllowed: vi.fn() }));
vi.mock('@/lib/scraper/throttle', () => ({ throttle: vi.fn() }));
vi.mock('@/lib/models/product.model', () => ({
  default: {
    findOne: mocks.findOne,
    findById: mocks.findById,
    find: mocks.find,
    findOneAndUpdate: mocks.upsert,
    updateOne: mocks.write,
  },
}));
import { scrapeAndStoreProduct } from '@/lib/actions';
import { DRY_RUN_URL, DRY_RUN_INPUT_URL } from '@/lib/preview-fragrance-dry-run';
import { HUSTLER_PREVIEW_TEST_URL } from '@/lib/preview-website-test-target';
import { HealthRegistry, setHealthRegistry } from '@/lib/scraper/health';
import { createFragranceHydrator } from '@/lib/scraper/hydrate-fragrance';
import { previewBudgetActive } from '@/lib/scraper/preview-provider-budget';
import { discoverOffers } from '@/lib/scraper/discovery';
import { amazon } from '@/lib/scraper/stores';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import flipkart from './fixtures/flipkart-product-real.json';
import amazonProduct from './fixtures/amazon-india-product-full.json';
import myntraProduct from './fixtures/myntra-product-real.json';

const id = '0123456789abcdef01234567';
const title = 'BLA BLI BLU Old Money Perfume 30ml';
// All Old Money responses below are SYNTHETIC transformations of captured
// contracts, solely to exercise the real action/services/parsers/HTTP boundary.
const sourceBody = () => {
  const p = structuredClone(flipkart);
  p.product_results.title = title;
  p.product_results.sku = 'PERHHHH3RYADXXH5';
  p.product_results.specifications.General['Model Name'] = 'Old Money Perfume';
  return p;
};
const source = () => parseFlipkartAPIProduct(JSON.stringify(sourceBody()), DRY_RUN_URL);
const query = <T>(result: T) => {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => result };
  return q;
};
let stored: ReturnType<typeof source> & { _id: string; offers: unknown[] };
function response(endpoint: string) {
  if (endpoint.endsWith('/flipkart/product')) return sourceBody();
  if (endpoint.endsWith('/amazon/search'))
    return {
      results: [1, 2].map((n) => ({
        type: 'search_product',
        title,
        asin: n === 1 ? 'B0FYGRL51R' : 'B0TEST0002',
        optimized_url: `https://www.amazon.in/dp/${n === 1 ? 'B0FYGRL51R' : 'B0TEST0002'}`,
        extracted_price: 250,
        currency: '₹',
        image: 'https://m.media-amazon.com/images/I/test.jpg',
        sponsored: false,
      })),
    };
  if (endpoint.endsWith('/myntra/search'))
    return {
      search_results: [
        {
          productId: 36340100,
          productName: title,
          brand: 'BLA BLI BLU',
          price: 650,
          mrp: 1000,
          landingPageUrl: 'perfume/bla-bli-blu/old-money/36340100/buy',
          inventoryInfo: [
            { skuId: 116095841, label: '30ml', inventory: 10, available: true },
          ],
        },
      ],
    };
  if (endpoint.endsWith('/amazon/product')) {
    const p = structuredClone(amazonProduct);
    p.title = title;
    p.main_title = title;
    p.product_information['Model Name'] = title;
    return p; // keep the real pack/oil facts: comparison MUST still reject them
  }
  if (endpoint.endsWith('/myntra/product')) {
    const p = structuredClone(myntraProduct);
    p.product_results.name = title;
    p.product_results.selectedSeller.netQuantity[0].quantity = 30;
    return p;
  }
  throw new Error('Unapproved provider endpoint');
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'true');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  setHealthRegistry(new HealthRegistry());
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  stored = { ...source(), _id: id, offers: [] };
  mocks.get.mockImplementation(async (endpoint: string) => ({
    data: JSON.stringify(response(endpoint)),
  }));
  mocks.findOne.mockImplementation(() => query(null));
  mocks.upsert.mockImplementation((_filter, update) => {
    stored = { ...stored, ...update };
    return query({ _id: id });
  });
  mocks.findById.mockImplementation(() => query(stored));
  mocks.find.mockImplementation(() => query([]));
  mocks.write.mockResolvedValue({ acknowledged: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('real Track action -> real tracking/offer services -> deferred after -> actual dedicated transports (all IO mocked)', () => {
  it('shares five slots across the deferred callback, binds the approved URL and keeps exact matching strict', async () => {
    const result = await scrapeAndStoreProduct(DRY_RUN_INPUT_URL);
    expect(result).toEqual({ ok: true, data: { id } });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][1].params.url).toBe(DRY_RUN_URL);
    expect(previewBudgetActive()).toBe(false);
    expect(createFragranceHydrator(source()).enabled).toBe(false);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    // Execute after explicitly OUTSIDE the tracking AsyncLocalStorage context.
    const deferred = mocks.after.mock.calls[0][0];
    await deferred();
    const routes = mocks.get.mock.calls
      .map(([endpoint]) => new URL(endpoint).pathname)
      .sort();
    expect(routes).toEqual([
      '/amazon/product',
      '/amazon/search',
      '/flipkart/product',
      '/myntra/product',
      '/myntra/search',
    ]);
    expect(mocks.get).toHaveBeenCalledTimes(5);
    for (const [, options] of mocks.get.mock.calls) expect(options.maxRedirects).toBe(0);
    expect(
      mocks.get.mock.calls.find(([url]) => url.endsWith('/amazon/search'))![1].params
        .page,
    ).toBe('1');
    // Amazon's uncorroborated pack/formulation never becomes a verified offer.
    const savedOffers = mocks.write.mock.calls[0][1].$set.offers;
    expect(savedOffers.some((offer: { store: string }) => offer.store === 'amazon')).toBe(
      false,
    );
    await deferred(); // even a duplicate framework callback cannot reset the budget
    expect(mocks.get).toHaveBeenCalledTimes(5);
    expect(previewBudgetActive()).toBe(false);
    expect(createFragranceHydrator(source()).enabled).toBe(false);
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
    expect(mocks.email).not.toHaveBeenCalled();
    // MongoDB methods above are memory-only vi.fn mocks, never a live database.
  });
  it("does not attach another flow's pending discovery promise", async () => {
    vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'false');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.get.mockImplementationOnce(async (endpoint: string) => {
      await gate;
      return { data: JSON.stringify(response(endpoint)) };
    });
    const pending = discoverOffers(amazon, 'BLA BLI BLU old money 30ml', 'in');
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    mocks.get.mockClear();
    vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'true');
    await scrapeAndStoreProduct(DRY_RUN_INPUT_URL);
    const deferred = mocks.after.mock.calls[0][0]();
    try {
      await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(5));
    } finally {
      release();
      await Promise.all([pending, deferred]);
    }
  });
  it('consumes failed competitor calls without retry, fallback or a second Search candidate', async () => {
    mocks.get.mockImplementation(async (endpoint: string) => {
      if (endpoint.endsWith('/amazon/product')) throw new Error('PRIVATE_PROVIDER_ERROR');
      return { data: JSON.stringify(response(endpoint)) };
    });
    await scrapeAndStoreProduct(DRY_RUN_URL);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.get).toHaveBeenCalledTimes(5);
    expect(
      mocks.get.mock.calls.filter(([url]) => url.endsWith('/amazon/product')),
    ).toHaveLength(1);
  });
  it('does not hydrate competitors when source independent volume is missing', async () => {
    mocks.get.mockImplementation(async (endpoint: string) => {
      const body = response(endpoint);
      if (endpoint.endsWith('/flipkart/product')) {
        const p = body as ReturnType<typeof sourceBody>;
        delete (
          p.product_results.specifications.General as Partial<
            typeof p.product_results.specifications.General
          >
        ).Quantity;
        delete (
          p.product_results.specifications.General as Partial<
            typeof p.product_results.specifications.General
          >
        )['Net Quantity'];
        delete (
          p.product_results.specifications as Partial<
            typeof p.product_results.specifications
          >
        )['Product Highlights'];
        p.product_results.highlights = [];
      }
      return { data: JSON.stringify(body) };
    });
    const result = await scrapeAndStoreProduct(DRY_RUN_URL);
    expect(result.ok).toBe(true);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.get.mock.calls.filter(([url]) => url.endsWith('/product'))).toHaveLength(
      1,
    );
    expect(mocks.get.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it('rejects unapproved URLs and enabled global hydration before any source or database access', async () => {
    expect((await scrapeAndStoreProduct('https://www.amazon.in/dp/B0FYGRL51R')).ok).toBe(
      false,
    );
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'true');
    expect((await scrapeAndStoreProduct(DRY_RUN_URL)).ok).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('source failure never schedules comparison or writes a product', async () => {
    mocks.get.mockRejectedValue(new Error('PRIVATE_SOURCE_TOKEN'));
    expect((await scrapeAndStoreProduct(DRY_RUN_URL)).ok).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('ignores the website test flag in Production and preserves ordinary Amazon tracking', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const result = await scrapeAndStoreProduct('https://www.amazon.in/dp/B0FYGRL51R');
    expect(result.ok).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toMatch(/amazon\/product$/);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
  it('tracks exact Hustler 90ml selectors through the real action, with bounded deferred comparison and no fabricated proof', async () => {
    // Synthetic 90ml MAIN Product transformation; not a captured Hustler response.
    const p = sourceBody();
    p.product_results.title = 'BLA BLI BLU Hustler Perfume 90ml';
    p.product_results.sku = 'PERHQ4H22Z4SRTGU';
    p.product_results.specifications.General['Model Name'] = 'Hustler Perfume';
    p.product_results.specifications.General.Quantity = '90 ml';
    p.product_results.specifications.General['Net Quantity'] = '90 ml';
    p.product_results.specifications['Product Highlights'].Quantity = '90 ml';
    p.product_results.highlights = ['Quantity: 90 ml'];
    mocks.get.mockImplementation(async (endpoint: string) => ({
      data: JSON.stringify(
        endpoint.endsWith('/flipkart/product') ? p : response(endpoint),
      ),
    }));
    expect(await scrapeAndStoreProduct(HUSTLER_PREVIEW_TEST_URL)).toEqual({
      ok: true,
      data: { id },
    });
    expect(mocks.get.mock.calls[0][1].params.url).toBe(HUSTLER_PREVIEW_TEST_URL);
    expect(stored.url).toBe(HUSTLER_PREVIEW_TEST_URL);
    expect(stored.variant).toBe('90ml');
    await mocks.after.mock.calls[0][0]();
    expect(mocks.get.mock.calls.length).toBeLessThanOrEqual(5);
    expect(
      mocks.get.mock.calls.filter(([url]) => url.endsWith('/flipkart/product')),
    ).toHaveLength(1);
    // Existing source/matching evidence rules decide eligibility; never borrow
    // Old Money's scent/30ml Search or Product evidence to verify Hustler 90ml.
    expect(
      mocks.get.mock.calls.filter(([url]) => /\/(amazon|myntra)\/product$/.test(url)),
    ).toHaveLength(0);
    const used = mocks.get.mock.calls.length;
    await mocks.after.mock.calls[0][0]();
    expect(mocks.get).toHaveBeenCalledTimes(used);
    expect(mocks.email).not.toHaveBeenCalled();
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
  });
  it.each([
    HUSTLER_PREVIEW_TEST_URL.split('&lid=')[0],
    `${HUSTLER_PREVIEW_TEST_URL}&extra=bad`,
    HUSTLER_PREVIEW_TEST_URL.replace('lid=LSTPERHQ4H22Z4SRTGUEGJMT8', 'lid=OTHER'),
  ])(
    'rejects unapproved Hustler URL variants before any provider or DB operation %#',
    async (url) => {
      expect((await scrapeAndStoreProduct(url)).ok).toBe(false);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );
});

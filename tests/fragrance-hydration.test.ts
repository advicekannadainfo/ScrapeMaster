import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scrape: vi.fn(), discover: vi.fn() }));
vi.mock('@/lib/scraper/index', () => ({ scrapeProduct: mocks.scrape }));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
import { withFragranceProduct } from './support/fragrance-product';
import { verifiedOffers } from '@/lib/verified-offers';
import { observeProduct } from '@/lib/scraper/matching/observations';
let create: typeof import('@/lib/scraper/hydrate-fragrance').createFragranceHydrator;
let compare: typeof import('@/lib/scraper/compare').findOffersWithDiagnostics;
const urls = {
  amazon: 'https://www.amazon.in/dp/B0TEST0001',
  flipkart:
    'https://www.flipkart.com/acme-quiet-garden-perfume-30ml/p/itmtest?pid=OFFLINETEST',
  'myntra.com': 'https://www.myntra.com/perfume/acme/12345678/buy',
};
type Store = keyof typeof urls;
const listing = (store: Store = 'amazon', title = 'Acme Quiet Garden Perfume 30ml') => ({
  title,
  brand: 'Acme',
  store,
  storeName: store,
  url: urls[store],
  price: 200,
  currency: '₹',
});
const product = (store: Store = 'amazon') => ({
  ...withFragranceProduct(listing(store)),
  currentPrice: 200,
  variant: '30ml',
  image: 'https://example.com/image.jpg',
  isOutOfStock: false,
  comparisonIdentityVerified: true,
});
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'true');
  mocks.scrape.mockReset();
  mocks.discover.mockReset();
  create = (await import('@/lib/scraper/hydrate-fragrance')).createFragranceHydrator;
  compare = (await import('@/lib/scraper/compare')).findOffersWithDiagnostics;
  mocks.scrape.mockImplementation(async (url: string) =>
    product(
      url.includes('amazon')
        ? 'amazon'
        : url.includes('myntra')
          ? 'myntra.com'
          : 'flipkart',
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('bounded automatic fragrance Product hydration: ALL provider calls mocked', () => {
  it.each(['', 'false', '1', 'TRUE'])(
    'is disabled without the exact explicit true flag (%s)',
    async (flag) => {
      vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', flag);
      const result = await create(product('flipkart')).verify('amazon', [listing()]);
      expect(result.diagnostic.status).toBe('disabled');
      expect(mocks.scrape).not.toHaveBeenCalled();
    },
  );
  it('fails closed before any Product request for missing or URL-unbound source proof', async () => {
    const source = product('flipkart');
    for (const p of [
      { ...source, canonicalIdentity: null },
      { ...source, url: urls.amazon },
    ]) {
      expect((await create(p).verify('amazon', [listing()])).diagnostic.status).toBe(
        'source-evidence-missing',
      );
    }
    expect(mocks.scrape).not.toHaveBeenCalled();
  });
  it('ranks bounded candidates and verifies exactly one URL, without copying a Search price', async () => {
    const source = product('flipkart');
    const result = await create(source).verify('amazon', [
      listing('amazon', 'Acme Other Scent Perfume 30ml'),
      { ...listing(), price: 100 },
      listing('amazon', 'Acme Quiet Garden Perfume 100ml'),
    ]);
    expect(result.diagnostic).toMatchObject({
      status: 'product-verified',
      eligibleCandidates: 1,
      productRequests: 1,
    });
    expect(result.offer?.price).toBe(200);
    expect(verifiedOffers(source, [result.offer!])).toHaveLength(1);
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.scrape).toHaveBeenCalledWith(urls.amazon, {
      allowFallback: false,
      maxPaidRequests: 1,
    });
  });
  it('enforces one per store and two total while stores verify concurrently', async () => {
    const h = create(product('flipkart'));
    const results = await Promise.all([
      h.verify('amazon', [listing()]),
      h.verify('myntra.com', [listing('myntra.com')]),
      h.verify('amazon', [listing()]),
    ]);
    expect(results.map((r) => r.diagnostic.status)).toEqual([
      'product-verified',
      'product-verified',
      'budget-exhausted',
    ]);
    expect(mocks.scrape).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent comparisons and reuses fresh verification without another paid call', async () => {
    const source = product('flipkart');
    const [a, b] = await Promise.all([
      create(source).verify('amazon', [listing()]),
      create(source).verify('amazon', [listing()]),
    ]);
    expect(a.offer).toBeDefined();
    expect(b.diagnostic.cacheHit).toBe(true);
    const c = await create(source).verify('amazon', [listing()]);
    expect(c.diagnostic).toMatchObject({ cacheHit: true, productRequests: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
  });
  it('never retries a failed candidate or tries the next listing, including cached failures', async () => {
    mocks.scrape.mockRejectedValue(new Error('PRIVATE api_key=do-not-log'));
    const source = product('flipkart'),
      rows = [listing(), { ...listing(), url: 'https://www.amazon.in/dp/B0TEST0002' }];
    const a = await create(source).verify('amazon', rows);
    const b = await create(source).verify('amazon', rows);
    expect(a.diagnostic.status).toBe('product-failed');
    expect(a.diagnostic.rejectionReason).toBe('provider-failure');
    expect(b.diagnostic.cacheHit).toBe(true);
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([a, b])).not.toMatch(/PRIVATE|api_key|https/);
  });
  it.each([
    'missing-volume',
    'wrong-size',
    'wrong-scent',
    'wrong-formulation',
    'unbound-price',
    'stale-price',
    'out-of-stock',
  ])('rejects %s from the fetched Product', async (change) => {
    const p = product();
    if (change === 'missing-volume') {
      const e = structuredClone(p.canonicalIdentity)!;
      delete e.selected.volume;
      e.issues = ['volume-unconfirmed'];
      p.canonicalIdentity = e;
    }
    if (change === 'wrong-size') p.variant = '100ml';
    if (change === 'wrong-scent') p.title = 'Acme Other Scent Perfume 30ml';
    if (change === 'wrong-formulation') {
      const e = structuredClone(p.canonicalIdentity)!;
      e.selected.formulation = {
        value: 'perfume-oil',
        field: 'main.title',
        scope: 'main',
      };
      p.canonicalIdentity = e;
      p.priceObservation = observeProduct(e, 200, '₹', false);
    }
    if (change === 'unbound-price') p.currentPrice = 201;
    if (change === 'stale-price')
      p.priceObservation!.observedAt = new Date(Date.now() - 600001).toISOString();
    if (change === 'out-of-stock') p.isOutOfStock = true;
    mocks.scrape.mockResolvedValue(p);
    const result = await create(product('flipkart')).verify('amazon', [listing()]);
    expect(result.offer).toBeUndefined();
    expect(result.diagnostic.status).toBe('missing-provider-proof');
    expect(result.diagnostic.rejectionReason).toBe(
      {
        'missing-volume': 'missing-selected-size',
        'wrong-size': 'identity-mismatch',
        'wrong-scent': 'identity-mismatch',
        'wrong-formulation': 'formulation-unconfirmed',
        'unbound-price': 'stale-or-unbound-price',
        'stale-price': 'stale-or-unbound-price',
        'out-of-stock': 'out-of-stock',
      }[change],
    );
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
  });
  it('integrates into real Compare flow for two stores with explicit diagnostics and no extra searches', async () => {
    const source = product('flipkart');
    mocks.discover.mockImplementation(async (adapter: { id: Store }) => [
      listing(adapter.id),
    ]);
    const result = await compare(source);
    expect(result.offers.map((o) => o.store).sort()).toEqual([
      'amazon',
      'flipkart',
      'myntra.com',
    ]);
    expect(
      result.diagnostics.every((d) => d.hydration?.status === 'product-verified'),
    ).toBe(true);
    expect(verifiedOffers(source, result.offers)).toEqual(result.offers);
    expect(mocks.scrape).toHaveBeenCalledTimes(2);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });
  it('skips hydration when a fresh independently verified candidate already exists', async () => {
    mocks.discover.mockImplementation(async (adapter: { id: Store }) => [
      product(adapter.id),
    ]);
    const result = await compare(product('flipkart'));
    expect(
      result.diagnostics.every((d) => d.hydration?.status === 'already-verified'),
    ).toBe(true);
    expect(mocks.scrape).not.toHaveBeenCalled();
  });
  it('does not hydrate unsafe URLs, other-store links, packs or wrong variants', async () => {
    const h = create(product('flipkart'));
    const result = await h.verify('amazon', [
      { ...listing(), url: urls['myntra.com'] },
      { ...listing(), url: 'https://amazon.in.evil.example/dp/B0TEST0001' },
      listing('amazon', 'Acme Quiet Garden Perfume 100ml'),
      listing('amazon', 'Acme Quiet Garden Perfume 30ml tester'),
    ]);
    expect(result.diagnostic.status).toBe('no-candidate');
    expect(mocks.scrape).not.toHaveBeenCalled();
  });
  it('expires cached observations without renewing timestamps or retrying the same comparison', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    const source = product('flipkart');
    const first = await create(source).verify('amazon', [listing()]);
    const observed = first.offer!.priceObservation;
    vi.advanceTimersByTime(600001);
    expect(verifiedOffers(source, [first.offer!])).toEqual([]);
    const next = await create(source).verify('amazon', [listing()]);
    expect(next.diagnostic).toMatchObject({
      productRequests: 1,
      cacheHit: false,
      status: 'product-verified',
    });
    expect(next.offer!.priceObservation).not.toEqual(observed);
    expect(mocks.scrape).toHaveBeenCalledTimes(2); // separate comparisons; one request each
  });
  it('does not go past the already-paid bounded pool looking for another candidate', async () => {
    const rows = [
      ...Array.from({ length: 200 }, () =>
        listing('amazon', 'Acme Other Scent Perfume 30ml'),
      ),
      listing(),
    ];
    const result = await create(product('flipkart')).verify('amazon', rows);
    expect(result.diagnostic).toMatchObject({
      searchCandidates: 200,
      status: 'no-candidate',
      productRequests: 0,
    });
    expect(mocks.scrape).not.toHaveBeenCalled();
  });
  it.each([
    ['Perfume Oil', 'Body Mist', 'formulation-conflict'],
    ['EDP', 'EDT', 'concentration-conflict'],
  ])(
    'reports %s versus %s as a bounded rejection code',
    async (sourceDeclaration, candidateDeclaration, reason) => {
      const a = product('flipkart'),
        b = product();
      const source = {
        ...a,
        ...withFragranceProduct({ ...a, title: `${a.title} ${sourceDeclaration}` }),
      };
      const candidate = {
        ...b,
        ...withFragranceProduct({ ...b, title: `${b.title} ${candidateDeclaration}` }),
      };
      mocks.scrape.mockResolvedValue(candidate);
      const result = await create(source).verify('amazon', [listing()]);
      expect(result.diagnostic.rejectionReason).toBe(reason);
      expect(result.offer).toBeUndefined();
      expect(mocks.scrape).toHaveBeenCalledTimes(1);
    },
  );
  it('distinguishes a valid bound price anomaly from invalid price and sanitized parser failure', async () => {
    const { ScrapeError } = await import('@/lib/scraper/errors');
    const source = product('flipkart');
    const p = product();
    p.currentPrice = 1000;
    p.priceObservation = observeProduct(p.canonicalIdentity, 1000, '₹', false);
    mocks.scrape.mockResolvedValueOnce(p);
    const a = await create(source).verify('amazon', [listing()]);
    expect(a.diagnostic.rejectionReason).toBe('price-anomaly');
    // Change source price context to avoid reusing the prior cache entry.
    mocks.scrape.mockResolvedValueOnce({ ...product(), currentPrice: 0 });
    expect(
      (await create({ ...source, currentPrice: 201 }).verify('amazon', [listing()]))
        .diagnostic.rejectionReason,
    ).toBe('invalid-price');
    mocks.scrape.mockRejectedValueOnce(
      new ScrapeError('PRIVATE_RAW_RESPONSE api_key=private', 'parse'),
    );
    const c = await create({ ...source, currentPrice: 202 }).verify('amazon', [
      listing(),
    ]);
    expect(c.diagnostic.rejectionReason).toBe('provider-parse-failure');
    expect(JSON.stringify(c)).not.toMatch(/PRIVATE|api_key|private/);
    expect(mocks.scrape).toHaveBeenCalledTimes(3); // three independent contexts; no retries
  });
});

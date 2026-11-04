import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
vi.mock('@/lib/scraper/stores', () => ({
  regionFromCurrency: () => 'in',
  searchableStores: () => [{ id: 'amazon' }, { id: 'flipkart' }, { id: 'myntra.com' }],
}));
import { findOffersWithDiagnostics } from '@/lib/scraper/compare';
import { mainEvidence } from '@/lib/scraper/exact-evidence';
import { comparisonFailureClass } from '@/lib/scraper/matching/reliability';
import { verifiedOffers } from '@/lib/verified-offers';
import { ScrapeError } from '@/lib/scraper/errors';

function product(store: string) {
  const p = {
    title:
      store === 'amazon' ? 'Acme Clip 7 Earbuds Black' : 'Acme Clip 7 OWS Earbuds Black',
    brand: 'Acme',
    store,
    storeName: store,
    url:
      store === 'amazon'
        ? 'https://www.amazon.in/dp/B000000001'
        : 'https://www.flipkart.com/clip-earbuds/p/itmoffline?pid=OFFLINETEST',
    currentPrice: 200,
    image: '',
    currency: '₹',
    isOutOfStock: false,
    comparisonIdentityVerified: false,
  };
  return {
    ...p,
    exactEvidence: mainEvidence(
      p,
      {
        Brand: 'Acme',
        'Model Number': 'MODEL-7',
        Color: 'Black',
        'Number of Items': '1',
      },
      store === 'amazon' ? 'product_information' : 'specifications.General',
    ),
  };
}
beforeEach(() => {
  mocks.discover.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('comparison stage consistency with independently selected MAIN evidence (synthetic)', () => {
  it.each(['amazon', 'flipkart'])(
    'discovery and render both accept strong evidence from %s without new Product fetches',
    async (store) => {
      const source = product(store),
        other = product(store === 'amazon' ? 'flipkart' : 'amazon');
      mocks.discover.mockImplementation(async (adapter: { id: string }) =>
        adapter.id === other.store ? [{ ...other, price: other.currentPrice }] : [],
      );
      const result = await findOffersWithDiagnostics(source);
      expect(result.offers).toHaveLength(2);
      expect(verifiedOffers(source, result.offers)).toEqual(result.offers);
      expect(result.diagnostics.find((d) => d.store === other.store)).toMatchObject({
        status: 'matched',
        sourceIndependentlyValidated: true,
        sourceRecord: { state: 'independent', savedPrice: 'fresh-bound' },
        failureClasses: { verified: 1 },
      });
      expect(source.comparisonIdentityVerified).toBe(false); // no promotion of legacy flag
      expect(mocks.discover).toHaveBeenCalledTimes(2); // one search per other store; no hydration/retry
    },
  );
  it('classifies wrong product, absent selected evidence, price anomaly and discovery failure separately', async () => {
    const source = product('amazon'),
      other = product('flipkart');
    const wrong = structuredClone(other);
    wrong.exactEvidence!.mpn!.value = 'OTHER-MODEL';
    const missing = structuredClone(other);
    delete missing.exactEvidence!.selected.colour;
    const expensive = {
      ...other,
      currentPrice: 900,
      exactEvidence: { ...other.exactEvidence!, price: 900 },
    };
    mocks.discover.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'flipkart'
        ? [wrong, missing, expensive].map((p) => ({ ...p, price: p.currentPrice }))
        : [],
    );
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers).toHaveLength(1);
    expect(result.diagnostics.find((d) => d.store === 'flipkart')).toMatchObject({
      failureClasses: {
        'wrong-product': 1,
        'missing-api-evidence': 1,
        'price-anomaly': 1,
      },
    });
    expect(result.diagnostics.find((d) => d.store === 'myntra.com')).toMatchObject({
      failureClasses: { 'search-discovery-gap': 1 },
    });
    // Wrong strong model must be diagnosed as mismatch, not merely insufficient.
    expect(verifiedOffers(source, [{ ...wrong, price: wrong.currentPrice }])).toEqual([]);
  });
  it('reports parser gap separately from provider failure, with no raw error text', async () => {
    const secret = 'PRIVATE_PROVIDER_PAYLOAD api_key=never-display';
    mocks.discover.mockImplementation(async (adapter: { id: string }) => {
      throw new ScrapeError(secret, adapter.id === 'flipkart' ? 'parse' : 'timeout');
    });
    const result = await findOffersWithDiagnostics(product('amazon'));
    expect(result.diagnostics.find((d) => d.store === 'flipkart')).toMatchObject({
      failureClasses: { 'parser-gap': 1 },
    });
    expect(result.diagnostics.find((d) => d.store === 'myntra.com')).toMatchObject({
      failureClasses: { 'provider-failure': 1 },
    });
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /PRIVATE|api_key|Acme|MODEL|https|OFFLINE/,
    );
  });
  it('never renders an explicitly unavailable independent offer, while keeping source tracking visible', async () => {
    const source = product('amazon'),
      candidate = product('flipkart');
    candidate.exactEvidence!.inStock = false;
    const offer = { ...candidate, price: candidate.currentPrice };
    expect(verifiedOffers(source, [offer])).toEqual([]);
    mocks.discover.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'flipkart' ? [offer] : [],
    );
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].url).toBe(source.url);
    expect(result.diagnostics.find((d) => d.store === 'flipkart')).toMatchObject({
      rejections: { 'stock-unavailable': 1 },
      failureClasses: { 'stock-unavailable': 1 },
    });
  });
  it('reports invalid or stale saved evidence without treating it as a verified source', async () => {
    mocks.discover.mockResolvedValue([]);
    const source = product('amazon');
    const invalid = await findOffersWithDiagnostics({
      ...source,
      exactEvidence: { version: 99 },
    });
    expect(invalid.diagnostics[0].sourceRecord).toMatchObject({
      state: 'invalid',
      savedPrice: 'unavailable-or-stale',
    });
    expect(invalid.diagnostics[0].sourceIndependentlyValidated).toBe(false);
    const stale = await findOffersWithDiagnostics({
      ...source,
      exactEvidence: {
        ...source.exactEvidence!,
        observedAt: new Date(Date.now() - 600001).toISOString(),
      },
    });
    expect(stale.diagnostics[0].sourceRecord).toMatchObject({
      state: 'independent',
      savedPrice: 'unavailable-or-stale',
    });
  });
  it.each([
    ['explicit-mismatch', 'wrong-product'],
    ['insufficient-identity', 'missing-api-evidence'],
    ['source-record-invalid', 'saved-record-invalid'],
    ['source-price-unavailable-or-stale', 'saved-price-unavailable'],
    ['parse', 'parser-gap'],
    ['no-search-results', 'search-discovery-gap'],
    ['price-anomaly', 'price-anomaly'],
    ['timeout', 'provider-failure'],
  ])('maps bounded %s to %s', (reason, result) =>
    expect(comparisonFailureClass(reason)).toBe(result),
  );
});

import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  findById: vi.fn(),
  updateOne: vi.fn(),
}));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
vi.mock('@/lib/models/product.model', () => ({
  default: { findById: mocks.findById, updateOne: mocks.updateOne },
}));
import real from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import { findOffersWithDiagnostics } from '@/lib/scraper/compare';
import { updateOffers } from '@/lib/services/offers';
import { verifiedOffers } from '@/lib/verified-offers';
const url =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds/p/itmexample?pid=TESTREQUEST';
function source() {
  // Synthetic contract mutation, never asserted to be a captured ProClip response.
  const result = parseFlipkartAPIProduct(
    JSON.stringify({
      product_results: {
        ...real.product_results,
        title: 'boAt Airdopes ProClip OWS Earbuds Black',
        brand: 'boAt',
        specifications: { General: { Color: 'Black' } },
        highlights: [],
        variants: [],
      },
    }),
    url,
  );
  return result;
}
beforeEach(() => {
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-test');
  mocks.discover.mockReset();
  mocks.findById.mockReset();
  mocks.updateOne.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
import { afterEach } from 'vitest';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('tracking-only identity preserves discovery and valid own-price display', () => {
  it('tracks missing model, attempts each other supported store, hides unverified competitor results', async () => {
    const p = source();
    expect(p.comparisonIdentityVerified).toBe(false);
    mocks.discover.mockImplementation(async (adapter: { id: string }) => [
      {
        store: adapter.id,
        storeName: adapter.id,
        title: p.title,
        brand: p.brand,
        variant: p.variant,
        url: 'https://www.amazon.in/dp/B0FYGRL51R',
        price: 200,
        currency: '₹',
      },
    ]);
    const result = await findOffersWithDiagnostics(p);
    expect(mocks.discover.mock.calls.map(([adapter]) => adapter.id).sort()).toEqual([
      'amazon',
      'myntra.com',
    ]);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      url: p.url,
      price: p.currentPrice,
      store: 'flipkart',
    });
    expect(verifiedOffers(p, result.offers)).toEqual(result.offers);
    expect(result.diagnostics.every((d) => d.status === 'rejected')).toBe(true);
  });
  it('uncertain source comparison preserves stored offers without overwriting them, after searching', async () => {
    const p = source();
    const earlier = [{ store: 'amazon', title: p.title, price: 200 }];
    const record = { ...p, offers: earlier };
    mocks.findById.mockImplementation(() => ({
      select: () => ({ lean: async () => record }),
    }));
    mocks.discover.mockResolvedValue([]);
    await updateOffers('synthetic-id');
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(record.offers).toBe(earlier);
  });
  it('failed store searches keep the valid own product and do not erase stored offers', async () => {
    const p = source();
    const record = { ...p, offers: [{ store: 'amazon', price: 200 }] };
    mocks.findById.mockImplementation(() => ({
      select: () => ({ lean: async () => record }),
    }));
    mocks.discover.mockRejectedValue(new Error('offline simulated failure'));
    const offers = await updateOffers('synthetic-id');
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(offers).toHaveLength(1);
  });
});

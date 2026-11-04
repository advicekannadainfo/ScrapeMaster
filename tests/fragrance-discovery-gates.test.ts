import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
import { findOffersWithDiagnostics } from '@/lib/scraper/compare';
import { mainFragranceIdentity } from '@/lib/scraper/matching/fragrance';
import { observeProduct } from '@/lib/scraper/matching/observations';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';

beforeEach(() => {
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  mocks.discover.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe('fragrance release discovery gates: offline transport boundary mocked', () => {
  it('does not downgrade a captured main Product declaration while ranking search candidates', async () => {
    const source = parseFlipkartAPIProduct(
      JSON.stringify(flipkart),
      'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
    );
    const candidate = parseAmazonAPIProduct(
      JSON.stringify(amazon),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    mocks.discover.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon' ? [{ ...candidate, price: candidate.currentPrice }] : [],
    );
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers).toHaveLength(1);
    expect(result.diagnostics.find((d) => d.store === 'amazon')).toMatchObject({
      status: 'rejected',
      candidateEvidence: { independentProduct: 1, listingOnly: 0 },
      verified: 0,
    });
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });
  it('distinguishes a synthetic listing match from selected Product proof, without hydration', async () => {
    const title = 'Acme Quiet Garden Perfume 30ml';
    const url = 'https://www.flipkart.com/acme-perfume/p/itmtest';
    const canonicalIdentity = mainFragranceIdentity({
      title,
      brand: 'Acme',
      store: 'flipkart',
      url,
      selectedVolume: 30,
      volumeField: 'specifications.General.Quantity',
    });
    const source = {
      title,
      brand: 'Acme',
      variant: '30ml',
      url,
      store: 'flipkart',
      storeName: 'Flipkart',
      currency: '₹',
      currentPrice: 200,
      image: '',
      canonicalIdentity,
      priceObservation: observeProduct(canonicalIdentity, 200, '₹', false),
    };
    // Synthetic documented listing contract; never labelled a captured Search response.
    mocks.discover.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon'
        ? [
            {
              title,
              store: 'amazon',
              storeName: 'Amazon',
              url: 'https://www.amazon.in/dp/B0TEST0001',
              currency: '₹',
              price: 200,
            },
          ]
        : [],
    );
    const result = await findOffersWithDiagnostics(source);
    expect(result.offers).toHaveLength(1); // listing evidence cannot certify a price
    expect(result.diagnostics.find((d) => d.store === 'amazon')).toMatchObject({
      candidateEvidence: { listingOnly: 1, independentProduct: 0 },
    });
    expect(result.diagnostics.find((d) => d.store === 'amazon')?.reason).toBe(
      'insufficient-product-evidence',
    );
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /Quiet Garden|https|offline-only|B0TEST/,
    );
  });
});

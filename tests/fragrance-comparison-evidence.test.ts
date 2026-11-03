import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  findById: vi.fn(),
  updateOne: vi.fn(),
  find: vi.fn(),
}));
vi.mock('@/lib/scraper/load', () => ({ loadAndParse: mocks.load }));
vi.mock('@/lib/models/product.model', () => ({
  default: { findById: mocks.findById, updateOne: mocks.updateOne, find: mocks.find },
}));
import searchFixture from './fixtures/amazon-search.json';
import amazonFixture from './fixtures/amazon-india-product-full.json';
import flipkartFixture from './fixtures/flipkart-product-real.json';
import myntraFixture from './fixtures/myntra-product-real.json';
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import {
  parseFlipkartAPIProduct,
  parseAmazonAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import {
  enrichSearchFragranceIdentity,
  fragranceDiscoveryQuery,
} from '@/lib/scraper/product-candidate-match';
import { verifiedOffers } from '@/lib/verified-offers';
let findOffersWithDiagnostics: typeof import('@/lib/scraper/compare').findOffersWithDiagnostics;
let updateOffers: typeof import('@/lib/services/offers').updateOffers;
import { freshSavedPrice } from '@/lib/scraper/exact-evidence';
import type { Offer } from '@/types';

const flipkartURL =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ';
const source = () =>
  parseFlipkartAPIProduct(JSON.stringify(flipkartFixture), flipkartURL);
// Synthetic search listings based on documented Search structure. These are NOT
// the missing live click response; captured Product JSON alone cannot prove discovery.
function amazonListing(title = 'BLABLIBLU Love Drunk Unisex Perfume 30ml') {
  return parseAmazonSearchAPI(
    JSON.stringify({
      results: [
        {
          ...searchFixture.results[0],
          title,
          asin: 'B0FYGRL51R',
          optimized_url: 'https://www.amazon.in/dp/B0FYGRL51R',
          extracted_price: 184,
          price_string: '₹184.00',
          price: '₹184.00',
        },
      ],
    }),
  )[0];
}
function skinn(quantity: number | null) {
  // Controlled mutation of captured Love Drunk data, NOT a SKINN capture.
  const p = structuredClone(myntraFixture);
  p.product_results.id = 2316551;
  p.product_results.name = 'SKINN by Titan Men Verge Eau de Parfum 20 ml';
  p.product_results.brand.name = 'SKINN';
  Object.assign(p.product_results.selectedSeller, {
    netQuantity: quantity === null ? null : [{ quantity, unit: 'ml', type: 'single' }],
  });
  p.product_results.selectedSeller.discount.discountId = '2316551:986224708';
  p.product_results.sizes[0].discount_id = '2316551:986224708';
  p.product_results.sizes[0].frg_list_link =
    p.product_results.sizes[0].frg_list_link.replace('36340100', '2316551');
  return {
    body: p,
    url: 'https://www.myntra.com/perfume/skinn/skinn-verge-20-ml/2316551/buy',
  };
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.load.mockReset();
  mocks.findById.mockReset();
  mocks.find.mockReset();
  mocks.find.mockReturnValue({
    select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  });
  mocks.updateOne.mockReset();
  mocks.load.mockResolvedValue([]);
  ({ findOffersWithDiagnostics } = await import('@/lib/scraper/compare'));
  ({ updateOffers } = await import('@/lib/services/offers'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('independent fragrance discovery evidence, offline only', () => {
  it('enriches a compact-brand Amazon 30ml search listing and preserves it through render filtering', () => {
    const p = source();
    const offer = enrichSearchFragranceIdentity(p, amazonListing());
    expect(offer).toMatchObject({ brand: 'BLA BLI BLU', variant: '30ml', price: 184 });
    expect(verifiedOffers(p, [offer])).toHaveLength(1);
    expect(fragranceDiscoveryQuery(p)).toBe('BLA BLI BLU love drunk 30ml');
  });
  it('automatically discovers and renders a sufficiently evidenced Amazon 30ml offer without Product calls', async () => {
    const p = source();
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon' ? [amazonListing()] : [],
    );
    const result = await findOffersWithDiagnostics(p);
    expect(result.offers.map((offer) => offer.store)).toEqual(['amazon', 'flipkart']);
    expect(verifiedOffers(p, result.offers)).toEqual(result.offers);
    expect(result.diagnostics.find((d) => d.store === 'amazon')).toMatchObject({
      status: 'matched',
      reason: 'verified-competitor',
      candidates: 1,
      verified: 1,
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls.every((call) => call[3].kind === 'search')).toBe(true);
  });
  it('does not treat comparative EDP/EDT marketing as a selected concentration', async () => {
    const p = source();
    const ambiguous = amazonListing(amazonFixture.title);
    expect(verifiedOffers(p, [enrichSearchFragranceIdentity(p, ambiguous)])).toHaveLength(
      1,
    );
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon' ? [ambiguous] : [],
    );
    const result = await findOffersWithDiagnostics(p);
    expect(result.diagnostics.find((d) => d.store === 'amazon')).toMatchObject({
      reason: 'verified-competitor',
      verified: 1,
    });
  });
  it('accepts repeated identical volume evidence but rejects two different quantities', () => {
    const p = source();
    const listing = amazonListing('BLABLIBLU Love Drunk Unisex Perfume 30ml - 30 ml');
    expect(verifiedOffers(p, [enrichSearchFragranceIdentity(p, listing)])).toHaveLength(
      1,
    );
    const mixed = amazonListing('BLABLIBLU Love Drunk Perfume 30 ml / 100 ml');
    expect(verifiedOffers(p, [enrichSearchFragranceIdentity(p, mixed)])).toEqual([]);
  });
  it('normalizes explicit EDP wording without assuming bare perfume means EDP', () => {
    const p = {
      ...source(),
      canonicalIdentity: null,
      title: 'BLA BLI BLU Love Drunk Eau de Parfum Perfume 30ml',
    };
    const good = enrichSearchFragranceIdentity(
      p,
      amazonListing('BLABLIBLU Love Drunk EDP Perfume 30 ml'),
    );
    expect(verifiedOffers(p, [good])).toHaveLength(1);
    for (const word of ['EDT', 'Eau de Toilette', '']) {
      const bad = enrichSearchFragranceIdentity(
        p,
        amazonListing(`BLABLIBLU Love Drunk ${word} Perfume 30ml`),
      );
      expect(verifiedOffers(p, [bad])).toEqual([]);
    }
  });
  it.each([
    'BLABLIBLU Love Drunk Perfume 100 ml',
    'BLABLIBLU Other Scent Perfume 30 ml',
    'AL ADHEEM Love Drunk Perfume 30 ml',
    'BLABLIBLU Love Drunk Intense Perfume 30 ml',
    'BLABLIBLU Love Drunk Perfume 30 ml pack of 2',
    'BLABLIBLU Love Drunk Perfume',
  ])('never manufactures evidence for %s', (title) => {
    const p = source();
    expect(
      verifiedOffers(p, [enrichSearchFragranceIdentity(p, amazonListing(title))]),
    ).toEqual([]);
  });
  it('ranks the 21st parsed listing before retention without another Product or Search call', async () => {
    const p = { ...source(), title: source().title + ' LimitEvidence' };
    const wrong = amazonListing('BLABLIBLU Love Drunk Perfume 100ml');
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon'
        ? [...Array.from({ length: 20 }, () => ({ ...wrong })), amazonListing()]
        : [],
    );
    const result = await findOffersWithDiagnostics(p);
    expect(result.offers.some((o) => o.store === 'amazon')).toBe(true);
    expect(result.diagnostics.find((d) => d.store === 'amazon')).toMatchObject({
      status: 'matched',
      reason: 'verified-competitor',
      candidates: 21,
      verified: 1,
      discovery: {
        cacheHit: false,
        parsedCandidates: 21,
        candidateLimit: 200,
        truncated: false,
      },
      rejections: { 'explicit-mismatch': 20 },
    });
    const cached = await findOffersWithDiagnostics(p);
    expect(
      cached.diagnostics.find((d) => d.store === 'amazon')?.discovery?.cacheHit,
    ).toBe(true);
    expect(mocks.load).toHaveBeenCalledTimes(2); // one mocked Search per other store; no Product calls
  });
  it('logs why parsed Amazon candidates fail without exposing titles, URLs or payloads', async () => {
    const p = { ...source(), title: source().title + ' DiagnosticEvidence' };
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon'
        ? [
            amazonListing('BLABLIBLU Love Drunk Perfume 100ml'),
            amazonListing('BLABLIBLU Love Drunk Perfume'),
            { ...amazonListing(), price: 100000 },
            { ...amazonListing(), currency: '$' },
          ]
        : [],
    );
    const result = await findOffersWithDiagnostics(p);
    const d = result.diagnostics.find((d) => d.store === 'amazon');
    expect(d).toMatchObject({
      reason: 'mixed-rejections',
      rejections: {
        'explicit-mismatch': 1,
        'insufficient-identity': 1,
        'price-anomaly': 1,
        'currency-rejected': 1,
      },
    });
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/B0FYGRL51R|Love Drunk|offline-only|https|100000/);
  });
  it('distinguishes a render-time evidence rejection from absent search results', async () => {
    const p = { ...source(), exactEvidence: { unsupported: 'PRIVATE_VALUE' } };
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon' ? [amazonListing()] : [],
    );
    const result = await findOffersWithDiagnostics(p);
    const d = result.diagnostics.find((d) => d.store === 'amazon');
    expect(d).toMatchObject({
      reason: 'render-identity-rejected',
      candidates: 1,
      verified: 0,
    });
    expect(JSON.stringify(d)).not.toMatch(/PRIVATE_VALUE|unsupported/);
    expect(result.offers.some((offer) => offer.store === 'amazon')).toBe(false);
  });
  it('preserves saved Flipkart/Myntra and manual offers when Amazon returns no search candidates', async () => {
    const p = source();
    const previous: Offer = {
      store: 'myntra.com',
      storeName: 'Myntra',
      title: 'BLA BLI BLU Love Drunk Perfume 30 ml',
      brand: 'BLA BLI BLU',
      variant: '30ml',
      currency: '₹',
      price: 198,
      url: 'https://www.myntra.com/perfume/38312143/buy',
    };
    const record = { ...p, offers: [previous], candidateLinksCheckedAt: new Date() };
    mocks.findById.mockImplementation(() => ({
      select: () => ({ lean: async () => record }),
    }));
    const offers = await updateOffers('offline-fixture-id');
    expect(offers.map((o) => o.store).sort()).toEqual(['flipkart', 'myntra.com']);
    expect(offers.find((o) => o.store === 'myntra.com')).toEqual(previous);
    expect(mocks.updateOne.mock.calls[0][1].$set.offers).toEqual(offers);
    expect(mocks.find).toHaveBeenCalledTimes(1); // bounded local identity lookup, no paid request
  });
  it('rejects stale saved prices without treating a comparison write as a fresh observation', () => {
    const p = parseAmazonAPIProduct(
      JSON.stringify(amazonFixture),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    const stale = {
      ...p,
      exactEvidence: {
        ...(p.exactEvidence as object),
        observedAt: new Date(Date.now() - 600001).toISOString(),
      },
      updatedAt: new Date(),
    };
    expect(freshSavedPrice(stale)).toBe(false);
  });
});
describe('SKINN null quantity remains safely tracking-only', () => {
  it('does not derive selected 20ml from title, per-unit pricing, product details or alternative sizes', async () => {
    const { body, url } = skinn(null);
    Object.assign(body.product_results, { product_details: 'Quantity: 20ml' });
    Object.assign(body.product_results.sizes[0], { label: '20ml' });
    const p = parseMyntraAPIProduct(JSON.stringify(body), url);
    expect(p).toMatchObject({
      comparisonIdentityVerified: false,
      currentPrice: 650,
      isOutOfStock: false,
    });
    expect(p.variant).toBeUndefined();
    mocks.load.mockResolvedValue(
      Array.from({ length: 20 }, () =>
        amazonListing('SKINN by Titan Men Verge Eau de Parfum 20ml'),
      ),
    );
    const result = await findOffersWithDiagnostics(p);
    expect(result.offers).toHaveLength(1);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          store: 'amazon',
          reason: 'insufficient-selected-identity',
          sourceEvidence: 'selected-volume-unconfirmed',
        }),
      ]),
    );
  });
  it('accepts a genuine selected-seller quantity array, with exactly matched product/seller/SKU and root price', () => {
    const { body, url } = skinn(20);
    expect(parseMyntraAPIProduct(JSON.stringify(body), url)).toMatchObject({
      variant: '20ml',
      comparisonIdentityVerified: true,
      currentPrice: 650,
    });
    body.product_results.selectedSeller.netQuantity![0].quantity = 100;
    expect(() => parseMyntraAPIProduct(JSON.stringify(body), url)).toThrow(
      /quantity conflict/,
    );
  });
  it.each(['sku', 'seller', 'price'] as const)(
    'preserves %s checks even if quantity is null',
    (conflict) => {
      const { body, url } = skinn(null);
      if (conflict === 'sku') body.product_results.buyButtonSellerOrder[0].skuId = 999;
      if (conflict === 'seller')
        body.product_results.selectedSeller.sellerPartnerId = 999;
      if (conflict === 'price') body.product_results.selectedSeller.discountedPrice = 1;
      expect(() => parseMyntraAPIProduct(JSON.stringify(body), url)).toThrow();
    },
  );
});

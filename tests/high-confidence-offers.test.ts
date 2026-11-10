import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scrape: vi.fn(),
  discover: vi.fn(),
  network: vi.fn(),
  findById: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: mocks.network, isAxiosError: () => false } }));
vi.mock('@/lib/scraper/index', () => ({ scrapeProduct: mocks.scrape }));
vi.mock('@/lib/scraper/discovery', () => ({
  discoverOffers: mocks.discover,
  DISCOVERY_POOL_LIMIT: 200,
}));
vi.mock('@/lib/models/product.model', () => ({
  default: { findById: mocks.findById, find: mocks.find, updateOne: mocks.update },
}));
vi.mock('@/components/CompareButton', () => ({ default: () => null }));
vi.mock('@/components/live/RelativeTime', () => ({ default: () => 'recently' }));
vi.mock('@/components/ui/Money', () => ({
  default: ({ amount }: { amount: number }) => `PRICE_${amount}`,
}));
vi.mock('@/components/ui/StoreLogo', () => ({ default: () => null }));
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import {
  highConfidenceProductMatch,
  highConfidenceOffers,
} from '@/lib/high-confidence-offers';
import { verifiedOffers, isVerifiedProductMatch } from '@/lib/verified-offers';
import {
  readCanonicalIdentity,
  fragranceDecision,
} from '@/lib/scraper/matching/fragrance';
import { validAssociations } from '@/lib/scraper/matching/observations';
import { createFragranceHydrator } from '@/lib/scraper/hydrate-fragrance';
import {
  withPreviewProviderBudget,
  createPreviewTrackingBudget,
} from '@/lib/scraper/preview-provider-budget';
import { updateOffers } from '@/lib/services/offers';
import { fragranceProductLinks } from '@/lib/services/fragrance-product-links';
import OfferComparison from '@/components/OfferComparison';
import { getEmailNotifType } from '@/lib/notifications';
import type { Offer, Product } from '@/types';
import { LOVE_DRUNK_100ML_PREVIEW_TEST_URL } from '@/lib/preview-website-test-target';
import amazon from './fixtures/amazon-love-drunk-100ml-product-captured.json';
import partial from './fixtures/flipkart-love-drunk-100ml-user-partial.json';
import search from './fixtures/amazon-love-drunk-search-captured.json';
import myntra from './fixtures/myntra-product-real.json';

const amazonURL = 'https://www.amazon.in/dp/B0FLWST1D4';
// Actual captured Amazon + reported partial Flipkart fields. ONLY missing root
// title/image are test supplements; no raw complete Flipkart capture is claimed.
function sourceBody() {
  return {
    product_results: {
      ...structuredClone(partial.partial_response.product_results),
      title: `${partial.partial_response.product_results.brand} ${partial.reported_product_name}`,
      main_image: 'https://example.com/offline-placeholder.jpg',
    },
  };
}
function source() {
  return parseFlipkartAPIProduct(
    JSON.stringify(sourceBody()),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
  );
}
function candidate() {
  return parseAmazonAPIProduct(JSON.stringify(amazon), amazonURL);
}
function hc(p = candidate()): Offer {
  return { ...p, price: p.currentPrice, matchConfidence: 'high-confidence' };
}
function product(): Product {
  return {
    ...source(),
    _id: '0123456789abcdef01234567',
    offers: [],
    highConfidenceOffers: [hc()],
    priceHistory: [{ price: 720 }],
    lowestPrice: 720,
    highestPrice: 720,
    averagePrice: 720,
  };
}
const query = <T>(value: T) => {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => value };
  return q;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'false');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  mocks.network.mockImplementation(() => {
    throw new Error('NETWORK FORBIDDEN');
  });
  mocks.scrape.mockImplementation(async (url: string) =>
    parseAmazonAPIProduct(JSON.stringify(amazon), url),
  );
  mocks.discover.mockImplementation(async (adapter: { id: string }) =>
    adapter.id === 'amazon' ? parseAmazonSearchAPI(JSON.stringify(search)) : [],
  );
  mocks.find.mockImplementation(() => query([]));
  mocks.update.mockResolvedValue({ acknowledged: true });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  expect(mocks.network).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('separate confidence tier from independent Product responses, not search-price guesses', () => {
  it('qualifies reported Love Drunk 100ml as high-confidence while strict pack/formulation verification remains unchanged', () => {
    const s = source(),
      a = candidate();
    expect(s.currentPrice).toBe(720);
    expect(a.currentPrice).toBe(719);
    expect(fragranceDecision(s, a).reason).toBe('pack-unconfirmed');
    expect(isVerifiedProductMatch(s, a)).toBe(false);
    expect(highConfidenceProductMatch(s, a)).toBe(true);
    expect(highConfidenceProductMatch(a, s)).toBe(true);
    expect(highConfidenceOffers(s, [hc(a)])).toHaveLength(1);
    expect(verifiedOffers(s, [hc(a)])).toEqual([]);
    expect(readCanonicalIdentity(s.canonicalIdentity)?.selected.pack).toBeUndefined();
    expect(
      readCanonicalIdentity(s.canonicalIdentity)?.selected.formulation,
    ).toBeUndefined();
    expect(
      readCanonicalIdentity(s.canonicalIdentity)?.context?.formulation,
    ).toMatchObject({
      value: 'parfum-strength',
      field: 'specifications.General.Key Features',
    });
    expect(
      readCanonicalIdentity(a.canonicalIdentity)?.context?.formulation,
    ).toMatchObject({
      value: 'concentration-label-only',
      field: 'product_information.Fragrance Concentration',
    });
  });
  it.each(['Quiet Garden', 'Cedar Trail'])(
    'applies the same rule to synthetic %s, without product-name or retailer-ID shortcuts',
    (line) => {
      const f = sourceBody();
      f.product_results.title = `Acme ${line} Perfume`;
      f.product_results.brand = 'Acme';
      const url = `https://www.flipkart.com/acme-${line.toLowerCase().replace(/ /g, '-')}-perfume/p/itmoffline?pid=OFFLINETEST`;
      const a = structuredClone(amazon);
      a.title = `Acme ${line} Parfum Perfume 100ml`;
      a.main_title = `Acme ${line} Perfume 100ml`;
      a.product_information.Brand = 'Acme';
      const s = parseFlipkartAPIProduct(JSON.stringify(f), url);
      const p = parseAmazonAPIProduct(JSON.stringify(a), amazonURL);
      expect(highConfidenceProductMatch(s, p)).toBe(true);
    },
  );
  it.each([
    '30ml',
    'pack2',
    'other-scent',
    'other-brand',
    'oil-only-title',
    'oil-item-form',
    'oil-features',
    'gift-set',
    'refill',
    'tester',
    'bundle',
    'edt-edition',
  ])('rejects a synthetic %s candidate even with fresh Product price/stock', (change) => {
    const p = structuredClone(amazon);
    if (change === '30ml') {
      p.title = p.title.replace('100ml', '30ml');
      p.main_title += ' 30ml';
      p.product_information['Item Volume'] = '30 Millilitres';
    }
    if (change === 'pack2') p.product_information['Number of Items'] = '2';
    if (change === 'other-scent') {
      p.title = p.title.replace('Love Drunk', 'Old Money');
      p.main_title = p.main_title.replace('Love Drunk', 'Old Money');
    }
    if (change === 'other-brand') {
      p.title = 'Other ' + p.title;
      p.main_title = 'Other ' + p.main_title;
      p.product_information.Brand = 'Other';
    }
    if (change === 'oil-only-title') {
      p.title += ' Perfume Oil';
      p.main_title += ' Perfume Oil';
    }
    if (change === 'oil-item-form') p.product_information['Item Form'] = 'Oil';
    if (change === 'oil-features')
      Object.assign(p, { feature_bullets: ['Oil-based, alcohol-free roll-on perfume'] });
    if (['gift-set', 'refill', 'tester', 'bundle'].includes(change)) {
      p.title += ' ' + change.replace('-', ' ');
      p.main_title += ' ' + change.replace('-', ' ');
    }
    if (change === 'edt-edition') {
      p.title = p.title.replace(/Parfum.*$/, 'EDT');
      p.main_title += ' EDT';
      p.product_information['Fragrance Concentration'] = 'EDT';
    }
    const c = parseAmazonAPIProduct(JSON.stringify(p), amazonURL);
    expect(highConfidenceProductMatch(source(), c)).toBe(false);
    expect(highConfidenceOffers(source(), [hc(c)])).toEqual([]);
  });
  it.each([
    'no-strength-proof',
    'explicit-mist',
    'explicit-pack',
    'unsupported-identifier',
    'spray',
    'oil-only',
  ])(
    'rejects %s main source evidence without borrowing proof from the other store',
    (change) => {
      const f = sourceBody();
      const info = f.product_results.specifications.General as Record<string, unknown>;
      if (change === 'no-strength-proof') delete info['Key Features'];
      if (change === 'explicit-mist') info['Fragrance Concentration'] = 'Body Mist';
      if (change === 'explicit-pack') info['Pack Size'] = '2';
      if (change === 'unsupported-identifier') info.GTIN = 'not-a-gtin';
      if (change === 'spray') info['Key Features'] += ' Spray bottle';
      if (change === 'oil-only') info['Key Features'] += ' Oil-only roll-on';
      const s = parseFlipkartAPIProduct(
        JSON.stringify(f),
        LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
      );
      expect(highConfidenceProductMatch(s, candidate())).toBe(false);
    },
  );
  it.each([
    'stale-source',
    'stale-candidate',
    'unbound-price',
    'unknown-stock',
    'out-of-stock',
    'wrong-url',
    'forged-context',
    'search-only',
    'missing-marker',
  ])('never displays %s as a high-confidence Product offer', (change) => {
    const s = source(),
      a = candidate();
    if (change === 'stale-source')
      (s.priceObservation as { observedAt: string }).observedAt = new Date(
        Date.now() - 600001,
      ).toISOString();
    if (change === 'stale-candidate')
      (a.priceObservation as { observedAt: string }).observedAt = new Date(
        Date.now() - 600001,
      ).toISOString();
    if (change === 'unbound-price') a.currentPrice = 718;
    if (change === 'unknown-stock')
      Object.assign(a.priceObservation as object, { inStock: null });
    if (change === 'out-of-stock')
      Object.assign(a.priceObservation as object, { inStock: false });
    if (change === 'wrong-url') a.url = 'https://www.amazon.in/dp/B0FYGRL51R';
    if (change === 'forged-context') {
      const e = readCanonicalIdentity(a.canonicalIdentity)!;
      e.context!.formulation!.field = 'variants.title';
      a.canonicalIdentity = e;
    }
    let value = hc(a);
    if (change === 'search-only')
      value = {
        ...parseAmazonSearchAPI(JSON.stringify(search))[1],
        matchConfidence: 'high-confidence',
      };
    if (change === 'missing-marker') delete value.matchConfidence;
    expect(highConfidenceOffers(s, [value])).toEqual([]);
  });
  it('requires actual boolean stock and independent source selected volume before classifying', () => {
    expect(
      highConfidenceProductMatch(source(), { ...candidate(), isOutOfStock: undefined }),
    ).toBe(false);
    const s = source();
    const e = readCanonicalIdentity(s.canonicalIdentity)!;
    delete e.selected.volume;
    s.canonicalIdentity = e;
    expect(highConfidenceProductMatch(s, candidate())).toBe(false);
  });
});
describe('normal UI/persistence integration retains distinct trust and unchanged strict diagnostics', () => {
  it('selects the real 100ml ASIN once; opt-in returns HC separately and default diagnostic stays strict', async () => {
    const s = source(),
      rows = parseAmazonSearchAPI(JSON.stringify(search));
    const strict = await withPreviewProviderBudget(async () =>
      createFragranceHydrator(s, { previewDryRun: true }).verify('amazon', rows),
    );
    expect(strict.diagnostic.rejectionReason).toBe('pack-unconfirmed');
    expect(strict.offer).toBeUndefined();
    const result = await withPreviewProviderBudget(async () =>
      createFragranceHydrator(s, {
        previewDryRun: true,
        allowHighConfidence: true,
      }).verify('amazon', rows),
    );
    expect(result.diagnostic).toMatchObject({
      status: 'product-high-confidence',
      eligibleCandidates: 1,
      productRequests: 1,
    });
    expect(result.offer).toBeUndefined();
    expect(result.highConfidenceOffer).toMatchObject({
      url: amazonURL,
      price: 719,
      matchConfidence: 'high-confidence',
    });
    expect(mocks.scrape).toHaveBeenCalledTimes(2); // distinct offline contexts; one each
    expect(mocks.scrape.mock.calls.every(([url]) => url === amazonURL)).toBe(true);
  });
  it('normal automatic comparison persists HC separately and preserves a manually verified Myntra offer', async () => {
    const p = product();
    p.highConfidenceOffers = [];
    const m = parseMyntraAPIProduct(
      JSON.stringify(myntra),
      'https://www.myntra.com/perfume/love-drunk/36340100/buy',
    );
    p.offers = [{ ...m, price: m.currentPrice }];
    p.candidateLinksCheckedAt = new Date().toISOString();
    mocks.findById.mockImplementation(() => query(p));
    // Mocked Preview setting only, to exercise the REAL explicitly rebound
    // website lifecycle; no environment/Vercel configuration is changed.
    vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'true');
    const flow = createPreviewTrackingBudget();
    await flow.track(async () => p);
    const strict = await flow.compare(() => updateOffers(p._id));
    const set = mocks.update.mock.calls[0][1].$set;
    expect(strict.some((o) => o.store === 'myntra.com')).toBe(true);
    expect(set.offers.some((o: Offer) => o.store === 'amazon')).toBe(false);
    expect(set.highConfidenceOffers).toHaveLength(1);
    expect(set.highConfidenceOffers[0]).toMatchObject({
      store: 'amazon',
      price: 719,
      matchConfidence: 'high-confidence',
    });
    expect(set.productLinks ?? []).toEqual([]);
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      '[compare] Search result',
      expect.objectContaining({
        store: 'amazon',
        status: 'high-confidence',
        verified: 0,
        highConfidence: 1,
      }),
    );
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
  });
  it('reuses fresh independently tracked Product records without API calls and without trusted associations', async () => {
    mocks.find.mockImplementation(() => query([candidate()]));
    const result = await fragranceProductLinks(source());
    expect(result.offers).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.highConfidenceOffers).toHaveLength(1);
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(validAssociations(source(), result.highConfidenceOffers)).toEqual([]);
  });
  it('renders the labelled row in the ordinary Compare Stores list without Lowest/Save or Best Price promotion', () => {
    const p = product();
    const own: Offer = {
      store: p.store,
      storeName: p.storeName,
      title: p.title,
      url: p.url,
      price: p.currentPrice,
      currency: p.currency,
    };
    p.offers = [own, hc()]; // even accidental mixed storage cannot promote HC
    const html = renderToStaticMarkup(createElement(OfferComparison, { product: p }));
    expect(html).toContain('Compare stores');
    expect(html).toContain('High-confidence match');
    expect(html).toContain('PRICE_719');
    expect(html).not.toContain('Lowest');
    expect(html).not.toContain('Save');
    expect(verifiedOffers(p).map((o) => o.price)).toEqual([720]);
    expect(
      getEmailNotifType(p, { priceHistory: [{ price: 720 }], isOutOfStock: false }),
    ).toBeNull();
  });
  it('persists the confidence marker in the separate schema array, not as strict proof', async () => {
    const actual = await vi.importActual<typeof import('@/lib/models/product.model')>(
      '@/lib/models/product.model',
    );
    const p = product();
    const doc = new actual.default(p);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toObject().highConfidenceOffers[0].matchConfidence).toBe(
      'high-confidence',
    );
    expect(doc.toObject().offers).toHaveLength(0);
  });
  it('preserves still-fresh HC evidence on a provider failure without renewing its observation', async () => {
    const p = product();
    const before = JSON.stringify(p.highConfidenceOffers![0].priceObservation);
    mocks.findById.mockImplementation(() => query(p));
    mocks.discover.mockRejectedValue(new Error('offline provider failure'));
    await updateOffers(p._id);
    const set = mocks.update.mock.calls[0][1].$set;
    expect(set.highConfidenceOffers).toHaveLength(1);
    expect(JSON.stringify(set.highConfidenceOffers[0].priceObservation)).toBe(before);
  });
});

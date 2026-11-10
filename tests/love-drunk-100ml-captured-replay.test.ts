import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scrape: vi.fn(), network: vi.fn() }));
vi.mock('@/lib/scraper/index', () => ({ scrapeProduct: mocks.scrape }));
vi.mock('axios', () => ({ default: { get: mocks.network, isAxiosError: () => false } }));
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { createFragranceHydrator } from '@/lib/scraper/hydrate-fragrance';
import { withPreviewProviderBudget } from '@/lib/scraper/preview-provider-budget';
import {
  fragranceDecision,
  fragranceProfile,
  readCanonicalIdentity,
} from '@/lib/scraper/matching/fragrance';
import { fragranceContext } from '@/lib/scraper/matching/context';
import { verifiedOffers } from '@/lib/verified-offers';
import { LOVE_DRUNK_100ML_PREVIEW_TEST_URL } from '@/lib/preview-website-test-target';
import search from './fixtures/amazon-love-drunk-search-captured.json';
import product from './fixtures/amazon-love-drunk-100ml-product-captured.json';
import flipkart from './fixtures/flipkart-love-drunk-100ml-user-partial.json';

const selectedURL = 'https://www.amazon.in/dp/B0FLWST1D4';
// The new Flipkart data is a user-reported PARTIAL extract, not a raw capture.
// Keep it intact. Only the missing title/image envelope below is SYNTHETIC.
// Title words use only the reported name/brand, NOT a claimed captured title.
// Do not add size/model claims to this envelope. Quantity proof comes ONLY
// from reported General/Product Highlights fields; image is a placeholder.
function parserEnvelope() {
  return {
    product_results: {
      ...structuredClone(flipkart.partial_response.product_results),
      title: `${flipkart.partial_response.product_results.brand} ${flipkart.reported_product_name}`,
      main_image: 'https://example.com/offline-placeholder.jpg',
    },
  };
}
function source() {
  return parseFlipkartAPIProduct(
    JSON.stringify(parserEnvelope()),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
  );
}
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  vi.stubEnv('MERIDEALS_PREVIEW_TRACKING_TEST', 'false');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  mocks.scrape.mockReset();
  mocks.network.mockReset();
  mocks.network.mockImplementation(() => {
    throw new Error('NETWORK FORBIDDEN');
  });
  mocks.scrape.mockImplementation(async (url: string) =>
    parseAmazonAPIProduct(JSON.stringify(product), url),
  );
});
afterEach(() => {
  expect(mocks.network).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
describe('captured Amazon responses + labelled partial Flipkart evidence; all provider calls mocked', () => {
  it('keeps the Flipkart extract explicitly incomplete and never passes placeholder fields off as a raw response', () => {
    expect(flipkart.fixture_kind).toBe('user-reported-partial-extract');
    expect(flipkart.complete_raw_response).toBe(false);
    expect(flipkart.partial_response.product_results).not.toHaveProperty('title');
    expect(flipkart.partial_response.product_results).not.toHaveProperty('main_image');
    expect(() =>
      parseFlipkartAPIProduct(
        JSON.stringify(flipkart.partial_response),
        LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
      ),
    ).toThrow(/fields are missing or invalid/);
  });
  it('replays reported price, stock and independently selected volume without converting SKU or listing ID into PID proof', () => {
    const p = source();
    expect(p).toMatchObject({
      brand: 'BLA BLI BLU',
      variant: '100ml',
      currentPrice: 720,
      currency: '₹',
      isOutOfStock: false,
    });
    const e = readCanonicalIdentity(p.canonicalIdentity)!;
    expect(e.source.binding).toBe('url-provider');
    expect(e.selected.volume).toMatchObject({
      value: '100ml',
      field: 'specifications.General.Quantity',
      scope: 'selected',
    });
    expect(e.selected.pack).toBeUndefined();
    expect(e.selected.formulation).toBeUndefined();
    expect(e.selected.concentration).toBeUndefined();
    expect(new URL(p.url).searchParams.get('lid')).toBe(flipkart.reported_listing_id);
    expect(flipkart.partial_response.product_results.sku).toBe('PERHEV7YFJMY2UWG');
  });
  it('parses all captured Search rows and distinguishes the first 30ml from the second 100ml ASIN', () => {
    expect(search.results).toHaveLength(48);
    const rows = parseAmazonSearchAPI(JSON.stringify(search));
    expect(rows).toHaveLength(48);
    expect(rows[0]).toMatchObject({ storeProductId: 'B0FYGRL51R' });
    expect(rows[0].title).toMatch(/30ml/);
    expect(rows[1]).toMatchObject({ storeProductId: 'B0FLWST1D4', price: 719 });
    expect(rows[1].title).toMatch(/100ml/);
  });
  it('parses the captured selected Product, pack count, INR price and stock without asserting EDP from marketing', () => {
    const p = parseAmazonAPIProduct(JSON.stringify(product), selectedURL);
    expect(p).toMatchObject({
      storeProductId: 'B0FLWST1D4',
      variant: '100ml',
      currentPrice: 719,
      currency: '₹',
      isOutOfStock: false,
    });
    const e = readCanonicalIdentity(p.canonicalIdentity)!;
    expect(e.selected.volume).toMatchObject({
      value: '100ml',
      field: 'product_information.Item Volume',
      scope: 'selected',
    });
    expect(e.selected.pack).toEqual({
      value: '1',
      field: 'product_information.Number of Items',
      scope: 'selected',
    });
    expect(e.selected.formulation).toMatchObject({
      value: 'perfume-oil',
      field: 'product_information.Fragrance Concentration',
    });
    expect(e.selected.concentration).toBeUndefined();
    expect(fragranceContext(product.title).concentrations).toEqual([]);
    expect(product.customization_options.size.filter((s) => s.is_selected)).toEqual([
      { is_selected: true, value: '100 ml (Pack of 1)', asin: 'B0FLWST1D4' },
    ]);
  });
  it("uses the website's real ranking/verifier to select ONLY the 100ml ASIN and report the first pack blocker", async () => {
    const s = source();
    const rows = parseAmazonSearchAPI(JSON.stringify(search));
    const result = await withPreviewProviderBudget(async () =>
      createFragranceHydrator(s, { previewDryRun: true }).verify('amazon', rows),
    );
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.scrape).toHaveBeenCalledWith(selectedURL, {
      allowFallback: false,
      maxPaidRequests: 1,
    });
    expect(result.diagnostic).toMatchObject({
      searchCandidates: 48,
      eligibleCandidates: 1,
      productRequests: 1,
      status: 'missing-provider-proof',
      rejectionReason: 'pack-unconfirmed',
    });
    expect(result.offer).toBeUndefined();
    expect(readCanonicalIdentity(s.canonicalIdentity)?.selected.pack).toBeUndefined();
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
    expect(process.env.MERIDEALS_PREVIEW_TRACKING_TEST).toBe('false');
  });
  it('identifies the further formulation blocker conditionally, without certifying invented Flipkart pack evidence', () => {
    const s = source();
    const p = parseAmazonAPIProduct(JSON.stringify(product), selectedURL);
    const left = readCanonicalIdentity(s.canonicalIdentity)!;
    const right = readCanonicalIdentity(p.canonicalIdentity)!;
    expect(fragranceDecision(s, p)).toMatchObject({
      status: 'insufficient',
      reason: 'pack-unconfirmed',
    });
    expect(left.selected.pack).toBeUndefined();
    expect(left.selected.formulation).toBeUndefined();
    // Algorithm-only counterfactual: IF independently established same-pack
    // evidence becomes available later, formulation is still unconfirmed.
    // This copy is NEVER persisted or passed to readCanonicalIdentity,
    // verifiedOffers or Product parsers as trustworthy Flipkart provenance.
    const hypothetical = {
      ...left,
      selected: { ...left.selected, pack: right.selected.pack },
    };
    expect(fragranceProfile.compare(hypothetical, right)).toMatchObject({
      status: 'insufficient',
      reason: 'formulation-unconfirmed',
    });
    expect(left.selected.pack).toBeUndefined();
    expect(verifiedOffers(s, [{ ...p, price: p.currentPrice }])).toEqual([]);
  });
  it('does not equate perfume-oil percentage/marketing with independently verified oil formulation or pack count', () => {
    const keyFeatures =
      flipkart.partial_response.product_results.specifications.General['Key Features'];
    expect(keyFeatures).toContain('25% perfume oil concentration');
    expect(keyFeatures).toContain('Unlike regular EDTs or EDPs');
    const e = readCanonicalIdentity(source().canonicalIdentity)!;
    // Oil content is not proof that the selected product is an oil-based perfume;
    // the reported classification is only the generic word "Perfume".
    expect(e.selected.formulation).toBeUndefined();
    expect(e.selected.pack).toBeUndefined();
    expect(e.selected.concentration).toBeUndefined();
  });
  it('rejects a synthetic 30ml response against the requested 100ml URL', () => {
    const f = parserEnvelope();
    f.product_results.title = f.product_results.title.replace('100 ml', '30 ml');
    f.product_results.specifications.General.Quantity = '30 ml';
    f.product_results.specifications.General['Net Quantity'] = '30 ml';
    f.product_results.specifications['Product Highlights'].Quantity = '30 ml';
    expect(() =>
      parseFlipkartAPIProduct(JSON.stringify(f), LOVE_DRUNK_100ML_PREVIEW_TEST_URL),
    ).toThrow(/quantity conflicts/);
    expect(
      fragranceDecision(
        source(),
        parseAmazonAPIProduct(
          JSON.stringify({
            ...product,
            title: product.title.replace('100ml', '30ml'),
            main_title: `${product.main_title} 30ml`,
            product_information: {
              ...product.product_information,
              'Item Volume': '30 Millilitres',
            },
          }),
          selectedURL,
        ),
      ).status,
    ).toBe('mismatch');
  });
  it("never certifies a synthetic Amazon multipack from the source's missing pack count", () => {
    const altered = structuredClone(product);
    altered.product_information['Number of Items'] = '2';
    const candidate = parseAmazonAPIProduct(JSON.stringify(altered), selectedURL);
    const s = source();
    expect(readCanonicalIdentity(candidate.canonicalIdentity)?.selected.pack?.value).toBe(
      '2',
    );
    expect(fragranceDecision(s, candidate)).toMatchObject({
      status: 'insufficient',
      reason: 'pack-unconfirmed',
    });
    expect(verifiedOffers(s, [{ ...candidate, price: candidate.currentPrice }])).toEqual(
      [],
    );
    expect(readCanonicalIdentity(s.canonicalIdentity)?.selected.pack).toBeUndefined();
  });
});

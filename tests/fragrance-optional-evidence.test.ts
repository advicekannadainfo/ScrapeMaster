import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
const mocks = vi.hoisted(() => ({ scrape: vi.fn(), network: vi.fn() }));
vi.mock('@/lib/scraper/index', () => ({ scrapeProduct: mocks.scrape }));
vi.mock('axios', () => ({ default: { get: mocks.network, isAxiosError: () => false } }));
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import {
  fragranceDecision,
  readCanonicalIdentity,
  searchFragranceIdentity,
} from '@/lib/scraper/matching/fragrance';
import {
  freshProfilePrice,
  identityKey,
  validAssociations,
  type PriceObservation,
} from '@/lib/scraper/matching/observations';
import { verifiedOffers } from '@/lib/verified-offers';
import { createFragranceHydrator } from '@/lib/scraper/hydrate-fragrance';
import { withPreviewProviderBudget } from '@/lib/scraper/preview-provider-budget';
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import capturedAmazon from './fixtures/amazon-love-drunk-100ml-product-captured.json';
import reportedFlipkart from './fixtures/flipkart-love-drunk-100ml-user-partial.json';
import capturedSearch from './fixtures/amazon-love-drunk-search-captured.json';
import { LOVE_DRUNK_100ML_PREVIEW_TEST_URL } from '@/lib/preview-website-test-target';

const amazonURL = 'https://www.amazon.in/dp/B0TEST0001';
const flipkartURL =
  'https://www.flipkart.com/acme-quiet-garden-perfume-100-ml/p/itmoffline?pid=OFFLINETEST';
// Synthetic MAIN Product contracts, not captured products or provider promises.
function bodies(line = 'Quiet Garden') {
  const title = `Acme ${line} Perfume 100 ml`;
  const amazon = {
    title,
    main_title: title,
    extracted_price: 719,
    price_symbol: '₹',
    price: '₹719',
    main_image: 'https://example.com/test.jpg',
    availability_status: 'In stock',
    product_information: {
      ASIN: 'B0TEST0001',
      Brand: 'Acme',
      'Item Volume': '100 ml',
      'Number of Items': '1',
      'Fragrance Concentration': 'Perfume Oil',
      GTIN: '4006381333931',
    },
  };
  const flipkart = {
    product_results: {
      title,
      brand: 'Acme',
      price: '₹720',
      main_image: 'https://example.com/test.jpg',
      sku: 'OFFLINESKU',
      availability: 'InStock',
      variants: [],
      display_sizes: [],
      specifications: {
        General: {
          Brand: 'Acme',
          'Model Name': `${line} Perfume`,
          Quantity: '100 ml',
          'Net Quantity': '100 ml',
          EAN: '4006381333931',
        },
      },
    },
  };
  const url = flipkartURL.replace('quiet-garden', line.toLowerCase().replace(/ /g, '-'));
  return { amazon, flipkart, url };
}
function products(b = bodies()) {
  return {
    a: parseAmazonAPIProduct(JSON.stringify(b.amazon), amazonURL),
    f: parseFlipkartAPIProduct(JSON.stringify(b.flipkart), b.url),
  };
}
const offer = (p: ReturnType<typeof products>['a']) => ({ ...p, price: p.currentPrice });
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
});
afterEach(() => {
  expect(mocks.network).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

describe('optional facts remain unknown; selected package identity is positive evidence', () => {
  it.each(['Quiet Garden', 'Cedar Trail', 'Ocean Breeze'])(
    'accepts independently corroborated %s in normal verified offers, symmetrically',
    (line) => {
      const { a, f } = products(bodies(line));
      expect(fragranceDecision(f, a)).toMatchObject({
        status: 'verified',
        reason: 'independent-package-evidence',
      });
      expect(fragranceDecision(a, f).status).toBe('verified');
      expect(readCanonicalIdentity(f.canonicalIdentity)?.selected.pack).toBeUndefined();
      expect(
        readCanonicalIdentity(f.canonicalIdentity)?.selected.formulation,
      ).toBeUndefined();
      expect(readCanonicalIdentity(f.canonicalIdentity)?.selected.packageGtin).toEqual({
        value: '04006381333931',
        field: 'specifications.General.EAN',
        scope: 'selected',
      });
      expect(verifiedOffers(f, [offer(a)])).toHaveLength(1);
      expect(verifiedOffers(a, [offer(f)])).toHaveLength(1);
    },
  );
  it('normalizes equivalent UPC/EAN encodings without requiring identical marketing titles', () => {
    const b = bodies();
    b.amazon.product_information.GTIN = '036000291452';
    b.amazon.title = 'Acme Quiet Garden Unisex Perfume 100ml';
    b.amazon.main_title = b.amazon.title;
    b.flipkart.product_results.specifications.General.EAN = '0036000291452';
    const { a, f } = products(b);
    expect(fragranceDecision(f, a).status).toBe('verified');
  });
  it('does not use a matching MPN/Model Number or barcode-looking retailer ID to fill absent package proof', () => {
    const b = bodies();
    const ai = b.amazon.product_information as Partial<
      typeof b.amazon.product_information
    > &
      Record<string, unknown>;
    const fi = b.flipkart.product_results.specifications.General as Partial<
      typeof b.flipkart.product_results.specifications.General
    > &
      Record<string, unknown>;
    delete ai.GTIN;
    delete fi.EAN;
    ai['Model Number'] = fi['Model Number'] = '4006381333931';
    const { a, f } = products(b);
    expect(
      readCanonicalIdentity(a.canonicalIdentity)?.selected.packageGtin,
    ).toBeUndefined();
    expect(
      readCanonicalIdentity(f.canonicalIdentity)?.selected.packageGtin,
    ).toBeUndefined();
    expect(fragranceDecision(f, a).reason).toBe('pack-unconfirmed');
  });
  it.each([
    'different-id',
    'invalid-checksum',
    'zero-id',
    'retailer-id-as-gtin',
    'missing-id',
    'multipack',
    'wrong-volume',
    'edt-edp',
    'mist-oil',
    'wrong-scent',
    'wrong-brand',
    'edition-conflict',
    'bundle',
    'refill',
    'tester',
    'gift-set',
    'missing-volume',
  ])('never overrides %s with an optional-field exception', (change) => {
    const b = bodies();
    if (change === 'different-id') b.amazon.product_information.GTIN = '5901234123457';
    if (change === 'invalid-checksum')
      b.amazon.product_information.GTIN = '4006381333932';
    if (change === 'zero-id') b.amazon.product_information.GTIN = '0000000000000';
    if (change === 'retailer-id-as-gtin')
      b.amazon.product_information.GTIN = 'B0TEST0001';
    if (change === 'missing-id')
      delete (
        b.amazon.product_information as Partial<typeof b.amazon.product_information>
      ).GTIN;
    if (change === 'multipack') b.amazon.product_information['Number of Items'] = '2';
    if (change === 'wrong-volume') {
      b.amazon.product_information['Item Volume'] = '30 ml';
      b.amazon.title = b.amazon.main_title = b.amazon.title.replace('100 ml', '30 ml');
    }
    if (change === 'edt-edp') {
      b.amazon.product_information['Fragrance Concentration'] = 'EDP';
      b.flipkart.product_results.title += ' EDT';
    }
    if (change === 'mist-oil') b.flipkart.product_results.title += ' Body Mist';
    if (change === 'wrong-scent')
      b.amazon.title = b.amazon.main_title = 'Acme Cedar Trail Perfume 100 ml';
    if (change === 'wrong-brand') {
      b.amazon.product_information.Brand = 'Other';
      b.amazon.title = b.amazon.main_title = 'Other Quiet Garden Perfume 100 ml';
    }
    if (change === 'edition-conflict') {
      b.amazon.title += ' Intense';
      b.amazon.main_title += ' Intense';
      b.flipkart.product_results.title += ' Elixir';
    }
    if (['bundle', 'refill', 'tester', 'gift-set'].includes(change))
      b.amazon.title = b.amazon.main_title =
        b.amazon.title + ` ${change.replace('-', ' ')}`;
    if (change === 'missing-volume') {
      const spec = b.flipkart.product_results.specifications.General as Partial<
        typeof b.flipkart.product_results.specifications.General
      >;
      delete spec.Quantity;
      delete spec['Net Quantity'];
    }
    const { a, f } = products(b);
    expect(fragranceDecision(f, a).status).not.toBe('verified');
    expect(fragranceDecision(a, f).status).not.toBe('verified');
    expect(verifiedOffers(f, [offer(a)])).toEqual([]);
    if (change === 'different-id')
      expect(fragranceDecision(f, a).reason).toBe('package-identifier-conflict');
    if (change === 'edt-edp')
      expect(fragranceDecision(f, a).reason).toBe('concentration-conflict');
    if (change === 'mist-oil')
      expect(fragranceDecision(f, a).reason).toBe('formulation-conflict');
  });
  it('does not turn a Search row or forged title provenance into a selected package identifier', () => {
    const { a } = products();
    const e = structuredClone(readCanonicalIdentity(a.canonicalIdentity)!);
    e.selected.packageGtin!.field = 'main.title';
    expect(readCanonicalIdentity(e)).toBeUndefined();
    const row = parseAmazonSearchAPI(
      JSON.stringify({
        results: [{ ...capturedSearch.results[1], GTIN: '4006381333931' }],
      }),
    )[0];
    expect(row.canonicalIdentity).toBeUndefined();
    const listing = searchFragranceIdentity(
      { title: 'Acme Quiet Garden Perfume 100ml', store: 'amazon', url: amazonURL },
      'Acme',
    )!;
    listing.selected.packageGtin = readCanonicalIdentity(
      a.canonicalIdentity,
    )!.selected.packageGtin;
    expect(readCanonicalIdentity(listing)).toBeUndefined();
  });
  it('retains already supported explicit Flipkart pack/formulation facts in canonical evidence instead of losing their contradictions', () => {
    const b = bodies();
    const general = b.flipkart.product_results.specifications.General as Record<
      string,
      string
    >;
    general['Pack Size'] = '2';
    const pair = products(b);
    expect(readCanonicalIdentity(pair.f.canonicalIdentity)?.selected.pack).toEqual({
      value: '2',
      field: 'specifications.General.Pack Size',
      scope: 'selected',
    });
    expect(fragranceDecision(pair.f, pair.a).reason).toBe('pack-conflict');
    expect(
      validAssociations(pair.f, [
        {
          profile: 'fragrance-v1',
          store: pair.a.store,
          url: pair.a.url,
          identity: pair.a.canonicalIdentity,
        },
      ]),
    ).toEqual([]);
    general['Pack Size'] = '1';
    general['Fragrance Concentration'] = 'Body Mist';
    const conflicting = products(b);
    expect(
      readCanonicalIdentity(conflicting.f.canonicalIdentity)?.selected.formulation,
    ).toMatchObject({
      value: 'body-mist',
      field: 'specifications.General.Fragrance Concentration',
    });
    expect(fragranceDecision(conflicting.f, conflicting.a).reason).toBe(
      'formulation-conflict',
    );
  });
  it.each(['main', 'listing', 'legacy'] as const)(
    'rejects %s-scoped persisted GTIN as selected package proof',
    (scope) => {
      const e = structuredClone(readCanonicalIdentity(products().a.canonicalIdentity)!);
      e.selected.packageGtin!.scope = scope;
      expect(readCanonicalIdentity(e)).toBeUndefined();
    },
  );
});
describe('persistence and price gates remain separate from manufacturer identity', () => {
  it('keeps a corroborated association through BSON and stale prices, but hides stale/unbound/out-of-stock observations', () => {
    const { a, f } = products();
    const saved = mongoose.mongo.BSON.deserialize(
      mongoose.mongo.BSON.serialize(a),
    ) as typeof a;
    const links = [
      {
        profile: 'fragrance-v1',
        store: a.store,
        url: a.url,
        identity: saved.canonicalIdentity,
      },
    ];
    expect(validAssociations(f, links)).toHaveLength(1);
    expect(verifiedOffers(f, [offer(saved)])).toHaveLength(1);
    (saved.priceObservation as PriceObservation).observedAt = new Date(
      Date.now() - 600001,
    ).toISOString();
    expect(verifiedOffers(f, [offer(saved)])).toEqual([]);
    expect(validAssociations(f, links)).toHaveLength(1);
    expect(verifiedOffers(f, [offer({ ...a, currentPrice: 999 })])).toEqual([]);
    expect(
      verifiedOffers(f, [
        offer({
          ...a,
          isOutOfStock: true,
          priceObservation: { ...a.priceObservation!, inStock: false },
        }),
      ]),
    ).toEqual([]);
    const staleSource = {
      ...f,
      priceObservation: {
        ...f.priceObservation!,
        observedAt: new Date(Date.now() - 600001).toISOString(),
      },
    };
    expect(verifiedOffers(staleSource, [offer(a)])).toEqual([]);
    const changed = structuredClone(a);
    const changedIdentity = readCanonicalIdentity(changed.canonicalIdentity)!;
    changedIdentity.selected.packageGtin!.value = '05901234123457';
    changed.canonicalIdentity = changedIdentity;
    expect(freshProfilePrice(changed)).toBe(false);
  });
  it('retains the exact old observation key when no package identifier exists', () => {
    const { f } = products();
    const e = structuredClone(readCanonicalIdentity(f.canonicalIdentity)!);
    delete e.selected.packageGtin;
    const old = JSON.stringify([
      e.profile,
      e.brand.value,
      e.line?.value,
      ...['volume', 'pack', 'concentration', 'formulation', 'edition'].map(
        (k) => e.selected[k as keyof typeof e.selected]?.value ?? null,
      ),
      e.negated,
      e.issues,
    ]);
    expect(identityKey(e)).toBe(old);
  });
  it('uses the existing one-candidate Product verification path and returns a normal verified offer with flags OFF', async () => {
    const { a, f } = products();
    mocks.scrape.mockResolvedValue(a);
    const result = await withPreviewProviderBudget(async () =>
      createFragranceHydrator(f, { previewDryRun: true }).verify('amazon', [
        { ...offer(a), canonicalIdentity: undefined, priceObservation: undefined },
      ]),
    );
    expect(result.diagnostic.status).toBe('product-verified');
    expect(verifiedOffers(f, [result.offer!])).toHaveLength(1);
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.scrape).toHaveBeenCalledWith(amazonURL, {
      allowFallback: false,
      maxPaidRequests: 1,
    });
    expect(process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION).toBe('false');
  });
  it('keeps the actual Love Drunk evidence unverified; no Model Number, generic label or 100ml claim supplies missing package proof', () => {
    const r = reportedFlipkart.partial_response.product_results;
    const f = parseFlipkartAPIProduct(
      JSON.stringify({
        product_results: {
          ...r,
          title: `${r.brand} ${reportedFlipkart.reported_product_name}`,
          main_image: 'https://example.com/offline-placeholder.jpg',
        },
      }),
      LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
    );
    const a = parseAmazonAPIProduct(
      JSON.stringify(capturedAmazon),
      'https://www.amazon.in/dp/B0FLWST1D4',
    );
    expect(
      readCanonicalIdentity(a.canonicalIdentity)?.selected.packageGtin,
    ).toBeUndefined();
    expect(
      readCanonicalIdentity(f.canonicalIdentity)?.selected.packageGtin,
    ).toBeUndefined();
    expect(fragranceDecision(f, a).reason).toBe('pack-unconfirmed');
    expect(verifiedOffers(f, [offer(a)])).toEqual([]);
  });
});

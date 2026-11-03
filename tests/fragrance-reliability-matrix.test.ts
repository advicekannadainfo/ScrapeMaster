import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/scraper/load', () => ({ loadAndParse: mocks.load }));
import flipkart from './fixtures/flipkart-product-real.json';
import myntraSearch from './fixtures/myntra-search.json';
import amazonSearch from './fixtures/amazon-search.json';
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import { parseMyntraSearch } from '@/lib/scraper/stores/myntra';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import {
  mainFragranceIdentity,
  independentFragrance,
  fragranceDecision,
} from '@/lib/scraper/matching/fragrance';
import { resolveSelectedVolume } from '@/lib/scraper/matching/selected-volume';
import {
  observeProduct,
  freshProfilePrice,
  validAssociations,
} from '@/lib/scraper/matching/observations';
import { verifiedOffers } from '@/lib/verified-offers';
import { comparisonPriceStatus } from '@/lib/scraper/match';
let compare: typeof import('@/lib/scraper/compare').findOffersWithDiagnostics;
const urls = {
  amazon: 'https://www.amazon.in/dp/B0TEST0001',
  flipkart:
    'https://www.flipkart.com/bla-bli-blu-old-money-perfume-men-apple-cedar-notes-perfume-men-long-lasting-30-ml/p/itmbe299cbfa6eb1?pid=PERHHHH3RYADXXH5',
  'myntra.com': 'https://www.myntra.com/perfume/test/12345678/buy',
};
type Store = keyof typeof urls;
// Every Old Money response/title transformation here is synthetic, NOT a
// captured Old Money provider response. Live evidence is limited to user logs/title.
function source(name = 'Old Money', field = 'General.Quantity') {
  const p = structuredClone(flipkart).product_results;
  p.title = `BLA BLI BLU ${name} Perfume for Men | Apple & Cedar Notes | Long Lasting Perfume - 30 ml`;
  p.sku = 'OFFLINETESTSKU';
  p.specifications.General['Model Name'] =
    `${name} Perfume for Men Apple Cedar Notes Long Lasting`;
  const general = p.specifications.General as Record<string, unknown>;
  Reflect.deleteProperty(general, 'Quantity');
  Reflect.deleteProperty(general, 'Net Quantity');
  Reflect.deleteProperty(p.specifications, 'Product Highlights');
  p.highlights = p.highlights.filter((v) => !v.startsWith('Quantity:'));
  if (field === 'General.Quantity') general.Quantity = '30 ml';
  if (field === 'General.Net Quantity') general['Net Quantity'] = '30 ml';
  if (field === 'Product Highlights.Quantity')
    Object.assign(p.specifications, { 'Product Highlights': { Quantity: '30 ml' } });
  if (field === 'highlights.Quantity') p.highlights.push('Quantity: 30 ml');
  // All model tokens in the actual requested descriptive URL must agree; the
  // other scent uses its own synthetic descriptive path, never a wrong URL match.
  const url =
    name === 'Old Money'
      ? urls.flipkart
      : urls.flipkart.replace('old-money', 'love-drunk');
  return parseFlipkartAPIProduct(JSON.stringify({ product_results: p }), url);
}
function product(
  store: Store,
  title: string,
  volume: number | undefined = 30,
  brand = 'BLA BLI BLU',
) {
  const canonicalIdentity = mainFragranceIdentity({
    title,
    brand,
    store,
    url: urls[store],
    selectedVolume: volume,
    volumeField:
      store === 'amazon'
        ? 'product_information.Item Volume'
        : store === 'flipkart'
          ? 'specifications.General.Quantity'
          : 'selectedSeller.netQuantity',
  });
  return {
    title,
    brand,
    variant: volume ? `${volume}ml` : undefined,
    store,
    storeName: store,
    url: urls[store],
    currentPrice: 250,
    currency: '₹',
    isOutOfStock: false,
    canonicalIdentity,
    priceObservation: observeProduct(canonicalIdentity, 250, '₹', false),
    comparisonIdentityVerified: volume !== undefined,
  };
}
const title = (name: string, store: Store) =>
  store === 'amazon'
    ? `BLABLIBLU ${name} Unisex Perfume 30ml | Long Lasting - A Notch above EDP, EDT & EDC | Apple & Cedar Notes`
    : store === 'flipkart'
      ? `BLA BLI BLU ${name} Perfume for Men - 30 ml`
      : `BLA BLI BLU ${name} Long Lasting Perfume - 30ml`;
const matrix: {
  label: string;
  expected: 'verified' | 'mismatch' | 'insufficient';
  run: () => string;
}[] = [];
for (const name of ['Love Drunk', 'Old Money', 'Fresh Morning'])
  for (const a of ['amazon', 'flipkart', 'myntra.com'] as Store[])
    for (const b of ['amazon', 'flipkart', 'myntra.com'] as Store[]) {
      if (a !== b)
        matrix.push({
          label: `${name}: ${a} -> ${b}`,
          expected: 'verified',
          run: () =>
            fragranceDecision(product(a, title(name, a)), product(b, title(name, b)))
              .status,
        });
    }
for (const name of ['Love Drunk', 'Old Money']) {
  for (const size of [20, 100])
    matrix.push({
      label: `${name}:30 vs ${size}`,
      expected: 'mismatch',
      run: () =>
        fragranceDecision(
          product('flipkart', title(name, 'flipkart')),
          product('amazon', `BLABLIBLU ${name} Perfume ${size}ml`, size),
        ).status,
    });
  matrix.push({
    label: `${name}:wrong scent`,
    expected: 'mismatch',
    run: () =>
      fragranceDecision(
        product('flipkart', title(name, 'flipkart')),
        product(
          'amazon',
          title(name === 'Old Money' ? 'Love Drunk' : 'Old Money', 'amazon'),
        ),
      ).status,
  });
  matrix.push({
    label: `${name}:wrong brand`,
    expected: 'mismatch',
    run: () =>
      fragranceDecision(
        product('flipkart', title(name, 'flipkart')),
        product('amazon', `OTHER BRAND ${name} Perfume 30ml`, 30, 'OTHER BRAND'),
      ).status,
  });
  matrix.push({
    label: `${name}:EDP vs EDT`,
    expected: 'mismatch',
    run: () =>
      fragranceDecision(
        product('flipkart', `BLA BLI BLU ${name} EDP Perfume 30ml`),
        product('amazon', `BLABLIBLU ${name} EDT Perfume 30ml`),
      ).status,
  });
  matrix.push({
    label: `${name}:oil vs mist`,
    expected: 'mismatch',
    run: () =>
      fragranceDecision(
        product('flipkart', `BLA BLI BLU ${name} Perfume Oil 30ml`),
        product('amazon', `BLABLIBLU ${name} Body Mist Perfume 30ml`),
      ).status,
  });
  matrix.push({
    label: `${name}:gendered edition`,
    expected: 'mismatch',
    run: () =>
      fragranceDecision(
        product('flipkart', `BLA BLI BLU ${name} Perfume Pour Homme 30ml`),
        product('amazon', `BLABLIBLU ${name} Perfume Pour Femme 30ml`),
      ).status,
  });
  for (const variant of ['pack of 2', 'tester', 'refill', 'bundle', 'gift set'])
    matrix.push({
      label: `${name}:${variant}`,
      expected: 'insufficient',
      run: () =>
        fragranceDecision(
          product('flipkart', title(name, 'flipkart')),
          product('amazon', `BLABLIBLU ${name} Perfume 30ml ${variant}`),
        ).status,
    });
  matrix.push({
    label: `${name}:title-only source`,
    expected: 'insufficient',
    run: () =>
      fragranceDecision(
        source(name, 'title-only'),
        product('amazon', title(name, 'amazon')),
      ).status,
  });
  matrix.push({
    label: `${name}:no listing variant`,
    expected: 'insufficient',
    run: () =>
      fragranceDecision(source(name), {
        title: `BLABLIBLU ${name} Perfume`,
        brand: 'BLA BLI BLU',
      }).status,
  });
}
matrix.push({
  label: 'unresolved single-word scent',
  expected: 'insufficient',
  run: () =>
    fragranceDecision(
      product('flipkart', 'BLA BLI BLU Verge Perfume 30ml'),
      product('amazon', 'BLABLIBLU Verge Perfume 30ml'),
    ).status,
});
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-only');
  mocks.load.mockReset();
  mocks.load.mockResolvedValue([]);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  compare = (await import('@/lib/scraper/compare')).findOffersWithDiagnostics;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('offline fragrance benchmark: synthetic multi-product matrix', () => {
  it.each(matrix)('$label -> $expected', (test) =>
    expect(test.run()).toBe(test.expected),
  );
  it('exports an understandable three-way benchmark summary', () => {
    const counts = { verified: 0, mismatch: 0, insufficient: 0 };
    for (const test of matrix) {
      const actual = test.run();
      expect(actual).toBe(test.expected);
      counts[test.expected]++;
    }
    console.log('OFFLINE fragrance benchmark (synthetic, not live):', counts);
    expect(counts.verified).toBe(18);
    expect(counts.mismatch).toBe(14);
    expect(counts.insufficient).toBe(15);
  });
});
describe('store-aware selected root volume provenance', () => {
  it.each([
    'General.Quantity',
    'General.Net Quantity',
    'Product Highlights.Quantity',
    'highlights.Quantity',
  ])('supports independently URL-bound %s after root validation', (field) => {
    const p = source('Old Money', field);
    expect(independentFragrance(p.canonicalIdentity)).toBe(true);
    expect(
      verifiedOffers(p, [
        { ...product('amazon', title('Old Money', 'amazon')), price: 250 },
      ]),
    ).toHaveLength(1);
  });
  it('does not promote title, catalog or per-unit quantities', () => {
    const p = source('Old Money', 'title-only');
    expect(p.variant).toBe('30ml');
    expect(independentFragrance(p.canonicalIdentity)).toBe(false);
    expect(
      resolveSelectedVolume('flipkart', {
        product_results: {
          title: 'Old Money 30ml',
          variants: [{ quantity: '30ml' }],
          sizes: ['30ml'],
        },
      }).status,
    ).toBe('missing');
    expect(
      resolveSelectedVolume('myntra.com', {
        product_results: {
          name: 'Old Money 30ml',
          selectedSeller: { netQuantity: null },
          sizes: [{ per_unit_amount: { quantity: 100, unit: 'ml' } }],
        },
      }).status,
    ).toBe('missing');
  });
  it('rejects conflicts, unsupported forms and forged provenance', () => {
    expect(
      resolveSelectedVolume('flipkart', {
        product_results: {
          specifications: { General: { Quantity: '30ml', 'Net Quantity': '100ml' } },
        },
      }).status,
    ).toBe('conflict');
    expect(
      resolveSelectedVolume('flipkart', {
        product_results: { specifications: { General: { Quantity: ['30ml'] } } },
      }).status,
    ).toBe('unsupported');
    expect(
      resolveSelectedVolume('myntra.com', {
        product_results: {
          selectedSeller: {
            netQuantity: [{ quantity: 30, unit: 'ml', type: 'per-unit' }],
          },
        },
      }).status,
    ).toBe('unsupported');
    expect(
      resolveSelectedVolume('amazon', {
        product_information: { 'Item Volume': '0.03 L', 'Package Size Name': '30ml' },
      }),
    ).toMatchObject({ status: 'verified', volume: 30 });
  });
});
describe('identity before price, persistence and bounded diagnostics', () => {
  it('distinguishes a wrong scent with a cheap price from a genuine deep-discount anomaly', async () => {
    const p = source();
    const base = product('amazon', title('Old Money', 'amazon'));
    const good = {
      ...base,
      currentPrice: 50,
      priceObservation: observeProduct(base.canonicalIdentity, 50, '₹', false),
    };
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon'
        ? [
            { ...good, price: 50 },
            { ...product('amazon', title('Love Drunk', 'amazon')), price: 50 },
          ]
        : [],
    );
    const result = await compare(p);
    const d = result.diagnostics.find((d) => d.store === 'amazon')!;
    expect(d).toMatchObject({
      sourceConfidence: 'independent-main',
      identityAssessment: { verified: 1, mismatch: 1, insufficient: 0 },
      rejections: { 'price-anomaly': 1, 'explicit-mismatch': 1 },
    });
    expect(verifiedOffers(p, [{ ...good, price: 50 }])).toEqual([]);
    expect(comparisonPriceStatus(50, 250)).toBe('price-anomaly');
    expect(comparisonPriceStatus(0, 250)).toBe('invalid-price');
    expect(comparisonPriceStatus(250, 250)).toBe('accepted');
    expect(JSON.stringify(d)).not.toMatch(
      /Old Money|Love Drunk|https|PERHH|offline-only/,
    );
    expect(mocks.load).toHaveBeenCalledTimes(2); // no Product calls, retries or hydration
  });
  it('runs parsed Old Money search rows through discovery and render, without inferring Myntra catalog size selection', async () => {
    const p = source('Old Money', 'General.Net Quantity');
    const amazonRows = parseAmazonSearchAPI(
      JSON.stringify({
        results: [
          {
            ...amazonSearch.results[0],
            title: title('Old Money', 'amazon'),
            asin: 'B0TEST0001',
            optimized_url: urls.amazon,
            extracted_price: 250,
            price_string: '₹250',
            price: '₹250',
          },
        ],
      }),
    );
    const m = structuredClone(myntraSearch);
    Object.assign(m.search_results[0], {
      productId: 12345678,
      productName: 'BLA BLI BLU Old Money Perfume',
      brand: 'BLA BLI BLU',
      price: 250,
      mrp: 275,
      landingPageUrl: 'perfume/test/12345678/buy',
      sizes: '30ml,100ml',
    });
    const myntraRows = parseMyntraSearch(JSON.stringify(m));
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon' ? amazonRows : myntraRows,
    );
    const result = await compare(p);
    expect(result.offers.map((o) => o.store).sort()).toEqual(['amazon', 'flipkart']);
    expect(verifiedOffers(p, result.offers)).toEqual(result.offers);
    expect(result.diagnostics.find((d) => d.store === 'myntra.com')).toMatchObject({
      identityAssessment: { verified: 0, insufficient: 1 },
      identityReasons: { 'volume-unconfirmed': 1 },
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('distinguishes legacy eligibility from independent canonical source evidence', async () => {
    const p = source('Old Money', 'title-only');
    mocks.load.mockImplementation(async (adapter: { id: string }) =>
      adapter.id === 'amazon'
        ? [{ ...product('amazon', title('Old Money', 'amazon')), price: 250 }]
        : [],
    );
    const d = (await compare(p)).diagnostics.find((d) => d.store === 'amazon')!;
    expect(d).toMatchObject({
      sourceConfidence: 'legacy-only',
      sourceIndependentlyValidated: false,
      sourceVolumeEvidence: { state: 'missing' },
      sourceIssues: ['volume-unconfirmed'],
      identityAssessment: { verified: 0, insufficient: 1 },
    });
  });
  it('keeps identity associations separate from price anomalies and observation freshness', () => {
    const a = product('flipkart', title('Old Money', 'flipkart')),
      b = product('amazon', title('Old Money', 'amazon'));
    const links = validAssociations(a, [
      {
        profile: 'fragrance-v1',
        store: b.store,
        url: b.url,
        identity: b.canonicalIdentity,
      },
    ]);
    expect(links).toHaveLength(1);
    expect(freshProfilePrice(b)).toBe(true);
    const stale = {
      ...b,
      priceObservation: {
        ...b.priceObservation,
        observedAt: new Date(Date.now() - 600001).toISOString(),
      },
    };
    expect(freshProfilePrice(stale)).toBe(false);
    expect(validAssociations(a, links)).toHaveLength(1);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('@/lib/scraper/index', () => ({
  scrapeProduct: vi.fn(() => {
    throw new Error('Network disabled in offline test');
  }),
}));
import { scrapeProduct } from '@/lib/scraper/index';
import real from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
import { verifyCandidateLinks } from '@/lib/scraper/verify-candidate-links';
const url =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds/p/itmcontract?pid=REQUESTID';
function contract() {
  // Synthetic contract, not a captured ProClip response or live price.
  const p = structuredClone(real).product_results;
  return {
    product_results: {
      ...p,
      title: 'boAt Airdopes ProClip OWS Earbuds Black',
      brand: 'boAt',
      specifications: { General: { Color: 'Black' } },
      highlights: [],
      variants: [{ price: 1, selected: true, color: 'White' }],
    },
  };
}
const parse = (p: unknown = contract(), input = url) =>
  parseFlipkartAPIProduct(JSON.stringify(p), input);
afterEach(() => vi.restoreAllMocks());
describe('tracking evidence is distinct from comparison identity', () => {
  it('tracks a missing-model main product with consistent provider URL/title/brand and selected evidence', () => {
    const p = parse();
    expect(p).toMatchObject({
      url,
      currentPrice: 250,
      currency: '₹',
      isOutOfStock: false,
      comparisonIdentityVerified: false,
      variant: 'colour=black',
    });
    expect(p).not.toHaveProperty('model');
    expect(p).not.toHaveProperty('storeProductId');
  });
  it('does not call an equally worded tracking-only product a verified competitor', () => {
    const p = parse();
    expect(isVerifiedProductMatch(p, p)).toBe(false);
    expect(
      verifiedOffers(p, [
        {
          title: p.title,
          brand: p.brand,
          variant: p.variant,
          store: 'amazon',
          storeName: 'Amazon',
          url: 'https://www.amazon.in/dp/B0FYGRL51R',
          currency: '₹',
          price: 250,
        },
      ]),
    ).toEqual([]);
  });
  it('preserves the tracked store price, but skips manual paid competitor requests for insufficient identity', async () => {
    const p = parse();
    const result = await verifyCandidateLinks(p, ['https://www.amazon.in/dp/B0FYGRL51R']);
    expect(scrapeProduct).not.toHaveBeenCalled();
    expect(result.offers).toEqual([]);
    expect(result.diagnostics[0].status).toBe('rejected');
  });
  it('accepts variable/absent specification groups for tracking with no alternative selection catalog', () => {
    const p = contract();
    Object.assign(p.product_results, {
      specifications: { 'Audio Features': { Notes: ['not used'] } },
      variants: [],
      display_sizes: [],
    });
    expect(parse(p).comparisonIdentityVerified).toBe(false);
  });
  it('rejects ambiguous identity rather than substituting missing model from catalog', () => {
    expect(() =>
      parse(contract(), 'https://www.flipkart.com/product/p/itmcontract?pid=REQUESTID'),
    ).toThrow(/tracking identity is ambiguous/);
    const p = contract();
    Reflect.deleteProperty(p.product_results.specifications.General, 'Color');
    expect(() => parse(p)).toThrow(/ambiguous/);
  });
  it('permits explicit matching response identity for an opaque URL, never SKU-to-PID equivalence', () => {
    const p = contract();
    Object.assign(p.product_results, { pid: 'REQUESTID' });
    expect(
      parse(p, 'https://www.flipkart.com/product/p/itmcontract?pid=REQUESTID')
        .comparisonIdentityVerified,
    ).toBe(false);
    for (const hint of [
      { pid: 'OTHER' },
      { canonical_url: 'https://www.flipkart.com/other/p/itmother?pid=OTHER' },
    ])
      expect(() => parse({ product_results: { ...p.product_results, ...hint } })).toThrow(
        /conflicts/,
      );
  });
  it('rejects bad stock, price, colour and unsupported non-missing model structures', () => {
    for (const extra of [{ availability: 'Unknown' }, { price: '₹0' }, { price: '$250' }])
      expect(() =>
        parse({ product_results: { ...contract().product_results, ...extra } }),
      ).toThrow();
    const p = contract();
    p.product_results.specifications.General.Color = 'White';
    expect(() => parse(p)).toThrow(/conflicts/);
    Object.assign(p.product_results.specifications.General, {
      'Model Name': ['invented'],
    });
    expect(() => parse(p)).toThrow(/unsupported model representation/);
  });
});

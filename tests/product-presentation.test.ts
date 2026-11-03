import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('@/components/CompareButton', () => ({ default: () => null }));
vi.mock('@/components/live/RelativeTime', () => ({
  default: () => 'checked previously',
}));
vi.mock('@/components/ui/Money', () => ({
  default: ({ amount }: { amount: number }) => `PRICE_${amount}`,
}));
vi.mock('@/components/ui/StoreLogo', () => ({ default: () => null }));
import OfferComparison from '@/components/OfferComparison';
import {
  customerProductDescription,
  DESCRIPTION_UNAVAILABLE,
  EXACT_OFFERS_UNVERIFIED,
} from '@/lib/product-presentation';
import {
  parseFlipkartAPIProduct,
  parseAmazonAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { isVerifiedProductMatch } from '@/lib/verified-offers';
import real from './fixtures/flipkart-product-real.json';
import amazon from './fixtures/amazon-india-product-full.json';
const url =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds/p/itmexample?pid=CONTRACT';
function contract() {
  // Controlled contract mutations, NOT captured ProClip identity/price evidence.
  return {
    product_results: {
      ...structuredClone(real).product_results,
      title: 'boAt Airdopes ProClip OWS Earbuds Black',
      brand: 'boAt',
      specifications: { General: { 'Model Name': 'Airdopes ProClip', Color: 'Black' } },
      highlights: [],
      variants: [{ color: 'White', price: 1 }],
    },
  };
}
const parse = (data: unknown = contract()) =>
  parseFlipkartAPIProduct(JSON.stringify(data), url);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('customer description uses only genuine root text or an honest fallback', () => {
  it('preserves plain-text description supplied by the root product', () => {
    const data = contract();
    data.product_results.description =
      'Air conduction design.\nSee manufacturer instructions before use.';
    expect(parse(data).description).toBe(data.product_results.description);
  });
  it.each([
    undefined,
    null,
    {},
    '',
    '<script>raw provider html</script>',
    'api_key=PRIVATE',
    'URL-based provider response; descriptive URL corroboration. Response SKU PRIVATE; response PID not independently verified.',
    'Amazon ASIN B0FYGRL51R. Validated main-product price.',
    'Myntra product 123. Seller 456, SKU 789.',
  ])('hides unsupported or legacy internal description %#', (description) => {
    expect(customerProductDescription(description)).toBe(DESCRIPTION_UNAVAILABLE);
    const data = contract();
    Object.assign(data.product_results, { description });
    expect(parse(data).description).toBe(DESCRIPTION_UNAVAILABLE);
  });
  it('does not let missing description change root price, stock or selected evidence', () => {
    const data = contract();
    Reflect.deleteProperty(data.product_results, 'description');
    expect(parse(data)).toMatchObject({
      currentPrice: 250,
      isOutOfStock: false,
      comparisonIdentityVerified: true,
      variant: 'colour=black',
      description: DESCRIPTION_UNAVAILABLE,
    });
  });
});
describe('post-tracking comparison state remains evidence-based', () => {
  it('renders the explicit unverified state and hides saved competitor prices when main identity is incomplete', () => {
    vi.stubGlobal('React', React);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = contract();
    data.product_results.title = 'boAt Airdopes ProClip OWS Earbuds';
    Object.assign(data.product_results, { specifications: { General: {} } });
    const parsed = parse(data);
    expect(parsed.comparisonIdentityVerified).toBe(false);
    expect(parsed.variant).toBeUndefined();
    const product = {
      ...parsed,
      _id: 'test',
      priceHistory: [],
      highestPrice: 250,
      lowestPrice: 250,
      averagePrice: 250,
      offers: [
        {
          store: 'amazon',
          storeName: 'UNVERIFIED_COMPETITOR_MARKER',
          url: 'https://www.amazon.in/dp/B0FYGRL51R',
          title: parsed.title,
          price: 17,
          currency: '₹',
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(OfferComparison, { product }));
    expect(html).toContain(EXACT_OFFERS_UNVERIFIED);
    expect(html).toContain('Your product is tracked');
    expect(html).not.toContain('Searching other stores');
    expect(html).not.toContain('UNVERIFIED_COMPETITOR_MARKER');
    expect(html).not.toContain('PRICE_17');
  });
  it('allows matching only when independently validated main responses contain the same known model/colour', () => {
    vi.stubGlobal('React', React);
    const flipkart = parse();
    const data = structuredClone(amazon);
    data.title = 'boAt Airdopes ProClip OWS Earbuds Black';
    data.main_title = data.title;
    data.product_information.Brand = 'boAt';
    Reflect.deleteProperty(data.product_information, 'Item Volume');
    Reflect.deleteProperty(data.product_information, 'Package Size Name');
    const source = parseAmazonAPIProduct(
      JSON.stringify(data),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    expect(isVerifiedProductMatch(source, flipkart)).toBe(true);
    expect(
      isVerifiedProductMatch(source, {
        ...flipkart,
        title: flipkart.title.replace('ProClip', 'ProClip Pro'),
      }),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(source, {
        ...flipkart,
        title: flipkart.title.replace('Black', 'White'),
        variant: 'colour=white',
      }),
    ).toBe(false);
    const product = {
      ...source,
      _id: 'test',
      priceHistory: [],
      highestPrice: 184,
      lowestPrice: 184,
      averagePrice: 184,
      offers: [
        {
          store: source.store,
          storeName: source.storeName,
          title: source.title,
          url: source.url,
          price: source.currentPrice,
          currency: source.currency,
        },
        {
          store: flipkart.store,
          storeName: flipkart.storeName,
          title: flipkart.title,
          brand: flipkart.brand,
          variant: flipkart.variant,
          url: flipkart.url,
          price: flipkart.currentPrice,
          currency: flipkart.currency,
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(OfferComparison, { product }));
    expect(html).toContain('Flipkart');
    expect(html).toContain('PRICE_250');
    expect(html).not.toContain(EXACT_OFFERS_UNVERIFIED);
  });
});

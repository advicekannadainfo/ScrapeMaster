import { describe, it, expect, vi, afterEach } from 'vitest';
import amazonFixture from './fixtures/amazon-india-product.json';
import flipkartFixture from './fixtures/flipkart-product.json';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { amazon } from '@/lib/scraper/stores/amazon';
import { isVerifiedMatch, verifiedOffers } from '@/lib/verified-offers';
const url = 'https://www.amazon.in/dp/B0FYGRL51R';
const parse = (p: unknown = amazonFixture) =>
  parseAmazonAPIProduct(JSON.stringify(p), url);
afterEach(() => vi.unstubAllEnvs());
describe('supplied Amazon India Product contract (offline reduced fixture)', () => {
  it('returns the requested 30ml ASIN at 184 and never promotes a related 100ml offer', () => {
    expect(parse()).toMatchObject({
      currentPrice: 184,
      originalPrice: 184,
      currency: '₹',
      storeProductId: 'B0FYGRL51R',
      variant: '30ml',
      isOutOfStock: false,
    });
    expect(parse().title).toContain('30ml');
    expect(parse().description).not.toContain('B0FLWST1D4');
  });
  it('rejects this response when requesting the related 100ml ASIN', () => {
    expect(() =>
      parseAmazonAPIProduct(
        JSON.stringify(amazonFixture),
        'https://www.amazon.in/dp/B0FLWST1D4',
      ),
    ).toThrow(/different ASIN/);
  });
  it('does not compare the 30ml price against Myntra Love Drunk 100ml', () => {
    const p = parse();
    const source = {
      title: 'BLA BLI BLU Love Drunk Perfume 100ml',
      url: 'https://www.myntra.com/x/36340100/buy',
      store: 'myntra.com',
      currentPrice: 650,
      currency: '₹',
    };
    expect(isVerifiedMatch(source, p)).toBe(false);
    expect(
      verifiedOffers(source, [
        {
          store: p.store,
          storeName: p.storeName,
          title: p.title,
          price: p.currentPrice,
          currency: p.currency,
          url: p.url,
        },
      ]),
    ).toEqual([]);
  });
  it('related sections of any shape never rescue missing requested-product price', () => {
    const p = structuredClone(amazonFixture);
    Reflect.deleteProperty(p, 'extracted_price');
    expect(() => parse(p)).toThrow(/missing or invalid/);
    expect(() =>
      parse({ related_product_sections: amazonFixture.related_product_sections }),
    ).toThrow();
  });
  it('does not treat median reference price as verified MRP', () => {
    expect(parse().originalPrice).toBe(184);
    expect(parse().discountRate).toBe(0);
  });
  it('requires selected single-offer price and stock to agree', () => {
    const p = structuredClone(amazonFixture);
    p.purchase_options.single_offer.extracted_price = 649;
    expect(() => parse(p)).toThrow(/price conflicts/);
    p.purchase_options.single_offer.extracted_price = 184;
    p.purchase_options.single_offer.stock = 'Out of stock';
    expect(() => parse(p)).toThrow(/stock conflicts/);
  });
  it('rejects quantity conflicts and unsupported packs', () => {
    const p = structuredClone(amazonFixture);
    p.product_information['Package Size Name'] = '100ml';
    expect(() => parse(p)).toThrow(/quantity fields conflict/);
    p.product_information['Package Size Name'] = '2 bottles';
    expect(() => parse(p)).toThrow(/unsupported/);
  });
  it('rejects a 100ml title when selected metadata says 30ml', () => {
    const p = structuredClone(amazonFixture);
    p.main_title = 'BLA BLI BLU Love Drunk 100ml';
    expect(() => parse(p)).toThrow(/title quantity/);
  });
  it('rejects missing stock, unknown stock, non-INR and invalid prices', () => {
    for (const change of [
      { availability_status: 'Usually ships soon' },
      { price_symbol: '$' },
      { extracted_price: 0 },
      { main_image: 'http://example.com/image.jpg' },
    ]) {
      expect(() => parse({ ...amazonFixture, ...change })).toThrow();
    }
  });
  it('supports explicit out-of-stock without changing the selected price', () => {
    const p = structuredClone(amazonFixture);
    p.availability_status = 'Out of stock';
    p.purchase_options.single_offer.stock = 'Out of stock';
    expect(parse(p)).toMatchObject({ currentPrice: 184, isOutOfStock: true });
  });
  it('activates dedicated Amazon India Product routing only with a key', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    expect(amazon.productAPI!.matches(new URL(url))).toBe(true);
    expect(
      amazon.productAPI!.matches(new URL('https://www.amazon.com/dp/B0FYGRL51R')),
    ).toBe(false);
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(amazon.productAPI).toBeUndefined();
  });
  it('preserves guarded generic HTML fallback without accepting an unverified ASIN', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    const fallback = amazon.productAPI!.fallback!;
    expect(() => fallback.parse('<h1>Other product</h1>', url)).toThrow(/selected ASIN/);
    const html =
      '<input id="ASIN" value="B0FYGRL51R"><span id="productTitle">Example Perfume 30ml</span><div id="availability">In Stock</div><div class="priceToPay"><span class="a-offscreen">₹184</span></div><span class="a-price-symbol">₹</span>';
    expect(fallback.parse(html, url)).toMatchObject({
      currentPrice: 184,
      storeProductId: 'B0FYGRL51R',
    });
  });
});
describe('documented Flipkart Product fields', () => {
  it('rejects missing response identity/stock rather than echoing URL PID as verified', () => {
    expect(() =>
      parseFlipkartAPIProduct(
        JSON.stringify(flipkartFixture),
        'https://www.flipkart.com/monitor/p/itmexample?pid=MONITOR',
      ),
    ).toThrow(/identity and stock cannot be verified/);
  });
  it('rejects invalid formatted prices and malformed envelopes', () => {
    const p = structuredClone(flipkartFixture);
    p.product_results.price = '$8,999';
    expect(() =>
      parseFlipkartAPIProduct(
        JSON.stringify(p),
        'https://www.flipkart.com/monitor/p/itmexample',
      ),
    ).toThrow(/missing or invalid/);
  });
});

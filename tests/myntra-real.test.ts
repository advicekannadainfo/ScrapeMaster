import { describe, expect, it } from 'vitest';
import fixture from './fixtures/myntra-product-real.json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';

const url = 'https://www.myntra.com/perfume/bla+bli+blu/love-drunk/36340100/buy';
const sample = () => structuredClone(fixture).product_results;
const parse = (p = sample()) =>
  parseMyntraAPIProduct(JSON.stringify({ product_results: p }), url);

describe('real Myntra response (sanitized user-provided fixture; offline)', () => {
  it('extracts the selected 100 ml product for INR 650, not 184 or 252', () => {
    const result = parse();
    expect(result).toMatchObject({
      title: fixture.product_results.name,
      currentPrice: 650,
      originalPrice: 1000,
      currency: '₹',
      category: 'BLA BLI BLU',
      isOutOfStock: false,
      reviewsCount: 10223,
      description: 'Myntra product 36340100. Seller 45834, SKU 116095841.',
    });
    expect(result.stars).toBeCloseTo(4.56, 2);
    expect(result.image).toMatch(/^https:\/\/assets\.myntassets\.com\/assets\/images\//);
    expect(result.image).not.toContain('$');
  });
  it('does not depend on offer ordering', () => {
    const p = sample();
    p.sizes.reverse();
    expect(parse(p).currentPrice).toBe(650);
  });
  it.each([184, 252])(
    'rejects unrelated offer %s even when it is the only remaining offer',
    (price) => {
      const p = sample();
      p.sizes = p.sizes.filter((s) => s.discounted_price === price);
      expect(() => parse(p)).toThrow(/offer is missing/);
    },
  );
  it('supports the same-product full-price seller without a discount ID', () => {
    const p = sample();
    p.selectedSeller.sellerPartnerId = 56920;
    p.selectedSeller.discountedPrice = 1000;
    Reflect.set(p.selectedSeller, 'discount', null);
    p.price.discounted = 1000;
    expect(parse(p)).toMatchObject({ currentPrice: 1000, originalPrice: 1000 });
  });
  it('rejects a mismatched top-level product ID', () => {
    const p = sample();
    p.id = 38312143;
    expect(() => parse(p)).toThrow(/different product ID/);
  });
  it('rejects conflicting discount and style references', () => {
    const p = sample();
    p.sizes[0].discount_id = '38312143:986224708';
    expect(() => parse(p)).toThrow(/conflicting product references/);
  });
  it('rejects a selected seller discount for a different product', () => {
    const p = sample();
    p.selectedSeller.discount.discountId = '38312143:986224708';
    expect(() => parse(p)).toThrow(/different product/);
  });
  it('rejects conflicting seller references', () => {
    const p = sample();
    p.sizes[0].seller_partner_id = 56920;
    expect(() => parse(p)).toThrow(/conflicting seller/);
  });
  it('rejects a different SKU for the selected offer', () => {
    const p = sample();
    p.sizes[0].frg_list_link = p.sizes[0].frg_list_link.replace('116095841', '122303675');
    expect(() => parse(p)).toThrow(/offer is missing/);
  });
  it('rejects missing or ambiguous selected SKU identity', () => {
    const p = sample();
    p.buyButtonSellerOrder = [];
    expect(() => parse(p)).toThrow();
    p.buyButtonSellerOrder = [
      { sellerPartnerId: 45834, skuId: 116095841 },
      { sellerPartnerId: 45834, skuId: 123 },
    ];
    expect(() => parse(p)).toThrow(/SKU is missing or ambiguous/);
  });
  it('requires the offer link, not seller or price alone', () => {
    const p = sample();
    Reflect.deleteProperty(p.sizes[0], 'frg_list_link');
    expect(() => parse(p)).toThrow(/offer is missing/);
  });
  it('rejects duplicate matching offers', () => {
    const p = sample();
    p.sizes.push({ ...p.sizes[0] });
    expect(() => parse(p)).toThrow(/ambiguous/);
  });
  it.each([0, 184, 252])('rejects an invalid/conflicting selected price %s', (price) => {
    const p = sample();
    p.sizes[0].discounted_price = price;
    expect(() => parse(p)).toThrow(/conflicting price/);
  });
  it('rejects missing top-level price rather than taking a cheap unrelated offer', () => {
    const p = sample();
    Reflect.deleteProperty(p, 'price');
    expect(() => parse(p)).toThrow();
  });
  it('rejects conflicting selected seller price or MRP', () => {
    const p = sample();
    p.selectedSeller.discountedPrice = 252;
    expect(() => parse(p)).toThrow(/conflicting price/);
    p.selectedSeller.discountedPrice = 650;
    p.price.mrp = 275;
    expect(() => parse(p)).toThrow(/conflicting price/);
  });
  it('uses selected offer inventory; does not switch seller when sold out', () => {
    const p = sample();
    p.sizes[0].sellable_inventory_count = 0;
    expect(parse(p)).toMatchObject({ isOutOfStock: true, currentPrice: 650 });
  });
  it('rejects unknown selected offer stock', () => {
    const p = sample();
    Reflect.deleteProperty(p.sizes[0], 'available_count');
    Reflect.deleteProperty(p.sizes[0], 'sellable_inventory_count');
    expect(() => parse(p)).toThrow(/stock is missing/);
  });
  it('does not use normalized per-unit price or quantity as selling price', () => {
    const p = sample();
    p.sizes[0].per_unit_amount = { amount: 6.5, quantity: 1, unit: 'ml' };
    expect(parse(p)).toMatchObject({ currentPrice: 650, title: p.name });
  });
  it('rejects images with only unresolved template URLs', () => {
    const p = sample();
    Reflect.deleteProperty(p.media.albums[0].images[0], 'imageURL');
    expect(() => parse(p)).toThrow(/image is missing/);
  });
});

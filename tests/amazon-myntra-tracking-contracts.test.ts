import { describe, it, expect } from 'vitest';
import amazon from './fixtures/amazon-india-product-full.json';
import myntra from './fixtures/myntra-product-real.json';
import documented from './fixtures/myntra-product.json';
import { parseAmazonAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
const amazonURL = 'https://www.amazon.in/dp/B0FYGRL51R';
const realURL = 'https://www.myntra.com/perfume/bla-bli-blu/36340100/buy';
const docURL = 'https://www.myntra.com/jeans/powerlook/31076617/buy';
const ap = (p: unknown = amazon) => parseAmazonAPIProduct(JSON.stringify(p), amazonURL);
const mp = (p: unknown = myntra, url = realURL) =>
  parseMyntraAPIProduct(JSON.stringify(p), url);
// Controlled mutations of captured/established fixtures, NOT boAt or SKINN captures.
describe('Amazon verified main-product contract variations', () => {
  it('tracks without optional brand, ratings or duplicate single-offer section', () => {
    const p = structuredClone(amazon);
    Reflect.deleteProperty(p.product_information, 'Brand');
    Reflect.deleteProperty(p, 'purchase_options');
    Reflect.deleteProperty(p, 'extracted_average_rating');
    expect(ap(p)).toMatchObject({
      currentPrice: 184,
      currency: '₹',
      isOutOfStock: false,
      comparisonIdentityVerified: false,
      storeProductId: 'B0FYGRL51R',
    });
    expect(ap(p).brand).toBeUndefined();
  });
  it('permits absent single_offer and uses explicit stock from the supported selected offer if main stock is absent', () => {
    const p = structuredClone(amazon);
    Object.assign(p, { purchase_options: {} });
    expect(ap(p).currentPrice).toBe(184);
    const q = structuredClone(amazon);
    Reflect.deleteProperty(q, 'availability_status');
    expect(ap(q).isOutOfStock).toBe(false);
  });
  it('accepts explicit INR main price evidence when the symbol field is absent, without guessing from country', () => {
    const p = structuredClone(amazon);
    Reflect.deleteProperty(p, 'price_symbol');
    expect(ap(p).currency).toBe('₹');
    p.price = '$184.00';
    expect(() => ap(p)).toThrow(/INR/);
    p.price = '₹999.00';
    expect(() => ap(p)).toThrow(/conflicting/);
  });
  it('never derives ASIN, price or stock from request parameters or related products', () => {
    for (const key of ['extracted_price', 'availability_status']) {
      const p = structuredClone(amazon);
      Reflect.deleteProperty(p, key);
      Reflect.deleteProperty(p, 'purchase_options');
      expect(() => ap(p)).toThrow();
    }
    const p = structuredClone(amazon);
    Reflect.deleteProperty(p.product_information, 'ASIN');
    expect(() => ap(p)).toThrow(/ASIN:invalid_type:observed=undefined/);
    p.product_information.ASIN = 'B0FLWST1D4';
    expect(() => ap(p)).toThrow(/different ASIN/);
  });
  it('keeps selected price, currency, stock and quantity conflicts rejected', () => {
    const p = structuredClone(amazon);
    p.purchase_options.single_offer.extracted_price = 999;
    expect(() => ap(p)).toThrow(/price conflicts/);
    p.purchase_options.single_offer.extracted_price = 184;
    p.purchase_options.single_offer.stock = 'Out of stock';
    expect(() => ap(p)).toThrow(/stock conflicts/);
    const formatted = structuredClone(amazon);
    formatted.price = '₹999.00';
    expect(() => ap(formatted)).toThrow(/conflicting amounts/);
    formatted.price = '$184.00';
    expect(() => ap(formatted)).toThrow(/currency conflicts/);
    p.price_symbol = '$';
    expect(() => ap(p)).toThrow(/price_symbol/);
  });
  it('reports schema paths/types without echoing invalid values', () => {
    const p = structuredClone(amazon);
    Object.assign(p.product_information, { ASIN: { SECRET: 'PRIVATE_VALUE' } });
    let error;
    try {
      ap(p);
    } catch (e) {
      error = String(e);
    }
    expect(error).toContain('product_information.ASIN:invalid_type:observed=object');
    expect(error).not.toContain('PRIVATE');
    expect(error).not.toContain('SECRET');
  });
});
describe('Myntra real vs documented Product contracts remain isolated', () => {
  it('tracks the real selected product without optional brand/rating/media representation', () => {
    const p = structuredClone(myntra);
    Reflect.deleteProperty(p.product_results, 'brand');
    Reflect.deleteProperty(p.product_results, 'ratings');
    Object.assign(p.product_results, {
      media: undefined,
      images: ['https://assets.myntassets.com/example-main.jpg'],
    });
    expect(mp(p)).toMatchObject({
      currentPrice: 650,
      originalPrice: 1000,
      isOutOfStock: false,
      comparisonIdentityVerified: false,
      image: 'https://assets.myntassets.com/example-main.jpg',
    });
  });
  it('supports the established string brand representation without altering real seller/SKU selection', () => {
    const p = structuredClone(myntra);
    Object.assign(p.product_results, { brand: 'BLA BLI BLU' });
    expect(mp(p)).toMatchObject({
      brand: 'BLA BLI BLU',
      currentPrice: 650,
      variant: '100ml',
    });
  });
  it('supports the documented productId/string brand/images/sizes contract', () => {
    expect(mp(documented, docURL)).toMatchObject({
      currentPrice: 1159,
      originalPrice: 2899,
      brand: 'Powerlook',
    });
    const p = structuredClone(documented);
    Reflect.deleteProperty(p.product_results, 'brand');
    expect(mp(p, docURL).comparisonIdentityVerified).toBe(false);
  });
  it('does not fall back from corrupt real identity or seller selection to a legacy shape', () => {
    for (const key of ['id', 'selectedSeller', 'buyButtonSellerOrder']) {
      const p = structuredClone(myntra);
      Reflect.deleteProperty(p.product_results, key);
      Object.assign(p.product_results, { productId: 36340100 });
      expect(() => mp(p)).toThrow(/invalid real product data/);
    }
  });
  it('rejects wrong/conflicting product IDs in both contracts', () => {
    const p = structuredClone(myntra);
    p.product_results.id = 2316551;
    expect(() => mp(p)).toThrow(/different product ID/);
    Object.assign(p.product_results, { id: 36340100, productId: 2316551 });
    expect(() => mp(p)).toThrow(/conflicting product IDs/);
    const q = structuredClone(documented);
    q.product_results.productId = 2316551;
    expect(() => mp(q, docURL)).toThrow(/different product ID/);
  });
  it('does not accept a real selected-price/SKU conflict or use the unrelated cheaper sizes', () => {
    const p = structuredClone(myntra);
    p.product_results.selectedSeller.discountedPrice = 184;
    expect(() => mp(p)).toThrow(/conflicting price/);
    const q = structuredClone(myntra);
    q.product_results.buyButtonSellerOrder[0].skuId = 999;
    expect(() => mp(q)).toThrow(/offer is missing/);
    expect(mp().currentPrice).toBe(650);
  });
  it('rejects a wrong volume in the documented sizes contract', () => {
    const p = structuredClone(documented);
    Object.assign(p.product_results, {
      name: 'Example Perfume 20ml',
      sizes: [
        { label: '100ml', available: true, stock: 1, discounted_price: 100, mrp: 200 },
      ],
    });
    expect(() => mp(p, docURL)).toThrow(/size quantity conflicts/);
  });
  it('rejects missing stock or missing image rather than guessing available stock/image', () => {
    const p = structuredClone(documented);
    p.product_results.sizes.forEach((s) => {
      s.available = false;
    });
    expect(() => mp(p, docURL)).toThrow(/No available/);
    const q = structuredClone(documented);
    Reflect.deleteProperty(q.product_results, 'images');
    expect(() => mp(q, docURL)).toThrow(/image missing/);
  });
  it('reports safe schema field paths without selected-seller payload values', () => {
    const p = structuredClone(myntra);
    Object.assign(p.product_results.selectedSeller, {
      sellerPartnerId: { SECRET: 'PRIVATE_VALUE' },
    });
    let error;
    try {
      mp(p);
    } catch (e) {
      error = String(e);
    }
    expect(error).toContain('selectedSeller.sellerPartnerId:invalid_union');
    expect(error).not.toContain('PRIVATE');
    expect(error).not.toContain('SECRET');
  });
});

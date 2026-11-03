import { describe, expect, it } from 'vitest';
import real from './fixtures/flipkart-product-real.json';
import {
  parseFlipkartAPIProduct,
  inspectFlipkartAPIProduct,
  MAX_FLIPKART_VARIANTS,
} from '@/lib/scraper/stores/retail-product-json';
const url =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds-air-conduction-tech-52h-battery-app-support-btv6-0-bluetooth/p/itmff4c9a382c887?pid=ACCHN7ZPTFV2ZACN';
function contract() {
  // Synthetic contract using verified response fields. Price/SKU/image are from
  // the existing perfume fixture, NOT a claimed capture of the real ProClip API.
  const p = structuredClone(real).product_results;
  return {
    product_results: {
      ...p,
      title: 'boAt Airdopes ProClip OWS Earbuds Black',
      brand: 'boAt',
      specifications: { General: { 'Model Name': 'Airdopes ProClip', Color: 'Black' } },
      highlights: [],
      variants: [{ unknown_provider_shape: 'catalog-only', price: 1, selected: true }],
      display_sizes: [],
    },
  };
}
const parse = (data: unknown = contract(), input = url) =>
  parseFlipkartAPIProduct(JSON.stringify(data), input);
describe('focused Flipkart model/variants compatibility, offline only', () => {
  it('accepts the documented string model and nonempty catalog with independent selected-product evidence', () => {
    expect(parse()).toMatchObject({
      brand: 'boAt',
      title: 'boAt Airdopes ProClip OWS Earbuds Black',
      currentPrice: 250,
      variant: 'colour=black',
      isOutOfStock: false,
    });
    expect(parse()).not.toHaveProperty('storeProductId'); // Fixture SKU is not requested PID proof.
  });
  it('trims a documented string without converting unsupported structures', () => {
    const p = contract();
    p.product_results.specifications.General['Model Name'] = '  Airdopes ProClip  ';
    expect(parse(p).currentPrice).toBe(250);
  });
  it.each(
    [
      null,
      42,
      {},
      { value: 'private model text' },
      ['Airdopes ProClip'],
      ['Airdopes', 'ProClip'],
      [],
      true,
      '',
    ].map((model) => ({ model })),
  )(
    'rejects unestablished model representation %# with structural-only diagnostics',
    ({ model }) => {
      const p = contract();
      Object.assign(p.product_results.specifications.General, { 'Model Name': model });
      let error: unknown;
      try {
        parse(p);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(
        'General.Model Name: unsupported model representation',
      );
      expect(String(error)).not.toContain('private model text');
    },
  );
  it('reports observed array/null structure without printing values', () => {
    const p = contract();
    Object.assign(p.product_results.specifications.General, {
      'Model Name': ['SENSITIVE_MODEL'],
    });
    expect(() => parse(p)).toThrow(/observed=array; length=1; elementTypes=string/);
    Object.assign(p.product_results.specifications.General, { 'Model Name': null });
    expect(() => parse(p)).toThrow(/observed=null/);
  });
  it('does not infer model from title, request URL or catalog contents', () => {
    const p = contract();
    Reflect.deleteProperty(p.product_results.specifications.General, 'Model Name');
    expect(parse(p).comparisonIdentityVerified).toBe(false);
    expect(parse(p)).not.toHaveProperty('model');
  });
  it('ignores catalog prices, selections and IDs even when their values look usable', () => {
    const p = contract();
    Object.assign(p.product_results, {
      variants: [
        { selected: true, price: 1, sku: 'OTHER', color: 'White' },
        null,
        'opaque alternative',
      ],
    });
    expect(parse(p).currentPrice).toBe(250);
    expect(parse(p).variant).toBe('colour=black');
  });
  it.each(['price', 'sku', 'availability', 'brand'])(
    'catalog cannot rescue missing main-product %s',
    (field) => {
      const p = contract();
      Reflect.deleteProperty(p.product_results, field);
      expect(() => parse(p)).toThrow();
    },
  );
  it('requires colour evidence from selected specifications and main title independently', () => {
    const missing = contract();
    Reflect.deleteProperty(missing.product_results.specifications.General, 'Color');
    expect(() => parse(missing)).toThrow(/independent main-product colour evidence/);
    const titleMissing = contract();
    titleMissing.product_results.title = 'boAt Airdopes ProClip OWS Earbuds';
    expect(() => parse(titleMissing)).toThrow(/independent main-product colour evidence/);
  });
  it('rejects conflicts in model, colour and response-side PID/canonical URL', () => {
    const model = contract();
    model.product_results.specifications.General['Model Name'] = 'Different Model';
    expect(() => parse(model)).toThrow(/model identity fields conflict/);
    const colour = contract();
    colour.product_results.specifications.General.Color = 'White';
    expect(() => parse(colour)).toThrow(/attribute conflicts/);
    for (const hint of [
      { pid: 'OTHER' },
      { product_id: 'OTHER' },
      { canonical_url: 'https://www.flipkart.com/other/p/itmother?pid=OTHER' },
    ])
      expect(() =>
        parse({ product_results: { ...contract().product_results, ...hint } }),
      ).toThrow(/conflicts/);
  });
  it('rejects unknown stock, non-INR and nonpositive prices despite nonempty catalog', () => {
    for (const change of [
      { availability: 'Unknown' },
      { price: '$250' },
      { price: '₹0' },
    ])
      expect(() =>
        parse({ product_results: { ...contract().product_results, ...change } }),
      ).toThrow();
  });
  it('bounds the opaque catalog and rejects malformed variants', () => {
    const p = contract();
    Object.assign(p.product_results, {
      variants: Array(MAX_FLIPKART_VARIANTS).fill(null),
    });
    expect(parse(p).currentPrice).toBe(250);
    Object.assign(p.product_results, {
      variants: Array(MAX_FLIPKART_VARIANTS + 1).fill(null),
    });
    expect(() => parse(p)).toThrow(/variants:too_big/);
    Object.assign(p.product_results, { variants: { selected: 'unknown' } });
    expect(() => parse(p)).toThrow(/variants:invalid_type/);
  });
  it('retains real perfume parsing and rejects an ambiguous perfume alternatives catalog', () => {
    const perfume =
      'https://www.flipkart.com/bla-bli-blu-love-drunk-men-women-cinnamon-date-notes-30-ml/p/itmreal?pid=PERHHD9GPW6NNYRQ';
    expect(parse(real, perfume)).toMatchObject({ currentPrice: 250, variant: '30ml' });
    expect(() =>
      inspectFlipkartAPIProduct(
        JSON.stringify({
          product_results: { ...real.product_results, variants: [{ size: '100ml' }] },
        }),
        perfume,
      ),
    ).toThrow(/ambiguous/);
  });
});

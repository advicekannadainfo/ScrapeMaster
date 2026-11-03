import { describe, it, expect } from 'vitest';
import {
  mainProductDescription,
  DESCRIPTION_UNAVAILABLE,
} from '@/lib/product-presentation';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';
import myntra from './fixtures/myntra-product-real.json';
import documented from './fixtures/myntra-product.json';
const aurl = 'https://www.amazon.in/dp/B0FYGRL51R';
const furl =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itmreal?pid=PERHHD9GPW6NNYRQ';
const murl = 'https://www.myntra.com/perfume/bla-bli-blu/36340100/buy';
const ap = (p: unknown = amazon) => parseAmazonAPIProduct(JSON.stringify(p), aurl);
const fp = (p: unknown = flipkart) => parseFlipkartAPIProduct(JSON.stringify(p), furl);
const mp = (p: unknown = myntra) => parseMyntraAPIProduct(JSON.stringify(p), murl);
const withoutDescription = (product: ReturnType<typeof ap>) => {
  const copy = { ...product };
  Reflect.deleteProperty(copy, 'description');
  return copy;
};
describe('bounded main-product text normalization', () => {
  it('deduplicates multiline bullets and never stringifies unsupported objects', () => {
    expect(
      mainProductDescription(' Genuine root text. ', [
        '• Genuine root text',
        '- Useful specification',
        '',
        null,
        { description: 'DO_NOT_DUMP' },
        ['nested'],
      ]),
    ).toBe('Genuine root text.\nUseful specification');
  });
  it('retains valid lines while ignoring unsafe or technical text', () => {
    expect(
      mainProductDescription([
        '<script>bad</script>',
        'Response SKU PRIVATE; response PID not independently verified',
        'api_key=PRIVATE',
        'Useful main text',
      ]),
    ).toBe('Useful main text');
  });
  it.each(
    [undefined, null, {}, [], ['', null, {}, '<p>unsupported HTML</p>']].map((value) => [
      value,
    ]),
  )('uses fallback only when no usable content %#', (value) => {
    expect(mainProductDescription(value)).toBe(DESCRIPTION_UNAVAILABLE);
  });
  it('bounds lines and total text length', () => {
    const text = mainProductDescription(
      Array.from({ length: 100 }, (_, i) => 'Fact ' + i),
    );
    expect(text.split('\n')).toHaveLength(8);
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(mainProductDescription('x'.repeat(1501), ['Valid line'])).toBe('Valid line');
  });
});
describe('genuine fields in established Amazon/Flipkart fixtures', () => {
  it('Amazon displays captured feature_bullets and main description, not related-product content', () => {
    expect(ap().description.split('\n')).toEqual([
      amazon.description,
      ...amazon.feature_bullets,
    ]);
    const p = structuredClone(amazon);
    Reflect.deleteProperty(p, 'description');
    Reflect.deleteProperty(p, 'feature_bullets');
    expect(ap(p).description).toBe(DESCRIPTION_UNAVAILABLE);
    expect(withoutDescription(ap(p))).toEqual(withoutDescription(ap()));
  });
  it('Flipkart combines actual root description/highlights with duplicates removed', () => {
    expect(fp().description.split('\n')).toEqual([
      flipkart.product_results.description.replace(/[\t ]+/g, ' '),
      ...flipkart.product_results.highlights,
    ]);
    const p = structuredClone(flipkart);
    p.product_results.description = p.product_results.highlights[0];
    expect(fp(p).description.split('\n')).toEqual(p.product_results.highlights);
  });
  it('optional malformed highlights do not break tracking or alter price/identity', () => {
    const reference = fp();
    for (const highlights of [null, {}, ['', {}, '<script>unsafe</script>']]) {
      const p = structuredClone(flipkart);
      Object.assign(p.product_results, { highlights });
      expect(withoutDescription(fp(p))).toEqual(withoutDescription(reference));
    }
  });
});
describe('Myntra product_details: conservative plain-text adapter, not an invented object schema', () => {
  it('ignores unsupported nested details from real fixture mutations without affecting tracking', () => {
    const p = structuredClone(myntra);
    Object.assign(p.product_results, {
      product_details: [{ title: 'PRIVATE', description: 'DO_NOT_DUMP_OBJECT' }],
    });
    expect(mp(p).description).toBe(DESCRIPTION_UNAVAILABLE);
    expect(withoutDescription(mp(p))).toEqual(withoutDescription(mp()));
  });
  it('can display direct plain text/string-list when supplied, without assigning a schema to unknown objects', () => {
    // Synthetic text representations; no nonempty Myntra product_details capture exists.
    const p = structuredClone(myntra);
    Object.assign(p.product_results, {
      product_details: ['Root description', 'Quantity information', 'Root description'],
    });
    expect(mp(p).description).toBe('Root description\nQuantity information');
    expect(withoutDescription(mp(p))).toEqual(withoutDescription(mp()));
    const q = structuredClone(documented);
    Object.assign(q.product_results, { product_details: 'Genuine main-product text' });
    expect(
      parseMyntraAPIProduct(
        JSON.stringify(q),
        'https://www.myntra.com/jeans/powerlook/31076617/buy',
      ).description,
    ).toBe('Genuine main-product text');
  });
  it.each([null, undefined, {}, []].map((value) => [value]))(
    'does not require product_details %#',
    (details) => {
      const p = structuredClone(myntra);
      Object.assign(p.product_results, { product_details: details });
      expect(withoutDescription(mp(p))).toEqual(withoutDescription(mp()));
    },
  );
});

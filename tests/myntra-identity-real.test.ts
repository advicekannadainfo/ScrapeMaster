import { describe, expect, it } from 'vitest';
import real from './fixtures/myntra-product-real.json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';

describe('real Myntra selected size identity', () => {
  it('extracts brand and 100ml selected quantity without inventing a 30ml offer', () => {
    const parsed = parseMyntraAPIProduct(
      JSON.stringify(real),
      'https://www.myntra.com/perfume/bla-bli-blu/36340100/buy',
    );
    expect(parsed.brand).toBe('BLA BLI BLU');
    expect(parsed.variant).toBe('100ml');
  });
  it('rejects conflicting seller quantity', () => {
    const conflict = structuredClone(real);
    conflict.product_results.selectedSeller.netQuantity[0].quantity = 30;
    expect(() =>
      parseMyntraAPIProduct(
        JSON.stringify(conflict),
        'https://www.myntra.com/perfume/bla-bli-blu/36340100/buy',
      ),
    ).toThrow(/quantity conflict/);
  });
});

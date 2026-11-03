import { describe, it, expect } from 'vitest';
import { isVerifiedProductMatch } from '@/lib/verified-offers';
import { titleAttributes, selectedAttributes } from '@/lib/scraper/product-identity';
import {
  inspectFlipkartAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import real from './fixtures/flipkart-product-real.json';
const pairs = [
  [
    'perfume',
    'BLA BLI BLU Love Drunk Perfume 30ml',
    'BLA BLI BLU Love Drunk Perfume 100ml',
  ],
  [
    'earbuds',
    'boAt Airdopes ProClip OWS Earbuds Black',
    'boAt Airdopes ProClip OWS Earbuds White',
  ],
  [
    'phone',
    'Samsung Galaxy S24 Smartphone 128GB Black',
    'Samsung Galaxy S24 Smartphone 256GB Black',
  ],
  [
    'laptop',
    'Dell XPS 13 Laptop i7 16GB 512GB Silver',
    'Dell XPS 13 Laptop i5 16GB 512GB Silver',
  ],
  ['fashion', 'Levis 501 Jeans Size M Blue', 'Levis 501 Jeans Size L Blue'],
  ['grocery', 'Acme Rice 1kg Pack of 2', 'Acme Rice 1kg Pack of 1'],
  [
    'appliance',
    'LG AB123 Washing Machine 7kg White',
    'LG AB123 Washing Machine 8kg White',
  ],
];
describe('synthetic category identity regressions (not retailer API responses)', () => {
  it.each(pairs)('%s accepts identical evidence and rejects wrong variant', (_, a, b) => {
    expect(isVerifiedProductMatch({ title: a }, { title: a })).toBe(true);
    expect(isVerifiedProductMatch({ title: a }, { title: b })).toBe(false);
  });
  it('rejects omitted colour, phone storage, pack and appliance capacity', () => {
    for (const [a, b] of [
      ['boAt ProClip Earbuds Black', 'boAt ProClip Earbuds'],
      ['Pixel 9 Smartphone 128GB', 'Pixel 9 Smartphone'],
      ['Rice 1kg Pack of 2', 'Rice 1kg'],
      ['LG AB123 Washing Machine 7kg', 'LG AB123 Washing Machine'],
    ])
      expect(isVerifiedProductMatch({ title: a }, { title: b })).toBe(false);
  });
  it('normalizes units but never merges different pack totals', () => {
    expect(titleAttributes('Rice 1 kg Pack of 2')).toEqual(
      titleAttributes('Rice 1000g Pack of 2'),
    );
    expect(() => selectedAttributes('ProClip Black', { Color: 'White' })).toThrow(
      /conflict/,
    );
  });
});
const input =
  'https://www.flipkart.com/boat-airdopes-proclip-ows-earbuds-black/p/itmcontract?pid=CONTRACTTEST';
function contract() {
  // Controlled mutation of VERIFIED response fields. This is not the missing real
  // ProClip payload, and makes no claim about that product's price or actual SKU.
  const p = structuredClone(real).product_results;
  return {
    product_results: {
      ...p,
      title: 'boAt Airdopes ProClip OWS Earbuds Black',
      brand: 'boAt',
      specifications: { General: { 'Model Name': 'Airdopes ProClip', Color: 'Black' } },
      highlights: [],
      ratings_reviews: undefined,
    },
  };
}
describe('category-independent Flipkart field contract', () => {
  it('does not require perfume quantity, repeated brand or ratings for electronics', () => {
    const data = contract();
    expect(inspectFlipkartAPIProduct(JSON.stringify(data), input)).toMatchObject({
      brand: 'boAt',
      isOutOfStock: false,
      variant: 'colour=black',
      category: 'earbuds',
    });
    expect(parseFlipkartAPIProduct(JSON.stringify(data), input)).toMatchObject({
      category: 'earbuds',
      variant: 'colour=black',
    });
  });
  it('retains real perfume support without optional ratings', () => {
    const p = structuredClone(real);
    Reflect.deleteProperty(p.product_results, 'ratings_reviews');
    expect(
      inspectFlipkartAPIProduct(
        JSON.stringify(p),
        'https://www.flipkart.com/perfume/p/itmexample',
      ),
    ).toMatchObject({ variant: '30ml', isOutOfStock: false });
  });
  it('reports only field paths/codes without payload values', () => {
    const p = contract();
    p.product_results.availability = 'secret-provider-value';
    expect(() => inspectFlipkartAPIProduct(JSON.stringify(p), input)).toThrow(
      /product_results.availability:invalid_enum_value/,
    );
    try {
      inspectFlipkartAPIProduct(JSON.stringify(p), input);
    } catch (e) {
      expect(String(e)).not.toContain('secret-provider-value');
    }
  });
  it('still rejects missing stock, missing price, conflicting brand and selected variants', () => {
    for (const field of ['availability', 'price', 'sku']) {
      const p = contract();
      Reflect.deleteProperty(p.product_results, field);
      expect(() => inspectFlipkartAPIProduct(JSON.stringify(p), input)).toThrow();
    }
    const p = contract();
    p.product_results.specifications.General.Color = 'White';
    expect(() => inspectFlipkartAPIProduct(JSON.stringify(p), input)).toThrow(/conflict/);
  });
});

describe('safe missing evidence', () => {
  it('does not verify missing required evidence even when both titles omit it', () => {
    for (const title of [
      'boAt Airdopes ProClip Earbuds',
      'Pixel 9 Smartphone',
      'Acme Shirt',
      'Acme Rice',
      'LG AB123 Washing Machine',
    ])
      expect(isVerifiedProductMatch({ title }, { title })).toBe(false);
  });
});

describe('specification evidence survives selected-variant serialization', () => {
  it('rejects a different CPU or unknown RAM even with identical marketing titles', () => {
    const title = 'Dell XPS Laptop 16GB 512GB Silver';
    expect(
      isVerifiedProductMatch(
        { title, variant: 'cpu=i7; ram=16gb' },
        { title, variant: 'cpu=i7; ram=16gb' },
      ),
    ).toBe(true);
    expect(
      isVerifiedProductMatch(
        { title, variant: 'cpu=i7; ram=16gb' },
        { title, variant: 'cpu=i5; ram=16gb' },
      ),
    ).toBe(false);
    expect(
      isVerifiedProductMatch({ title, variant: 'cpu=i7; ram=16gb' }, { title }),
    ).toBe(false);
  });
  it('rejects wrong earbuds model and phone colour', () => {
    expect(
      isVerifiedProductMatch(
        { title: 'boAt ProClip OWS Earbuds Black' },
        { title: 'boAt ProClip Pro OWS Earbuds Black' },
      ),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(
        { title: 'Pixel 9 Smartphone 128GB Black' },
        { title: 'Pixel 9 Smartphone 128GB White' },
      ),
    ).toBe(false);
  });
});

describe('category flexibility never overrides conflicting global identifiers', () => {
  const base = {
    title: 'BLA BLI BLU Love Drunk Perfume 30ml',
    brand: 'BLA BLI BLU',
    variant: '30ml',
  };
  it.each(['gtin', 'mpn', 'model'] as const)('rejects conflicting %s', (key) => {
    expect(
      isVerifiedProductMatch({ ...base, [key]: 'FIRST' }, { ...base, [key]: 'OTHER' }),
    ).toBe(false);
  });
});

describe('final safety review regressions', () => {
  it('rejects contradictory selected volume even if both records repeat the same contradiction', () => {
    const bad = {
      title: 'BLA BLI BLU Love Drunk Perfume 30ml',
      brand: 'BLA BLI BLU',
      variant: '100ml',
    };
    expect(isVerifiedProductMatch(bad, bad)).toBe(false);
  });
  it('rejects explicit grocery quantity conflicts instead of ignoring non-ml amounts', () => {
    expect(() => selectedAttributes('Acme Rice 1kg', { Quantity: '2kg' })).toThrow(
      /conflict/,
    );
    expect(() => selectedAttributes('Acme Rice 1kg', { 'Net Quantity': '2kg' })).toThrow(
      /conflict/,
    );
  });
  it('rejects a response with the wrong colour for the requested descriptive URL', () => {
    const data = contract();
    data.product_results.title = data.product_results.title.replace('Black', 'White');
    data.product_results.specifications.General.Color = 'White';
    expect(() => parseFlipkartAPIProduct(JSON.stringify(data), input)).toThrow(
      /variant conflicts/,
    );
  });
});

describe('labelled RAM and storage retain their roles', () => {
  it.each([
    [
      'Pixel 9 Smartphone Black 8GB RAM 128GB ROM',
      'Pixel 9 Smartphone Black 128GB RAM 8GB ROM',
    ],
    [
      'Pixel 9 Smartphone Black RAM 8GB Storage 128GB',
      'Pixel 9 Smartphone Black RAM 128GB Storage 8GB',
    ],
  ])('rejects swapped RAM/storage despite identical token sets: %s', (a, b) => {
    expect(isVerifiedProductMatch({ title: a }, { title: a })).toBe(true);
    expect(isVerifiedProductMatch({ title: a }, { title: b })).toBe(false);
  });
});

describe('books require ISBN, edition and language evidence', () => {
  const title = 'Acme Algorithms Book 2nd Edition English ISBN 9780132350884';
  it('accepts an exact publication with complete evidence', () => {
    expect(isVerifiedProductMatch({ title }, { title })).toBe(true);
  });
  it.each([
    title.replace('9780132350884', '9780201633610'),
    title.replace('2nd', '1st'),
    title.replace('English', 'Hindi'),
    title.replace('ISBN 9780132350884', ''),
    title.replace('2nd Edition', ''),
    title.replace('English', ''),
    title.replace('9780132350884', '9780132350885'),
  ])('rejects wrong or missing publication evidence: %s', (other) => {
    expect(isVerifiedProductMatch({ title }, { title: other })).toBe(false);
    expect(isVerifiedProductMatch({ title: other }, { title: other })).toBe(
      !other.includes('0885') &&
        other.includes('ISBN') &&
        other.includes('Edition') &&
        /English|Hindi/.test(other),
    );
  });
  it('validates ISBN-10/X and maps its equivalent ISBN-13, without guessing missing edition/language', () => {
    expect(
      selectedAttributes('Acme Algorithms Book', {
        'ISBN-10': '0-13-235088-2',
        Edition: '2nd',
        Language: 'English',
      }),
    ).toMatchObject({ isbn: '9780132350884', edition: '2', language: 'english' });
    expect(() =>
      selectedAttributes('Acme Algorithms Book', { 'ISBN-13': '9780132350885' }),
    ).toThrow(/ISBN/);
  });
  it('rejects conflicting selected publication metadata', () => {
    expect(() => selectedAttributes(title, { 'ISBN-13': '9780201633610' })).toThrow(
      /conflict/,
    );
    expect(() => selectedAttributes(title, { Edition: '1st' })).toThrow(/conflict/);
    expect(() => selectedAttributes(title, { Language: 'Hindi' })).toThrow(/conflict/);
  });
  it('supports selected specification evidence through the existing variant field', () => {
    const book = {
      title: 'Acme Algorithms Book',
      variant: 'edition=2; isbn=9780132350884; language=english',
    };
    expect(isVerifiedProductMatch(book, book)).toBe(true);
    expect(
      isVerifiedProductMatch(book, {
        ...book,
        variant: book.variant.replace('english', 'hindi'),
      }),
    ).toBe(false);
  });
});

describe('book evidence must not change other product categories', () => {
  it('does not require ISBN for a performance edition mouse', () => {
    const p = { title: 'Logitech MX Master 3S Performance Edition Mouse' };
    expect(isVerifiedProductMatch(p, p)).toBe(true);
  });
  it('requires edition and language when ISBN is supplied as selected metadata', () => {
    const p = { title: 'Acme Algorithms', variant: 'isbn=9780132350884' };
    expect(isVerifiedProductMatch(p, p)).toBe(false);
  });
  it('rejects contradictory edition evidence', () => {
    const p = { title: 'Acme Book First Edition 2nd Edition English ISBN 9780132350884' };
    expect(isVerifiedProductMatch(p, p)).toBe(false);
  });
});

describe('unknown book metadata cannot substitute for evidence', () => {
  it.each([
    'edition=unknown; isbn=9780132350884; language=english',
    'edition=2; isbn=9780132350884; language=unknown',
  ])('rejects %s', (variant) => {
    const p = { title: 'Acme Algorithms Book', variant };
    expect(isVerifiedProductMatch(p, p)).toBe(false);
  });
});

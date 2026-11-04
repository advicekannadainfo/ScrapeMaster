import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  exactMatch,
  freshSavedPrice,
  mainEvidence,
  readExactEvidence,
  sufficientExactEvidence,
} from '@/lib/scraper/exact-evidence';
import { categoryProfiles } from '@/lib/scraper/matching';
import {
  selectedEvidencePolicies,
  selectedEvidenceStatus,
} from '@/lib/scraper/matching/selected-policy';
import { comparisonEvidenceState } from '@/lib/scraper/matching/reliability';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';
import myntra from './fixtures/myntra-product-real.json';

// Synthetic MAIN specification cases, not captured responses for these products.
const matrix = [
  {
    category: 'earbuds',
    title: 'Acme Clip 7 Earbuds Black',
    fields: { Color: 'Black', 'Number of Items': '1' },
    wrong: { Color: 'White' },
    missing: 'Color',
  },
  {
    category: 'phone',
    title: 'Acme Nova Smartphone Black',
    fields: { Color: 'Black', RAM: '8GB', Storage: '256GB', 'Number of Items': '1' },
    wrong: { RAM: '256GB', Storage: '8GB' },
    missing: 'Storage',
  },
  {
    category: 'laptop',
    title: 'Acme Nova Laptop Silver',
    fields: {
      Color: 'Silver',
      RAM: '16GB',
      Storage: '512GB',
      'Processor Name': 'i5-1235U',
      'Pack Size': '1',
    },
    wrong: { 'Processor Name': 'i7-1255U' },
    missing: 'Processor Name',
  },
  {
    category: 'fashion',
    title: 'Acme Classic Shirt Blue',
    fields: { Color: 'Blue', Size: 'M', 'Pack Size': '1' },
    wrong: { Size: 'L' },
    missing: 'Size',
  },
  {
    category: 'grocery',
    title: 'Acme Harvest Rice',
    fields: { 'Net Quantity': '1kg', 'Pack Size': '2' },
    wrong: { 'Pack Size': '1' },
    missing: 'Net Quantity',
  },
  {
    category: 'appliance',
    title: 'Acme Clean Washing Machine White',
    fields: { Capacity: '7kg', Color: 'White', 'Number of Items': '1' },
    wrong: { Capacity: '8kg' },
    missing: 'Capacity',
  },
] as const;
function product(title: string, fields: Record<string, unknown>, store = 'amazon') {
  const p = {
    title,
    brand: 'Acme',
    store,
    storeName: store,
    url:
      store === 'amazon'
        ? 'https://www.amazon.in/dp/B000000001'
        : 'https://www.flipkart.com/product/p/itmoffline?pid=OFFLINETEST',
    currentPrice: 200,
    currency: '₹',
    isOutOfStock: false,
    comparisonIdentityVerified: false,
  };
  return {
    ...p,
    exactEvidence: mainEvidence(
      p,
      {
        Brand: 'Acme',
        'Model Number': 'MODEL-7',
        ...fields,
      },
      store === 'amazon' ? 'product_information' : 'specifications.General',
    ),
  };
}
const bsonOptions = new mongoose.mongo.MongoClient('mongodb://127.0.0.1/offline')
  .bsonOptions;
const persisted = <T>(value: T): T =>
  mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize({ value }, bsonOptions))
    .value;

describe('cross-category offline matrix: synthetic independently selected facts', () => {
  it.each(matrix)('$category: positive, mismatch, missing and BSON-persisted', (row) => {
    const a = product(row.title, row.fields);
    const b = product(row.title.replace('Acme', 'Acme Genuine'), row.fields, 'flipkart');
    expect(sufficientExactEvidence(a.exactEvidence)).toBe(true);
    expect(exactMatch(a.exactEvidence, b.exactEvidence)).toBe('verified');
    expect(isVerifiedProductMatch(a, b)).toBe(true);
    expect(isVerifiedProductMatch(b, a)).toBe(true);
    expect(isVerifiedProductMatch(persisted(a), persisted(b))).toBe(true);
    const wrong = product(row.title, { ...row.fields, ...row.wrong }, 'flipkart');
    expect(exactMatch(a.exactEvidence, wrong.exactEvidence)).toBe('mismatch');
    expect(isVerifiedProductMatch(a, wrong)).toBe(false);
    const fields: Record<string, unknown> = { ...row.fields };
    delete fields[row.missing];
    const missing = product(row.title, fields, 'flipkart');
    expect(sufficientExactEvidence(missing.exactEvidence)).toBe(false);
    expect(isVerifiedProductMatch(a, missing)).toBe(false);
    expect(comparisonEvidenceState(missing).state).toBe('partial');
  });
  it('keeps book rules explicit but disabled pending grounded publication extraction', () => {
    expect(selectedEvidencePolicies.book.required).toEqual([
      'isbn',
      'edition',
      'language',
      'binding',
    ]);
    expect(
      selectedEvidenceStatus('book', {
        isbn: '9780132350884',
        edition: '2',
        language: 'english',
        binding: 'paperback',
      }),
    ).toBe('profile-not-enabled');
    expect(Object.keys(categoryProfiles)).toEqual(['perfume']);
    for (const title of [
      'Acme Book 2nd Edition English ISBN 9780132350884',
      'Acme Book 1st Edition Hindi ISBN 9780201633610',
      'Acme Book',
    ])
      expect(sufficientExactEvidence(product(title, {}).exactEvidence)).toBe(false);
  });
});

describe('shared main-field provenance and persistence safety', () => {
  it('collects a checksum-valid GTIN without inventing an MPN, and survives BSON', () => {
    const p = product(matrix[0].title, matrix[0].fields);
    const fields = {
      Brand: 'Acme',
      GTIN: '4006381333931',
      EAN: '4006381333931',
      ...matrix[0].fields,
    };
    const e = mainEvidence(p, fields, 'product_information')!;
    expect(e.gtin?.value).toBe('4006381333931');
    expect(Object.hasOwn(e, 'mpn')).toBe(false);
    expect(sufficientExactEvidence(persisted(e))).toBe(true);
    const legacy = persisted({ ...e, mpn: undefined });
    expect(legacy.mpn).toBeNull();
    expect(readExactEvidence(legacy)).toEqual(e);
    expect(legacy.mpn).toBeNull(); // read-only, no migration or mutation
  });
  it.each(['mpn', 'gtin'] as const)(
    'accepts unknown optional %s but never repairs malformed non-null data',
    (key) => {
      const e = product(matrix[0].title, matrix[0].fields).exactEvidence!;
      expect(readExactEvidence({ ...e, [key]: null })).toBeDefined();
      for (const value of ['', 3, [], {}, { value: 'PRIVATE', field: 'variants.Model' }])
        expect(readExactEvidence({ ...e, [key]: value })).toBeUndefined();
      expect(sufficientExactEvidence({ ...e, mpn: null, gtin: null })).toBe(false);
      expect(readExactEvidence({ ...e, selected: null })).toBeUndefined();
    },
  );
  it.each([
    { Color: 'Black', Colour: 'White' },
    { 'Model Number': 'MODEL-7', 'Manufacturer Part Number': 'OTHER-8' },
    { Processor: 'i5-1235U', 'Processor Name': 'i7-1255U' },
    { Quantity: '30ml', 'Net Quantity': '100ml' },
    { 'Pack Size': '1', 'Number of Items': '2' },
    { GTIN: '4006381333931', EAN: '5901234123457' },
    { Color: 'Black', Colour: ['Black', 'White'] },
  ])(
    'refuses contradictory/unsupported main aliases without affecting tracking: %j',
    (extra) => {
      const p = product(matrix[0].title, matrix[0].fields);
      expect(
        mainEvidence(p, { Brand: 'Acme', ...extra }, 'product_information'),
      ).toBeUndefined();
      expect(p.currentPrice).toBe(200);
    },
  );
  it('does not turn unknown stock or alternative catalogs into independent selected proof', () => {
    const p = product(matrix[0].title, matrix[0].fields);
    expect(
      mainEvidence(
        { ...p, isOutOfStock: undefined as unknown as boolean },
        { Brand: 'Acme' },
        'product_information',
      ),
    ).toBeUndefined();
    const e = mainEvidence(
      p,
      {
        Brand: 'Acme',
        'Model Number': 'MODEL-7',
        variants: [{ Color: 'Black', 'Number of Items': '1', price: 200 }],
      },
      'product_information',
    );
    expect(sufficientExactEvidence(e)).toBe(false);
  });
  it('finds a contradiction even after a missing selected fact, independent of key order', () => {
    const a = product(matrix[0].title, matrix[0].fields).exactEvidence!;
    const b = structuredClone(a);
    delete b.selected.colour;
    b.selected.pack!.value = '2';
    expect(exactMatch(a, b)).toBe('mismatch');
    expect(exactMatch(b, a)).toBe('mismatch');
  });
  it('rejects wrong-store URLs, record/category drift and stale/future/unknown-stock prices', () => {
    const a = product(matrix[0].title, matrix[0].fields);
    for (const url of [
      'https://example.com/dp/B000000001',
      'https://www.amazon.in/s?k=test',
      'https://user:password@www.amazon.in/dp/B000000001',
    ])
      expect(readExactEvidence({ ...a.exactEvidence, url })).toBeUndefined();
    expect(comparisonEvidenceState({ ...a, title: 'Acme Book' }).state).toBe(
      'binding-conflict',
    );
    expect(isVerifiedProductMatch({ ...a, title: 'Acme Book' }, a)).toBe(false);
    expect(freshSavedPrice(a)).toBe(true);
    for (const age of [600001, -60000]) {
      const e = {
        ...a.exactEvidence,
        observedAt: new Date(Date.now() - age).toISOString(),
      };
      expect(freshSavedPrice({ ...a, exactEvidence: e })).toBe(false);
    }
    expect(freshSavedPrice({ ...a, isOutOfStock: undefined })).toBe(false);
    const b = product(matrix[0].title, matrix[0].fields, 'flipkart');
    const stale = {
      ...b.exactEvidence!,
      observedAt: new Date(Date.now() - 600001).toISOString(),
    };
    expect(
      verifiedOffers(a, [
        { ...b, price: b.currentPrice, exactEvidence: stale, savedTrackedProduct: true },
      ]),
    ).toEqual([]);
    const missing = { ...a, exactEvidence: undefined };
    expect(comparisonEvidenceState(missing).state).toBe('missing');
    expect(comparisonEvidenceState({ ...a, exactEvidence: { version: 99 } }).state).toBe(
      'invalid',
    );
  });
});

describe('captured Product API fixtures: existing root tracking unchanged', () => {
  it('keeps Amazon/Flipkart 30ml and Myntra 100ml price/identity binding', () => {
    const a = parseAmazonAPIProduct(
      JSON.stringify(amazon),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    const f = parseFlipkartAPIProduct(
      JSON.stringify(flipkart),
      'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
    );
    const m = parseMyntraAPIProduct(
      JSON.stringify(myntra),
      'https://www.myntra.com/perfume/love-drunk/36340100/buy',
    );
    expect([
      a.variant,
      a.currentPrice,
      f.variant,
      f.currentPrice,
      m.variant,
      m.currentPrice,
    ]).toEqual(['30ml', 184, '30ml', 250, '100ml', 650]);
    expect(isVerifiedProductMatch(a, m)).toBe(false);
    expect(isVerifiedProductMatch(f, m)).toBe(false);
  });
  it('null Myntra selected quantity stays trackable but never gains selected proof', () => {
    const data = structuredClone(myntra);
    Object.assign(data.product_results.selectedSeller, { netQuantity: null });
    const p = parseMyntraAPIProduct(
      JSON.stringify(data),
      'https://www.myntra.com/perfume/love-drunk/36340100/buy',
    );
    expect(p.currentPrice).toBe(650);
    expect(p.variant).toBeUndefined();
    expect(comparisonEvidenceState(p).state).toBe('partial');
    expect(isVerifiedProductMatch(p, p)).toBe(false);
  });
});

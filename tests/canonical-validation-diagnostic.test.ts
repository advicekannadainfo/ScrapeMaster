import type { CanonicalIdentity } from '@/lib/scraper/matching/contracts';
import { describe, it, expect } from 'vitest';
import ProductModel from '@/lib/models/product.model';
import fixture from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import {
  readCanonicalIdentity,
  canonicalValidationFailures,
} from '@/lib/scraper/matching/fragrance';
import { productEvidenceSummary } from '@/lib/preview-product-evidence';
const url =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ';
function parsed() {
  return parseFlipkartAPIProduct(JSON.stringify(fixture), url);
}
function identity(): CanonicalIdentity {
  return structuredClone(readCanonicalIdentity(parsed().canonicalIdentity)!);
}
describe('safe canonical validation failures, no relaxed acceptance', () => {
  it('accepts valid producer JSON and its JSON serialization without any failure', () => {
    const value = identity();
    expect(canonicalValidationFailures(value)).toEqual([]);
    expect(readCanonicalIdentity(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
  it.each([
    [
      'version',
      (e: CanonicalIdentity): unknown => Object.assign(e, { version: 0 }),
      'schema.invalid_literal',
      'version',
    ],
    [
      'source store',
      (e: CanonicalIdentity): unknown =>
        Object.assign(e.source, { store: 'PRIVATE_STORE' }),
      'schema.invalid_enum_value',
      'source.store',
    ],
    [
      'URL binding',
      (e: CanonicalIdentity): unknown =>
        (e.source.url = 'https://private.example/PRIVATE'),
      'source-url-unbound',
      'source.url',
    ],
    [
      'brand normalization',
      (e: CanonicalIdentity): unknown => (e.brand.value = 'PRIVATE BRAND'),
      'brand-key-not-canonical',
      'brand.value',
    ],
    [
      'binding',
      (e: CanonicalIdentity): unknown => (e.source.binding = 'listing'),
      'product-binding-invalid',
      'source.binding',
    ],
    [
      'provenance',
      (e: CanonicalIdentity): unknown => (e.selected.volume!.field = 'PRIVATE_FIELD'),
      'product-fact-field-disallowed',
      'selected.volume.field',
    ],
    [
      'scope',
      (e: CanonicalIdentity): unknown => (e.selected.volume!.scope = 'main'),
      'volume-scope-invalid',
      'selected.volume.scope',
    ],
    [
      'volume',
      (e: CanonicalIdentity): unknown => (e.selected.volume!.value = 'PRIVATE_VALUE'),
      'volume-value-invalid',
      'selected.volume.value',
    ],
    [
      'missing selected',
      (e: CanonicalIdentity): unknown => Reflect.deleteProperty(e, 'selected'),
      'schema.invalid_type',
      'selected',
    ],
  ] as const)('reports %s without data values', (label, mutate, code, path) => {
    const value = identity();
    mutate(value);
    expect(readCanonicalIdentity(value)).toBeUndefined();
    expect(canonicalValidationFailures(value)).toContainEqual({ code, path });
    expect(JSON.stringify(canonicalValidationFailures(value))).not.toContain('PRIVATE');
  });
  it('bounds schema failures and hides invalid enum options, custom keys and actual values', () => {
    const value = {
      PRIVATE_KEY: 'PRIVATE_VALUE',
      source: { store: 'PRIVATE_STORE' },
      issues: Array.from({ length: 30 }, () => 'PRIVATE_ISSUE'),
    };
    const failures = canonicalValidationFailures(value);
    expect(failures.length).toBeLessThanOrEqual(8);
    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).not.toMatch(
      /PRIVATE|message|received|expected|options/,
    );
  });
  it('reports a reproduced Mongoose minimization incompatibility, without live DB writes', () => {
    const raw = structuredClone(fixture);
    Reflect.deleteProperty(raw.product_results.specifications.General, 'Quantity');
    Reflect.deleteProperty(raw.product_results.specifications.General, 'Net Quantity');
    Reflect.deleteProperty(raw.product_results.specifications, 'Product Highlights');
    raw.product_results.highlights = raw.product_results.highlights.filter(
      (s) => !s.startsWith('Quantity:'),
    );
    const product = parseFlipkartAPIProduct(JSON.stringify(raw), url);
    expect(readCanonicalIdentity(product.canonicalIdentity)?.issues).toContain(
      'volume-unconfirmed',
    );
    const doc = new ProductModel(product); // no connect/save/update/validate call
    const persisted = doc.toObject();
    expect(canonicalValidationFailures(persisted.canonicalIdentity)).toContainEqual({
      code: 'schema.invalid_type',
      path: 'selected',
    });
    expect(
      readCanonicalIdentity(doc.toObject({ minimize: false }).canonicalIdentity),
    ).toBeDefined();
    const summary = productEvidenceSummary(persisted);
    expect(summary).toMatchObject({
      canonicalIdentity: {
        state: 'invalid',
        issuesValidated: false,
        validationFailures: [{ code: 'schema.invalid_type', path: 'selected' }],
      },
      priceObservation: { present: true, boundAndFresh: false },
    });
  });
  it('does not reproduce the empty-object loss for independently selected canonical volume', () => {
    const product = new ProductModel(parsed()).toObject();
    expect(canonicalValidationFailures(product.canonicalIdentity)).toEqual([]);
  });
});

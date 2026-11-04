import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import mongoose from 'mongoose';
import ProductModel from '@/lib/models/product.model';
import { factSchema } from '@/lib/scraper/matching/contracts';
import {
  readCanonicalIdentity,
  independentFragrance,
  canonicalValidationFailures,
} from '@/lib/scraper/matching/fragrance';
import { identityKey, freshProfilePrice } from '@/lib/scraper/matching/observations';
import { productEvidenceSummary } from '@/lib/preview-product-evidence';
import { isVerifiedProductMatch } from '@/lib/verified-offers';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
import fixture from './fixtures/flipkart-product-real.json';
const url =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ';
const parsed = () => parseFlipkartAPIProduct(JSON.stringify(fixture), url);
const identity = () =>
  structuredClone(readCanonicalIdentity(parsed().canonicalIdentity)!);
const slots = ['concentration', 'formulation', 'edition'] as const;
// Constructor/BSON operations only; never connect, save, refresh or provider calls.
const bsonOptions = new mongoose.mongo.MongoClient('mongodb://127.0.0.1/offline')
  .bsonOptions;
const roundTrip = (value: unknown) =>
  mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize({ value }, bsonOptions))
    .value;
describe('canonical optional facts across persistence boundaries', () => {
  it('reproduces the three reported failure paths under actual default driver BSON options', () => {
    const legacy = identity();
    for (const slot of slots) Object.assign(legacy.selected, { [slot]: undefined });
    expect(bsonOptions.ignoreUndefined).toBe(false);
    const persisted = roundTrip(legacy);
    for (const slot of slots) expect(persisted.selected[slot]).toBeNull();
    const oldSchema = z.object({
      concentration: factSchema.optional(),
      formulation: factSchema.optional(),
      edition: factSchema.optional(),
    });
    const result = oldSchema.safeParse(persisted.selected);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') })),
      ).toEqual(slots.map((slot) => ({ code: 'invalid_type', path: slot })));
    // This is a reproduced legacy serialization path, NOT a capture of Old Money.
    const normalized = readCanonicalIdentity(persisted)!;
    expect(normalized).toBeDefined();
    for (const slot of slots)
      expect(Object.hasOwn(normalized.selected, slot)).toBe(false);
    for (const slot of slots) expect(persisted.selected[slot]).toBeNull(); // read-only normalization
  });
  it('new producer facts omit unknown slots and remain stable through JSON, driver BSON and Mongoose serialization', () => {
    const current = identity();
    for (const slot of slots) expect(Object.hasOwn(current.selected, slot)).toBe(false);
    expect(readCanonicalIdentity(roundTrip(current))).toEqual(current);
    expect(readCanonicalIdentity(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(
      readCanonicalIdentity(new ProductModel(parsed()).toObject().canonicalIdentity),
    ).toEqual(current);
  });
  it('legacy null descriptors remain unknown, without renewing price observations', () => {
    const record = parsed(),
      original = identity();
    const observed = record.priceObservation;
    const legacy = structuredClone(original);
    for (const slot of slots) Object.assign(legacy.selected, { [slot]: null });
    expect(identityKey(readCanonicalIdentity(legacy)!)).toBe(identityKey(original));
    const before = JSON.stringify(observed);
    expect(freshProfilePrice({ ...record, canonicalIdentity: legacy })).toBe(true);
    expect(JSON.stringify(observed)).toBe(before);
    const summary = productEvidenceSummary({ ...record, canonicalIdentity: legacy });
    expect(summary.canonicalIdentity).toMatchObject({
      state: 'valid',
      optionalAttributeTypes: {
        concentration: 'null',
        formulation: 'null',
        edition: 'null',
      },
    });
    const stale = {
      ...(observed as object),
      observedAt: new Date(Date.now() - 600001).toISOString(),
    };
    expect(
      freshProfilePrice({
        ...record,
        canonicalIdentity: legacy,
        priceObservation: stale,
      }),
    ).toBe(false);
  });
  it.each(slots)(
    'preserves valid %s facts and rejects malformed non-null values',
    (slot) => {
      const valid = identity();
      valid.selected[slot] = {
        value:
          slot === 'concentration'
            ? 'edp'
            : slot === 'formulation'
              ? 'perfume-oil'
              : 'intense',
        field: 'main.title',
        scope: 'main',
      };
      expect(readCanonicalIdentity(valid)?.selected[slot]).toEqual(valid.selected[slot]);
      for (const value of [
        '',
        0,
        false,
        [],
        {},
        { value: 'edp' },
        { value: 'edp', field: 'PRIVATE_FIELD', scope: 'main' },
      ]) {
        const bad = identity();
        Object.assign(bad.selected, { [slot]: value });
        expect(readCanonicalIdentity(bad)).toBeUndefined();
        expect(canonicalValidationFailures(bad).length).toBeGreaterThan(0);
      }
    },
  );
  it('does not default missing selected objects or turn null volume/line into independent proof', () => {
    const absent = identity();
    Reflect.deleteProperty(absent, 'selected');
    expect(readCanonicalIdentity(absent)).toBeUndefined();
    for (const key of ['volume', 'line']) {
      const missing = identity();
      if (key === 'line') Object.assign(missing, { line: null });
      else Object.assign(missing.selected, { volume: null });
      expect(readCanonicalIdentity(missing)).toBeDefined();
      expect(independentFragrance(missing)).toBe(false);
      expect(
        isVerifiedProductMatch({ ...parsed(), canonicalIdentity: missing }, parsed()),
      ).toBe(false);
    }
  });
  it('preserves incomplete selected:{} through future document serialization without certifying it', () => {
    const incomplete = identity();
    incomplete.selected = {};
    incomplete.issues = ['volume-unconfirmed'];
    const doc = new ProductModel({ ...parsed(), canonicalIdentity: incomplete });
    const saved = doc.toObject().canonicalIdentity;
    expect(Object.hasOwn(saved, 'selected')).toBe(true);
    expect(readCanonicalIdentity(roundTrip(saved))).toBeDefined();
    expect(independentFragrance(saved)).toBe(false);
  });
  it('null descriptors cannot override EDP/EDT, formulation, scent, volume or pack contradictions', () => {
    const a = identity(),
      b = identity();
    a.selected.concentration = { value: 'edp', field: 'main.title', scope: 'main' };
    b.selected.concentration = { value: 'edt', field: 'main.title', scope: 'main' };
    const left = { ...parsed(), canonicalIdentity: a },
      right = { ...parsed(), canonicalIdentity: b };
    expect(isVerifiedProductMatch(left, right)).toBe(false);
    Object.assign(b.selected, { concentration: null, formulation: null, edition: null });
    expect(isVerifiedProductMatch(left, right)).toBe(false); // unknown is not EDP
    const unknown = identity();
    for (const slot of slots) Object.assign(unknown.selected, { [slot]: null });
    for (const mutate of [
      (e: ReturnType<typeof identity>) => {
        e.selected.volume!.value = '100ml';
      },
      (e: ReturnType<typeof identity>) => {
        e.line!.value = 'old money';
      },
      (e: ReturnType<typeof identity>) => {
        e.selected.formulation = {
          value: 'body-mist',
          field: 'main.title',
          scope: 'main',
        };
      },
      (e: ReturnType<typeof identity>) => {
        e.selected.pack = { value: '2', field: 'main.title', scope: 'selected' };
      },
    ]) {
      const wrong = identity();
      mutate(wrong);
      expect(
        isVerifiedProductMatch(
          { ...parsed(), canonicalIdentity: unknown },
          { ...parsed(), canonicalIdentity: wrong },
        ),
      ).toBe(false);
    }
  });
  it('reports structural types for still-invalid scalar facts without raw values', () => {
    const value = identity();
    Object.assign(value.selected, { concentration: 'PRIVATE_DATA' });
    expect(canonicalValidationFailures(value)).toContainEqual({
      code: 'schema.invalid_type',
      path: 'selected.concentration',
      observedType: 'string',
    });
    expect(
      JSON.stringify(productEvidenceSummary({ canonicalIdentity: value })),
    ).not.toContain('PRIVATE_DATA');
  });
});

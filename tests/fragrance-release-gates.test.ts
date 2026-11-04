import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  mainFragranceIdentity,
  readCanonicalIdentity,
  independentFragrance,
  fragranceDecision,
  fragranceProfile,
  canonicalValidationFailures,
} from '@/lib/scraper/matching/fragrance';
import { enrichSearchFragranceIdentity } from '@/lib/scraper/product-candidate-match';
import {
  observeProduct,
  freshProfilePrice,
  validAssociations,
} from '@/lib/scraper/matching/observations';
import { verifiedOffers } from '@/lib/verified-offers';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';
import myntra from './fixtures/myntra-product-real.json';

// Synthetic MAIN selected facts, not captured API responses. No provider/DB calls.
function record(
  store = 'amazon',
  name = 'Quiet Garden',
  volume: number | null = 30,
  suffix = '',
) {
  const title = `Acme ${name} Perfume ${volume ?? 30}ml ${suffix}`.trim();
  const url =
    store === 'amazon'
      ? 'https://www.amazon.in/dp/B0TEST0001'
      : store === 'flipkart'
        ? 'https://www.flipkart.com/acme-perfume/p/itmoffline?pid=OFFLINETEST'
        : 'https://www.myntra.com/perfume/acme/12345678/buy';
  const canonicalIdentity = mainFragranceIdentity({
    title,
    brand: 'Acme',
    store,
    url,
    selectedVolume: volume ?? undefined,
    volumeField:
      store === 'amazon'
        ? 'product_information.Item Volume'
        : store === 'flipkart'
          ? 'specifications.General.Quantity'
          : 'selectedSeller.netQuantity',
  });
  return {
    title,
    brand: 'Acme',
    variant: volume ? `${volume}ml` : undefined,
    store,
    storeName: store,
    url,
    currency: '₹',
    currentPrice: 200,
    isOutOfStock: false,
    canonicalIdentity,
    priceObservation: observeProduct(canonicalIdentity, 200, '₹', false),
  };
}
const identity = () => readCanonicalIdentity(record().canonicalIdentity)!;
describe('fragrance release gates: Product evidence cannot become title-only Search proof', () => {
  it('preserves captured affirmative oil/pack evidence during enrichment, rejecting an unconfirmed counterpart', () => {
    const a = parseAmazonAPIProduct(
      JSON.stringify(amazon),
      'https://www.amazon.in/dp/B0FYGRL51R',
    );
    const f = parseFlipkartAPIProduct(
      JSON.stringify(flipkart),
      'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
    );
    const candidate = { ...a, price: a.currentPrice };
    const enriched = enrichSearchFragranceIdentity(f, candidate);
    expect(enriched.canonicalIdentity).toBe(a.canonicalIdentity);
    expect(
      readCanonicalIdentity(enriched.canonicalIdentity)?.selected.formulation?.value,
    ).toBe('perfume-oil');
    expect(verifiedOffers(f, [enriched])).toEqual([]);
  });
  it('does not rescue missing selected volume, invalid provenance or malformed persisted evidence from a title', () => {
    const source = record('flipkart');
    for (const evidence of [
      record('amazon', 'Quiet Garden', null).canonicalIdentity,
      { ...identity(), source: { ...identity().source, binding: 'listing' } },
      { version: 99 },
    ]) {
      const candidate = { ...record(), canonicalIdentity: evidence, price: 200 };
      expect(enrichSearchFragranceIdentity(source, candidate)).toBe(candidate);
      expect(verifiedOffers(source, [candidate])).toEqual([]);
    }
  });
});
describe('persisted descriptor provenance and contradictory facts', () => {
  it.each([
    ['concentration', 'edp', 'product_information.Item Volume'],
    ['formulation', 'perfume-oil', 'product_information.Brand'],
    ['edition', 'intense', 'product_information.Number of Items'],
  ] as const)('rejects misplaced %s provenance', (slot, value, field) => {
    const e = identity();
    e.selected[slot] = { value, field, scope: 'main' };
    expect(readCanonicalIdentity(e)).toBeUndefined();
    expect(canonicalValidationFailures(e)).toContainEqual({
      code: 'descriptor-field-invalid',
      path: `selected.${slot}.field`,
    });
  });
  it.each([
    ['concentration', 'unknown'],
    ['concentration', 'edp/edt'],
    ['formulation', 'liquid'],
    ['edition', 'unknown'],
  ] as const)('rejects unsupported persisted %s=%s', (slot, value) => {
    const e = identity();
    e.selected[slot] = { value, field: 'main.title', scope: 'main' };
    expect(readCanonicalIdentity(e)).toBeUndefined();
  });
  it('keeps optional null unknown, valid descriptors valid, and Product scope strict', () => {
    const e = identity();
    Object.assign(e.selected, { concentration: null, formulation: null, edition: null });
    expect(readCanonicalIdentity(e)).toBeDefined();
    const declared = record('amazon', 'Quiet Garden', 30, 'EDP Intense');
    expect(independentFragrance(declared.canonicalIdentity)).toBe(true);
    const bad = identity();
    bad.selected.concentration = { value: 'edp', field: 'main.title', scope: 'selected' };
    expect(readCanonicalIdentity(bad)).toBeUndefined();
  });
  it('reports explicit formulation conflict despite an earlier one-sided concentration declaration', () => {
    const a = identity(),
      b = identity();
    a.selected.concentration = { value: 'edp', field: 'main.title', scope: 'main' };
    a.selected.formulation = { value: 'perfume-oil', field: 'main.title', scope: 'main' };
    b.selected.formulation = { value: 'body-mist', field: 'main.title', scope: 'main' };
    expect(fragranceProfile.compare(a, b)).toMatchObject({
      status: 'mismatch',
      reason: 'formulation-conflict',
    });
    expect(fragranceProfile.compare(b, a).status).toBe('mismatch');
  });
});
describe('selected variant, persisted records and price release gates (synthetic)', () => {
  it.each(['Quiet Garden', 'Cedar Trail', 'Love Drunk', 'Old Money'])(
    'verifies independently selected %s across stores, not just marketing names',
    (name) => {
      const a = record('amazon', name),
        f = record('flipkart', name),
        m = record('myntra.com', name);
      for (const [left, right] of [
        [a, f],
        [f, m],
        [m, a],
        [f, a],
        [m, f],
        [a, m],
      ]) {
        expect(fragranceDecision(left, right).status).toBe('verified');
        expect(verifiedOffers(left, [{ ...right, price: 200 }])).toHaveLength(1);
      }
    },
  );
  it.each([
    'EDT',
    'body mist',
    'perfume oil',
    'pack of 2',
    'tester',
    'refill',
    'gift set',
    'bundle',
  ])('does not certify an incompatible or unproven %s', (variant) => {
    const source = record('amazon', 'Quiet Garden', 30, 'EDP');
    expect(
      verifiedOffers(source, [
        { ...record('flipkart', 'Quiet Garden', 30, variant), price: 200 },
      ]),
    ).toEqual([]);
  });
  it.each([20, 100])('rejects %sml against independently selected 30ml', (volume) => {
    expect(
      fragranceDecision(record(), record('flipkart', 'Quiet Garden', volume)).status,
    ).toBe('mismatch');
  });
  it('keeps identity through BSON but never renews stale or unbound saved prices', () => {
    const a = record(),
      b = record('flipkart');
    const saved = mongoose.mongo.BSON.deserialize(
      mongoose.mongo.BSON.serialize({ value: b }, { ignoreUndefined: false }),
    ).value;
    expect(fragranceDecision(a, saved).status).toBe('verified');
    expect(freshProfilePrice(saved)).toBe(true);
    const links = validAssociations(a, [
      {
        profile: 'fragrance-v1',
        store: b.store,
        url: b.url,
        identity: b.canonicalIdentity,
      },
    ]);
    saved.priceObservation.observedAt = new Date(Date.now() - 600001).toISOString();
    expect(
      verifiedOffers(a, [{ ...saved, price: 200, savedTrackedProduct: true }]),
    ).toEqual([]);
    expect(validAssociations(a, links)).toHaveLength(1);
  });
  it('keeps captured Myntra null seller quantity tracking-only, regardless of title/catalog quantities', () => {
    const body = structuredClone(myntra);
    Object.assign(body.product_results.selectedSeller, { netQuantity: null });
    const p = parseMyntraAPIProduct(
      JSON.stringify(body),
      'https://www.myntra.com/perfume/love-drunk/36340100/buy',
    );
    expect(p.currentPrice).toBe(650);
    expect(independentFragrance(p.canonicalIdentity)).toBe(false);
    expect(readCanonicalIdentity(p.canonicalIdentity)?.selected.volume).toBeUndefined();
  });
  it('never creates an in-stock observation from unknown stock', () => {
    expect(
      observeProduct(identity(), 200, '₹', undefined as unknown as boolean),
    ).toBeNull();
  });
  it.each(['stock', 'price', 'url', 'identity', 'currency', 'future', 'malformed'])(
    'rejects an explicitly conflicting %s Product price observation without a saved flag',
    (change) => {
      const a = record(),
        b = record('myntra.com');
      const observation = { ...b.priceObservation! };
      if (change === 'stock') observation.inStock = false;
      if (change === 'price') observation.price = 201;
      if (change === 'url') observation.url = a.url;
      if (change === 'identity') observation.identityKey = 'wrong-identity';
      if (change === 'currency') Object.assign(observation, { currency: '$' });
      if (change === 'future')
        observation.observedAt = new Date(Date.now() + 60000).toISOString();
      expect(
        verifiedOffers(a, [
          {
            ...b,
            price: 200,
            priceObservation: change === 'malformed' ? { version: 99 } : observation,
          },
        ]),
      ).toEqual([]);
      expect(verifiedOffers(b, [{ ...b, price: 200 }])).toHaveLength(1); // own tracking stays visible
    },
  );
  it('checks selling price and currency separately from identity', () => {
    const a = record(),
      b = record('flipkart');
    expect(fragranceDecision(a, b).status).toBe('verified');
    for (const price of [0, -1, Number.NaN, 1000])
      expect(verifiedOffers(a, [{ ...b, price }])).toEqual([]);
    expect(verifiedOffers(a, [{ ...b, price: 200, currency: '$' }])).toEqual([]);
  });
});

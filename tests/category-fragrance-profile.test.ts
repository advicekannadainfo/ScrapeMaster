import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/lib/models/product.model', () => ({ default: { find: mocks.find } }));
import { fragranceContext } from '@/lib/scraper/matching/context';
import {
  mainFragranceIdentity,
  fragranceDecision,
  independentFragrance,
  readCanonicalIdentity,
  searchFragranceIdentity,
} from '@/lib/scraper/matching/fragrance';
import { categoryProfiles, categoryDecision } from '@/lib/scraper/matching';
import { futureProfileRequirements } from '@/lib/scraper/matching/contracts';
import {
  observeProduct,
  freshProfilePrice,
  validAssociations,
} from '@/lib/scraper/matching/observations';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
import { savedProductOffers } from '@/lib/services/saved-product-offers';
import { parseMyntraAPIProduct } from '@/lib/scraper/stores/myntra';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';
import myntra from './fixtures/myntra-product-real.json';
const titles = {
  amazon:
    'BLABLIBLU Love Drunk Unisex Perfume for Men & Women|30ml Long-Lasting Parfum Fragrances - A Notch above EDP, EDT & EDC|Perfume For Man & Perfume for Woman |Cinnamon, Dates & Nuts Notes|',
  flipkart:
    'BLA BLI BLU Love Drunk Perfume for Men & Women|Cinnamon & Date Notes Long Lasting Perfume - 30 ml (For Men & Women)',
  'myntra.com': 'BLA BLI BLU Love Drunk Long Lasting Perfume - 30ml',
};
const urls = {
  amazon: 'https://www.amazon.in/dp/B0FYGRL51R',
  flipkart:
    'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
  'myntra.com': 'https://www.myntra.com/perfume/bla-bli-blu/38312143/buy',
};
type Store = keyof typeof titles;
function record(
  store: Store = 'myntra.com',
  title = titles[store],
  volume: number | null = 30,
) {
  // Synthetic MAIN-product facts under supported field contracts, not live API captures.
  const canonicalIdentity = mainFragranceIdentity({
    title,
    brand: 'BLA BLI BLU',
    store,
    url: urls[store],
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
    brand: 'BLA BLI BLU',
    variant: volume ? `${volume}ml` : undefined,
    comparisonIdentityVerified: volume !== null,
    store,
    storeName: store,
    url: urls[store],
    currentPrice: 200,
    currency: '₹',
    isOutOfStock: false,
    canonicalIdentity,
    priceObservation: observeProduct(canonicalIdentity, 200, '₹', false),
  };
}
beforeEach(() => {
  mocks.find.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('contextual affirmation, comparison, alternatives and negation', () => {
  it('does not assert EDP/EDT/EDC from the exact comparative marketing phrase', () => {
    const context = fragranceContext(titles.amazon);
    expect(context.concentrations).toEqual([]);
    expect(context.contradictions).toBe(false);
    expect(context.excluded).toBe(3);
    expect(
      fragranceContext('Love Drunk EDP Perfume - better than EDT').concentrations,
    ).toEqual(['edp']);
  });
  it.each(['EDP and EDT', 'EDP or EDT', 'EDP / EDT', 'EDP vs EDT'])(
    'cannot certify selected %s',
    (declaration) => {
      const a = record(),
        b = record('amazon', `BLABLIBLU Love Drunk ${declaration} Perfume 30ml`);
      expect(isVerifiedProductMatch(a, b)).toBe(false);
    },
  );
  it('keeps affirmative conflicts and negative constraints', () => {
    const a = record('myntra.com', 'BLA BLI BLU Love Drunk EDP Perfume 30ml');
    expect(
      isVerifiedProductMatch(
        a,
        record('amazon', 'BLABLIBLU Love Drunk EDT Perfume 30ml'),
      ),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(
        a,
        record('amazon', 'BLABLIBLU Love Drunk Perfume 30ml not EDP'),
      ),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(
        a,
        record('amazon', 'BLABLIBLU Love Drunk Eau de Parfum Perfume 30ml not EDT'),
      ),
    ).toBe(true);
  });
});
describe('fragrance-v1 is shared by discovery, identity and persisted display', () => {
  it('matches all exact user-provided titles symmetrically with independently selected 30ml, without a guessed concentration', () => {
    for (const a of Object.keys(titles) as Store[])
      for (const b of Object.keys(titles) as Store[]) {
        const x = record(a),
          y = record(b);
        expect(fragranceDecision(x, y).status).toBe('verified');
        expect(isVerifiedProductMatch(x, y)).toBe(true);
        expect(
          readCanonicalIdentity(x.canonicalIdentity)?.selected.concentration,
        ).toBeUndefined();
      }
  });
  it.each([
    ['BLABLIBLU Love Drunk Perfume 100ml', 100],
    ['BLABLIBLU Love Drunk Perfume 20ml', 20],
    ['BLABLIBLU Other Scent Perfume 30ml', 30],
    ['BLABLIBLU Love Drunk Intense Perfume 30ml', 30],
    ['BLABLIBLU Love Drunk Perfume Intense 30ml', 30],
    ['BLABLIBLU Love Drunk Perfume Elixir 30ml', 30],
    ['BLABLIBLU Love Drunk Perfume Refill 30ml', 30],
    ['BLABLIBLU Love Drunk Body Mist 30ml', 30],
    ['BLABLIBLU Love Drunk Attar Perfume 30ml', 30],
    ['BLABLIBLU Love Drunk Perfume 30ml pack of 2', 30],
    ['BLABLIBLU Cinnamon Dates Notes Perfume 30ml', 30],
  ] as [string, number][])('rejects incompatible %s', (title, volume) => {
    expect(isVerifiedProductMatch(record(), record('amazon', title, volume))).toBe(false);
  });
  it('does not promote unknown selected volume, a title-only link, or a listing into independent Product identity', () => {
    const a = record(),
      b = record('amazon', titles.amazon, null);
    expect(independentFragrance(b.canonicalIdentity)).toBe(false);
    expect(isVerifiedProductMatch(a, b)).toBe(false);
    const listing = searchFragranceIdentity(
      { ...a, store: 'amazon', url: urls.amazon, title: titles.amazon },
      a.brand,
    );
    expect(independentFragrance(listing)).toBe(false);
    expect(independentFragrance({ ...a, canonicalIdentity: null })).toBe(false);
  });
  it('rejects forged provenance and record/source drift', () => {
    const a = record(),
      b = record('amazon');
    const e = structuredClone(readCanonicalIdentity(b.canonicalIdentity)!);
    e.selected.volume!.field = 'variants.volume';
    expect(readCanonicalIdentity(e)).toBeUndefined();
    expect(isVerifiedProductMatch(a, { ...b, canonicalIdentity: e })).toBe(false);
    expect(isVerifiedProductMatch(a, { ...b, url: urls.flipkart })).toBe(false);
    expect(isVerifiedProductMatch(a, { ...b, brand: 'Another Brand' })).toBe(false);
    expect(
      isVerifiedProductMatch(a, {
        ...b,
        brand: undefined,
        title: 'Other Brand Love Drunk Perfume 30ml',
      }),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(a, { ...b, title: 'BLABLIBLU Other Scent Perfume 30ml' }),
    ).toBe(false);
    expect(
      isVerifiedProductMatch(a, { ...b, title: b.title.replace('30ml', '100ml') }),
    ).toBe(false);
  });
});
describe('identity association survives stale price, without promoting that price', () => {
  function results(records: ReturnType<typeof record>[]) {
    mocks.find.mockReturnValue({
      select: () => ({ sort: () => ({ limit: () => ({ lean: async () => records }) }) }),
    });
  }
  it('reuses fresh independently validated records locally; no MPN/GTIN or repeat scraping required', async () => {
    const a = record(),
      b = record('amazon');
    results([b]);
    let links: unknown;
    const offers = await savedProductOffers(a, (value) => {
      links = value;
    });
    expect(offers).toHaveLength(1);
    expect(verifiedOffers(a, offers)).toEqual(offers);
    expect(validAssociations(a, links)).toHaveLength(1);
    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.find.mock.calls[0][0]).not.toHaveProperty('priceObservation.observedAt');
  });
  it('retains an independently verified identity link with no stale price or observation-time reset', async () => {
    const a = record(),
      b = record('amazon');
    b.priceObservation!.observedAt = new Date(Date.now() - 600001).toISOString();
    results([b]);
    let links: unknown;
    expect(
      await savedProductOffers(a, (value) => {
        links = value;
      }),
    ).toEqual([]);
    expect(validAssociations(a, links)).toHaveLength(1);
    expect(JSON.stringify(links)).not.toMatch(/price|observedAt/);
    expect(freshProfilePrice(b)).toBe(false);
    expect(
      freshProfilePrice({
        ...b,
        priceObservation: {
          ...b.priceObservation,
          observedAt: new Date(Date.now() + 60000).toISOString(),
        },
      }),
    ).toBe(false);
  });
  it('never reuses changed price, unknown stock or a stale source, even with a valid identity association', async () => {
    const a = record(),
      b = record('amazon');
    for (const changed of [
      { ...b, currentPrice: 201 },
      { ...b, isOutOfStock: true },
      { ...b, isOutOfStock: undefined },
    ]) {
      expect(freshProfilePrice(changed)).toBe(false);
    }
    a.priceObservation!.observedAt = new Date(Date.now() - 600001).toISOString();
    results([b]);
    let links: unknown;
    expect(
      await savedProductOffers(a, (value) => {
        links = value;
      }),
    ).toEqual([]);
    expect(validAssociations(a, links)).toHaveLength(1);
  });
  it('rechecks existing associations against current candidate identity rather than trusting saved URL mappings', async () => {
    const a = record(),
      b = record('amazon');
    results([b]);
    let links: unknown;
    await savedProductOffers(a, (value) => {
      links = value;
    });
    const changed = record('amazon', 'BLABLIBLU Love Drunk Perfume 100ml', 100);
    results([changed]);
    expect(
      await savedProductOffers({ ...a, productLinks: links }, (value) => {
        links = value;
      }),
    ).toEqual([]);
    expect(links).toEqual([]);
  });
});
describe('grounded Product adapter hooks, not tracking/parser relaxations', () => {
  it('captures real Amazon selected-volume provenance but does not hide its genuine main-spec formulation declaration', () => {
    const p = parseAmazonAPIProduct(JSON.stringify(amazon), urls.amazon);
    const e = readCanonicalIdentity(p.canonicalIdentity)!;
    expect(e.selected.volume).toMatchObject({
      value: '30ml',
      field: 'product_information.Item Volume',
      scope: 'selected',
    });
    expect(e.selected.formulation?.value).toBe('perfume-oil');
    expect(isVerifiedProductMatch(p, record())).toBe(false); // counterpart lacks independent oil confirmation
  });
  it('preserves main-product pack evidence and never matches an unconfirmed or different count', () => {
    const p = structuredClone(amazon);
    p.product_information['Number of Items'] = '2';
    const tracked = parseAmazonAPIProduct(JSON.stringify(p), urls.amazon);
    expect(readCanonicalIdentity(tracked.canonicalIdentity)?.selected.pack?.value).toBe(
      '2',
    );
    expect(isVerifiedProductMatch(tracked, record())).toBe(false);
    const other = structuredClone(readCanonicalIdentity(tracked.canonicalIdentity)!);
    other.selected.pack!.value = '1';
    expect(
      fragranceDecision(tracked, { ...tracked, canonicalIdentity: other }).status,
    ).toBe('mismatch');
  });
  it('captures real Flipkart selected 30ml, not the alternative catalog or request PID', () => {
    const p = parseFlipkartAPIProduct(JSON.stringify(flipkart), urls.flipkart);
    expect(independentFragrance(p.canonicalIdentity)).toBe(true);
    expect(readCanonicalIdentity(p.canonicalIdentity)?.selected.volume?.field).toBe(
      'specifications.General.Quantity',
    );
  });
  it('keeps real Myntra netQuantity null tracking-only and never borrows per-unit or other-SKU quantities', () => {
    const fixture = structuredClone(myntra);
    Object.assign(fixture.product_results.selectedSeller, { netQuantity: null });
    const p = parseMyntraAPIProduct(
      JSON.stringify(fixture),
      'https://www.myntra.com/perfume/love-drunk/36340100/buy',
    );
    expect(p.comparisonIdentityVerified).toBe(false);
    expect(independentFragrance(p.canonicalIdentity)).toBe(false);
    expect(p.currentPrice).toBe(650);
    expect(readCanonicalIdentity(p.canonicalIdentity)?.selected.volume).toBeUndefined();
  });
});
describe('new category interface remains scoped', () => {
  it('registers only fragrance and documents required electronics/fashion/books selected evidence', () => {
    expect(Object.keys(categoryProfiles)).toEqual(['perfume']);
    expect(futureProfileRequirements.electronics).toContain('selected-storage');
    expect(futureProfileRequirements.fashion).toContain('selected-size');
    expect(futureProfileRequirements.books).toContain('checksum-valid-isbn');
    expect(
      categoryDecision(
        { title: 'boAt ProClip Earbuds' },
        { title: 'boAt ProClip Earbuds' },
      ),
    ).toBeUndefined();
    expect(
      categoryDecision(
        { title: 'Cotton Shirt Blue Size M' },
        { title: 'Cotton Shirt Blue Size L' },
      ),
    ).toBeUndefined();
    expect(
      categoryDecision(
        { title: 'Book ISBN 9780140449136' },
        { title: 'Book ISBN 9780140449136' },
      ),
    ).toBeUndefined();
  });
});

describe('designed categories continue through the existing strict engine', () => {
  it.each([
    ['Acme Clip7 OWS Earbuds Black', 'Acme Clip7 OWS Earbuds White'],
    [
      'Acme Phone X1 Black 8GB RAM 128GB Storage',
      'Acme Phone X1 Black 128GB RAM 8GB Storage',
    ],
    ['Acme Oxford Shirt Blue Size M', 'Acme Oxford Shirt Blue Size L'],
    [
      'Book ISBN 9780140449136 Edition 1 English',
      'Book ISBN 9780140449136 Edition 2 English',
    ],
    [
      'Book ISBN 9780140449136 Edition 1 English',
      'Book ISBN 9780140449136 Edition 1 Hindi',
    ],
  ])('preserves exact versus variant distinction: %s', (title, wrong) => {
    expect(categoryDecision({ title }, { title })).toBeUndefined();
    expect(isVerifiedProductMatch({ title }, { title })).toBe(true);
    expect(isVerifiedProductMatch({ title }, { title: wrong })).toBe(false);
  });
});

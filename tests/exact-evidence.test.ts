import { describe, it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/lib/models/product.model', () => ({ default: { find: mocks.find } }));
import {
  exactMatch,
  freshSavedPrice,
  sufficientExactEvidence,
  mainEvidence,
  type ExactEvidence,
} from '@/lib/scraper/exact-evidence';
import { savedProductOffers } from '@/lib/services/saved-product-offers';
import { isVerifiedProductMatch, verifiedOffers } from '@/lib/verified-offers';
function evidence(store = 'flipkart', colour = 'black') {
  const prefix = store === 'amazon' ? 'product_information.' : 'specifications.General.';
  return {
    version: 1,
    store,
    url:
      store === 'amazon'
        ? 'https://www.amazon.in/dp/B000000001'
        : 'https://www.flipkart.com/item/p/itm1?pid=PID1',
    observedAt: new Date().toISOString(),
    price: 200,
    currency: '₹',
    inStock: true,
    category: 'earbuds',
    brand: { value: 'Acme', field: prefix + 'Brand' },
    mpn: { value: 'CLIP-7', field: prefix + 'Model Number' },
    selected: {
      colour: { value: colour, field: prefix + 'Color' },
      pack: { value: '1', field: prefix + 'Number of Items' },
    },
  };
}
function product(store = 'flipkart') {
  const e = evidence(store);
  return {
    title:
      store === 'amazon' ? 'Acme Clip 7 Earbuds Black' : 'Acme CLIP 7 OWS Earbuds Black',
    brand: 'Acme',
    comparisonIdentityVerified: false,
    store,
    storeName: store,
    url: e.url,
    currentPrice: 200,
    currency: '₹',
    isOutOfStock: false,
    exactEvidence: e,
  };
}
afterEach(() => vi.restoreAllMocks());
describe('pair evidence beyond the legacy flag, synthetic selected-main facts only', () => {
  it('matches differently worded selected products symmetrically without promoting the source flag', () => {
    const a = product('amazon'),
      b = product();
    expect(isVerifiedProductMatch(a, b)).toBe(true);
    expect(isVerifiedProductMatch(b, a)).toBe(true);
    expect(a.comparisonIdentityVerified).toBe(false);
    expect(
      isVerifiedProductMatch({ ...a, mpn: 'CLIP-7' }, { ...b, mpn: 'CLIP-7-PRO' }),
    ).toBe(false);
    expect(
      isVerifiedProductMatch({ ...a, model: 'CLIP-7' }, { ...b, model: 'CLIP-7-PRO' }),
    ).toBe(false);
  });
  it('rejects wrong colour, model suffix, quantity, unknown selected colour and contradictory identifiers', () => {
    const a = evidence(),
      b = evidence('amazon');
    expect(exactMatch(a, b)).toBe('verified');
    b.selected.colour.value = 'white';
    expect(exactMatch(a, b)).toBe('mismatch');
    b.selected.colour.value = 'black';
    b.mpn.value = 'CLIP-7-PRO';
    expect(exactMatch(a, b)).toBe('mismatch');
    const unknown = evidence();
    Reflect.deleteProperty(unknown.selected, 'colour');
    expect(sufficientExactEvidence(unknown)).toBe(false);
    expect(exactMatch(a, unknown)).toBe('insufficient');
    const pack = evidence();
    pack.selected.pack.value = '2';
    expect(exactMatch(a, pack)).toBe('mismatch');
  });
  it('requires main provenance and never equates retailer IDs or plain title words', () => {
    const a = product(),
      b = product('amazon');
    Reflect.deleteProperty(a.exactEvidence, 'mpn');
    Reflect.deleteProperty(b.exactEvidence, 'mpn');
    expect(isVerifiedProductMatch(a, b)).toBe(false);
    const invalid = evidence();
    invalid.mpn.field = 'variants.Model';
    expect(sufficientExactEvidence(invalid)).toBe(false);
  });
  it('checks GTIN checksum and contradicting global IDs conservatively', () => {
    const a = evidence(),
      b = evidence('amazon');
    Reflect.deleteProperty(a, 'mpn');
    Reflect.deleteProperty(b, 'mpn');
    Object.assign(a, {
      gtin: { value: '4006381333931', field: 'specifications.General.GTIN' },
    });
    Object.assign(b, {
      gtin: { value: '4006381333931', field: 'product_information.GTIN' },
    });
    expect(exactMatch(a, b)).toBe('verified');
    Object.assign(b, {
      gtin: { value: '4006381333932', field: 'product_information.GTIN' },
    });
    expect(exactMatch(a, b)).toBe('mismatch');
  });
});
describe('saved prices are fresh source-bound data, not saved links', () => {
  it('rejects stale/future/changed-price/wrong-URL/out-of-stock records', () => {
    const p = product();
    expect(freshSavedPrice(p)).toBe(true);
    for (const change of [
      { currentPrice: 201 },
      { url: 'https://www.flipkart.com/other/p/itm2' },
      { store: 'amazon' },
      { isOutOfStock: true },
    ])
      expect(freshSavedPrice({ ...p, ...change })).toBe(false);
    p.exactEvidence.observedAt = new Date(Date.now() - 600001).toISOString();
    expect(freshSavedPrice(p)).toBe(false);
    p.exactEvidence.observedAt = new Date(Date.now() + 60000).toISOString();
    expect(freshSavedPrice(p)).toBe(false);
  });
  it('reuses independently tracked products without transport calls and expires rendered saved prices', async () => {
    const a = product('amazon'),
      b = product();
    mocks.find.mockReturnValue({
      select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [b, a] }) }) }),
    });
    const offers = await savedProductOffers(a);
    expect(offers).toHaveLength(1);
    expect(offers[0].store).toBe('flipkart');
    expect(verifiedOffers(a, offers)).toHaveLength(1);
    offers[0].exactEvidence = {
      ...b.exactEvidence,
      observedAt: new Date(Date.now() - 600001).toISOString(),
    };
    expect(verifiedOffers(a, offers)).toEqual([]);
  });
  it('does no lookup or paid work when source selection evidence is insufficient', async () => {
    mocks.find.mockClear();
    const p = product();
    Reflect.deleteProperty(p.exactEvidence.selected, 'colour');
    expect(await savedProductOffers(p)).toEqual([]);
    expect(mocks.find).not.toHaveBeenCalled();
  });
});

describe('strong evidence cannot override contradictory main context', () => {
  it('rejects record/evidence URL, brand and price drift', () => {
    const a = product('amazon'),
      b = product();
    expect(
      isVerifiedProductMatch({ ...a, url: 'https://www.amazon.in/dp/B000000002' }, b),
    ).toBe(false);
    expect(isVerifiedProductMatch({ ...a, brand: 'Other' }, b)).toBe(false);
    expect(isVerifiedProductMatch({ ...a, currentPrice: 999 }, b)).toBe(false);
    expect(
      isVerifiedProductMatch(a, { ...b, title: b.title.replace('CLIP 7', 'CLIP 7 Pro') }),
    ).toBe(false);
  });
  it('rejects main colour contradictory to stored selected evidence', () => {
    const a = product('amazon'),
      b = product();
    expect(
      isVerifiedProductMatch(a, { ...b, title: b.title.replace('Black', 'White') }),
    ).toBe(false);
  });
});

describe('complete category profiles and selected provenance', () => {
  const fieldNames: Record<string, string> = {
    colour: 'Color',
    ram: 'RAM',
    disk: 'Storage',
    cpu: 'Processor',
    quantity: 'Quantity',
    concentration: 'Fragrance Concentration',
    fashionSize: 'Size',
    capacity: 'Capacity',
    pack: 'Number of Items',
  };
  it.each([
    ['phone', { colour: 'black', ram: '8GB', disk: '256GB', pack: '1' }],
    [
      'laptop',
      { colour: 'silver', ram: '16GB', disk: '512GB', cpu: 'i5-1235U', pack: '1' },
    ],
    ['perfume', { quantity: '30ml', concentration: 'edp', pack: '1' }],
    ['fashion', { colour: 'blue', fashionSize: 'M', pack: '1' }],
    ['grocery', { quantity: '500g', pack: '2' }],
    ['appliance', { capacity: '7kg', colour: 'white', pack: '1' }],
  ] as [string, Record<string, string>][])(
    'checks exact selected attributes for %s',
    (category, selected) => {
      const a = evidence() as ExactEvidence,
        b = evidence('amazon') as ExactEvidence;
      a.category = b.category = category;
      a.selected = {};
      b.selected = {};
      for (const [key, value] of Object.entries(selected)) {
        a.selected[key as keyof typeof a.selected] = {
          value,
          field: 'specifications.General.' + fieldNames[key],
        };
        b.selected[key as keyof typeof b.selected] = {
          value,
          field: 'product_information.' + fieldNames[key],
        };
      }
      expect(exactMatch(a, b)).toBe('verified');
      for (const key of Object.keys(selected)) {
        const fact = b.selected[key as keyof typeof b.selected]!;
        const value = fact.value;
        fact.value = key === 'pack' ? '3' : value + '-different';
        expect(exactMatch(a, b)).not.toBe('verified');
        fact.value = value;
      }
      Reflect.deleteProperty(b.selected, Object.keys(selected)[0]);
      expect(exactMatch(a, b)).toBe('insufficient');
    },
  );
  it('does not swap labelled RAM and storage or certify a bad GTIN alongside an MPN', () => {
    const a = evidence() as ExactEvidence,
      b = evidence('amazon') as ExactEvidence;
    a.category = b.category = 'phone';
    a.selected.ram = { value: '8GB', field: 'specifications.General.RAM' };
    a.selected.disk = { value: '256GB', field: 'specifications.General.Storage' };
    b.selected.ram = { value: '256GB', field: 'product_information.RAM' };
    b.selected.disk = { value: '8GB', field: 'product_information.Storage' };
    expect(exactMatch(a, b)).toBe('mismatch');
    b.gtin = { value: '4006381333932', field: 'product_information.GTIN' };
    expect(sufficientExactEvidence(b)).toBe(false);
  });
  it('extracts only explicit main fields and excludes retailer identifier lookalikes', () => {
    const p = product('amazon');
    const parsed = mainEvidence(
      p,
      {
        Brand: 'Acme',
        'Model Number': 'CLIP-7',
        Color: 'black',
        'Number of Items': '1',
        variants: [{ Color: 'white', price: 1 }],
      },
      'product_information',
      ['B000000001'],
    );
    expect(sufficientExactEvidence(parsed)).toBe(true);
    expect(
      mainEvidence(
        p,
        { 'Model Number': 'CLIP-7', Color: 'black', 'Number of Items': '1' },
        'product_information',
      ),
    ).toBeUndefined();
    expect(
      mainEvidence(
        p,
        {
          Brand: 'Other',
          'Model Number': 'CLIP-7',
          Color: 'black',
          'Number of Items': '1',
        },
        'product_information',
      ),
    ).toBeUndefined();
    expect(parsed?.selected.colour?.value).toBe('black');
    expect(
      mainEvidence(
        p,
        { Brand: 'Acme', 'Model Number': 'B000000001' },
        'product_information',
        ['B000000001'],
      )?.mpn,
    ).toBeUndefined();
    expect(
      mainEvidence(
        p,
        { Brand: 'Acme', 'Model Number': 'CLIP-7', Color: 'black', Colour: 'white' },
        'product_information',
      ),
    ).toBeUndefined();
  });
});

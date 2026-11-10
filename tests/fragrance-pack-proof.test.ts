import { describe, expect, it } from 'vitest';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import {
  fragranceDecision,
  readCanonicalIdentity,
} from '@/lib/scraper/matching/fragrance';
import { verifiedOffers } from '@/lib/verified-offers';
import { LOVE_DRUNK_100ML_PREVIEW_TEST_URL } from '@/lib/preview-website-test-target';
import amazon from './fixtures/amazon-india-product-full.json';
import flipkart from './fixtures/flipkart-product-real.json';
const amazonURL = 'https://www.amazon.in/dp/B0FYGRL51R';
const flipkartURL =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ';

describe('pack evidence limitations; offline captured contracts and labelled synthetic transformations', () => {
  it('retains captured Amazon pack count but never interprets Flipkart volume as pack proof', () => {
    const a = parseAmazonAPIProduct(JSON.stringify(amazon), amazonURL);
    const f = parseFlipkartAPIProduct(JSON.stringify(flipkart), flipkartURL);
    expect(readCanonicalIdentity(a.canonicalIdentity)?.selected.pack).toEqual({
      value: '1',
      field: 'product_information.Number of Items',
      scope: 'selected',
    });
    expect(readCanonicalIdentity(f.canonicalIdentity)?.selected.volume?.value).toBe(
      '30ml',
    );
    expect(readCanonicalIdentity(f.canonicalIdentity)?.selected.pack).toBeUndefined();
    expect(fragranceDecision(f, a)).toMatchObject({
      status: 'insufficient',
      reason: 'pack-unconfirmed',
    });
    expect(fragranceDecision(a, f).reason).toBe('pack-unconfirmed');
    expect(verifiedOffers(f, [{ ...a, price: a.currentPrice }])).toEqual([]);
  });
  it.each(['1', '2'])(
    'keeps synthetic 100ml pack=%s unverified against missing Flipkart pack count',
    (pack) => {
      // These 100ml Flipkart/Amazon payloads are synthetic; the live Amazon
      // response was not retained and no selected pack value is known for it.
      const a = structuredClone(amazon),
        f = structuredClone(flipkart);
      const title = 'BLA BLI BLU Love Drunk Perfume 100ml';
      a.title = title;
      a.main_title = title;
      a.product_information['Model Name'] = title;
      a.product_information['Item Volume'] = '100 Millilitres';
      a.product_information['Package Size Name'] = '100ml';
      a.product_information['Unit Count'] = '100.0 Milliliters';
      a.product_information['Number of Items'] = pack;
      f.product_results.title = title;
      f.product_results.sku = 'PERHEV7YFJMY2UWG';
      f.product_results.specifications.General['Model Name'] = 'Love Drunk Perfume';
      f.product_results.specifications.General.Quantity = '100 ml';
      f.product_results.specifications.General['Net Quantity'] = '100 ml';
      f.product_results.specifications['Product Highlights'].Quantity = '100 ml';
      f.product_results.highlights = ['Quantity: 100 ml'];
      const source = parseFlipkartAPIProduct(
        JSON.stringify(f),
        LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
      );
      const candidate = parseAmazonAPIProduct(JSON.stringify(a), amazonURL);
      expect(
        readCanonicalIdentity(source.canonicalIdentity)?.selected.volume?.value,
      ).toBe('100ml');
      expect(
        readCanonicalIdentity(source.canonicalIdentity)?.selected.pack,
      ).toBeUndefined();
      expect(fragranceDecision(source, candidate)).toMatchObject({
        status: 'insufficient',
        reason: 'pack-unconfirmed',
      });
      expect(
        verifiedOffers(source, [{ ...candidate, price: candidate.currentPrice }]),
      ).toEqual([]);
    },
  );
});

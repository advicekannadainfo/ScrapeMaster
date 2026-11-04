/** Offline inventory only. No transport, services, model connection or DB calls. */
import amazon from '../fixtures/amazon-india-product-full.json';
import flipkart from '../fixtures/flipkart-product-real.json';
import myntra from '../fixtures/myntra-product-real.json';
import monitor from '../fixtures/flipkart-product-full.json';
import jeans from '../fixtures/myntra-product.json';
import amazonSearch from '../fixtures/amazon-search.json';
import flipkartSearch from '../fixtures/flipkart-search.json';
import myntraSearch from '../fixtures/myntra-search.json';
import {
  parseAmazonAPIProduct,
  parseFlipkartAPIProduct,
} from '@/lib/scraper/stores/retail-product-json';
import { parseMyntraAPIProduct, parseMyntraSearch } from '@/lib/scraper/stores/myntra';
import { parseAmazonSearchAPI } from '@/lib/scraper/stores/amazon';
import { parseFlipkartSearchAPI } from '@/lib/scraper/stores/flipkart';
import {
  readCanonicalIdentity,
  independentFragrance,
} from '@/lib/scraper/matching/fragrance';
import { readExactEvidence, sufficientExactEvidence } from '@/lib/scraper/exact-evidence';
import { categoryFor } from '@/lib/scraper/product-identity';

const samples = [
  {
    store: 'amazon',
    category: 'fragrance',
    provenance: 'captured',
    file: 'amazon-india-product-full.json',
    parse: () =>
      parseAmazonAPIProduct(
        JSON.stringify(amazon),
        'https://www.amazon.in/dp/B0FYGRL51R',
      ),
  },
  {
    store: 'flipkart',
    category: 'fragrance',
    provenance: 'captured',
    file: 'flipkart-product-real.json',
    parse: () =>
      parseFlipkartAPIProduct(
        JSON.stringify(flipkart),
        'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ',
      ),
  },
  {
    store: 'myntra.com',
    category: 'fragrance',
    provenance: 'captured',
    file: 'myntra-product-real.json',
    parse: () =>
      parseMyntraAPIProduct(
        JSON.stringify(myntra),
        'https://www.myntra.com/perfume/love-drunk/36340100/buy',
      ),
  },
  {
    store: 'flipkart',
    category: 'electronics',
    provenance: 'documented',
    file: 'flipkart-product-full.json',
    parse: () =>
      parseFlipkartAPIProduct(
        JSON.stringify(monitor),
        'https://www.flipkart.com/samsung-monitor/p/itmexample?pid=OFFLINETEST',
      ),
  },
  {
    store: 'myntra.com',
    category: 'fashion',
    provenance: 'documented',
    file: 'myntra-product.json',
    parse: () =>
      parseMyntraAPIProduct(
        JSON.stringify(jeans),
        'https://www.myntra.com/jeans/powerlook/31076617/buy',
      ),
  },
] as const;

export function buildEvidenceCoverage() {
  const fixtures = samples.map((sample) => {
    const { parse, ...metadata } = sample;
    try {
      const p = parse();
      const canonical = readCanonicalIdentity(p.canonicalIdentity);
      const exact = readExactEvidence(p.exactEvidence);
      const selectedFields = [
        ...new Set([
          ...Object.values(canonical?.selected ?? {}).flatMap((fact) =>
            fact ? [fact.field] : [],
          ),
          ...Object.values(exact?.selected ?? {}).flatMap((fact) =>
            fact ? [fact.field] : [],
          ),
        ]),
      ].sort();
      return {
        ...metadata,
        tracking: 'pass',
        selectedFields,
        independentIdentity:
          independentFragrance(canonical) || sufficientExactEvidence(exact),
        sourcePriceValid:
          p.currency === '₹' && Number.isFinite(p.currentPrice) && p.currentPrice > 0,
        stockExplicit: typeof p.isOutOfStock === 'boolean',
      };
    } catch {
      // Do not serialize error messages/payloads into a readiness artifact.
      return {
        ...metadata,
        tracking: 'blocked-contract',
        selectedFields: [],
        independentIdentity: false,
        sourcePriceValid: false,
        stockExplicit: false,
      };
    }
  });
  const searches = [
    {
      store: 'amazon',
      file: 'amazon-search.json',
      parse: () => parseAmazonSearchAPI(JSON.stringify(amazonSearch)),
    },
    {
      store: 'flipkart',
      file: 'flipkart-search.json',
      parse: () => parseFlipkartSearchAPI(JSON.stringify(flipkartSearch)),
    },
    {
      store: 'myntra.com',
      file: 'myntra-search.json',
      parse: () => parseMyntraSearch(JSON.stringify(myntraSearch)),
    },
  ].map(({ parse, ...metadata }) => {
    const offers = parse();
    return {
      ...metadata,
      provenance: 'documented-synthetic',
      rows: offers.length,
      categories: [
        ...new Set(
          offers.map((o) =>
            categoryFor(o.title) === 'perfume' ? 'fragrance' : categoryFor(o.title),
          ),
        ),
      ].sort(),
      establishesSelectedSku: false,
    };
  });
  const rows = [
    'fragrance',
    'electronics',
    'fashion',
    'grocery',
    'appliances',
    'books',
  ].flatMap((category) =>
    ['amazon', 'flipkart', 'myntra.com'].map((store) => {
      const available = fixtures.filter(
        (f) => f.store === store && f.category === category,
      );
      const captured = available.filter((f) => f.provenance === 'captured');
      return {
        category,
        store,
        capturedProductFixtures: captured.length,
        documentedProductFixtures: available.length - captured.length,
        trackingEvidence: captured.some((f) => f.tracking === 'pass')
          ? 'captured-pass'
          : available.some((f) => f.tracking === 'pass')
            ? 'documented-only'
            : available.length
              ? 'documented-contract-blocked'
              : 'no-category-product-fixture',
        observedSelectedFields: [
          ...new Set(available.flatMap((f) => f.selectedFields)),
        ].sort(),
        discoveryEvidence: searches.some(
          (s) => s.store === store && s.categories.some((value) => value === category),
        )
          ? 'documented-synthetic-listing'
          : 'category-search-fixture-missing',
        canonicalProfile: category === 'fragrance' ? 'fragrance-v1' : 'not-enabled',
        exactReleaseStatus:
          category === 'fragrance'
            ? 'conditional-evidence-required'
            : 'unsupported-for-category-wide-release',
        priceDisplayEvidence: captured.some((f) => f.sourcePriceValid)
          ? 'captured-source-only'
          : available.some((f) => f.sourcePriceValid)
            ? 'documented-source-only'
            : 'not-established',
      };
    }),
  );
  return {
    version: 1,
    baseline: 'ce37989cc47edfa22bcf1c659bd9c42b3592405a',
    method:
      'Offline parser execution of existing unmodified fixtures; no live or category-wide success inferred',
    summary: {
      categoryStoreCells: rows.length,
      capturedProductFixtures: fixtures.filter((f) => f.provenance === 'captured').length,
      capturedCategoryStoreCells: rows.filter((r) => r.capturedProductFixtures).length,
      releaseReadyCategories: 0,
    },
    fixtures,
    searches,
    rows,
  };
}

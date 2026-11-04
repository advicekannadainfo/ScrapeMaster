import 'server-only';
import { z } from 'zod';
import { evidenceLookupURL } from './preview-product-evidence';
import { flipkart, amazon, myntra } from './scraper/stores';
import {
  fragranceIdentity,
  independentFragrance,
  readCanonicalIdentity,
} from './scraper/matching/fragrance';
import { freshProfilePrice } from './scraper/matching/observations';
import { fragranceDiscoveryQuery } from './scraper/product-candidate-match';
import { createFragranceHydrator } from './scraper/hydrate-fragrance';
import { withPreviewProviderBudget } from './scraper/preview-provider-budget';
import { categoryFor } from './scraper/product-identity';
import { scrapeProduct } from './scraper';
import { loadAndParse } from './scraper/load';
export const DRY_RUN_URL =
  'https://www.flipkart.com/bla-bli-blu-old-money-perfume-men-apple-cedar-notes-perfume-men-long-lasting-30-ml/p/itmbe299cbfa6eb1?pid=PERHHHH3RYADXXH5';
export function dryRunTarget(value: unknown) {
  const parsed = z
    .object({ url: z.string().max(2048) })
    .strict()
    .safeParse(value);
  return parsed.success && evidenceLookupURL(parsed.data.url) === DRY_RUN_URL
    ? DRY_RUN_URL
    : undefined;
}
const recordSchema = z.object({
  title: z.string().min(1).max(4000),
  brand: z.string().max(200).optional(),
  variant: z.string().max(200).optional(),
  store: z.literal('flipkart'),
  url: z.literal(DRY_RUN_URL),
  storeName: z.string().optional(),
  image: z.string().optional(),
  currentPrice: z.number().finite().positive(),
  currency: z.literal('₹'),
  isOutOfStock: z.boolean(),
  comparisonIdentityVerified: z.boolean().optional(),
  canonicalIdentity: z.unknown().optional(),
  priceObservation: z.unknown().optional(),
  exactEvidence: z.unknown().optional(),
});
/** Only adapters/parsers and ephemeral verification; no write-service imports. */
export async function runFragranceDryRun(record: unknown) {
  return withPreviewProviderBudget(async (budget) => {
    const budgetSummary = () => ({
      maximum: 5,
      used: budget.used,
      routes: { ...budget.routes },
    });
    const parsed = recordSchema.safeParse(record);
    if (
      !record ||
      typeof record !== 'object' ||
      !('url' in record) ||
      record.url !== DRY_RUN_URL ||
      !('store' in record) ||
      record.store !== 'flipkart' ||
      !('title' in record) ||
      typeof record.title !== 'string' ||
      categoryFor(record.title) !== 'perfume'
    )
      return {
        source: { status: 'stored-record-invalid' },
        stores: [],
        budget: budgetSummary(),
      };
    const ready = (p: z.infer<typeof recordSchema>) =>
      independentFragrance(p.canonicalIdentity) &&
      Boolean(fragranceIdentity(p)) &&
      readCanonicalIdentity(p.canonicalIdentity)?.selected.volume?.value === '30ml' &&
      freshProfilePrice(p);
    let source = parsed.success ? parsed.data : undefined;
    let fetched = false;
    if (!source || !ready(source)) {
      try {
        const api = flipkart.productAPI;
        if (!api || !api.matches(new URL(DRY_RUN_URL)))
          throw new Error('Dedicated route unavailable');
        fetched = true;
        const p = recordSchema.safeParse(
          await scrapeProduct(DRY_RUN_URL, { allowFallback: false, maxPaidRequests: 1 }),
        );
        if (!p.success || categoryFor(p.data.title) !== 'perfume')
          throw new Error('Invalid source');
        source = p.data;
      } catch {
        return {
          source: { status: 'source-request-failed', fetched },
          stores: [],
          budget: budgetSummary(),
        };
      }
    }
    const query = fragranceDiscoveryQuery(source);
    if (!ready(source) || !query)
      return {
        source: { status: 'selected-product-proof-missing', fetched },
        stores: [],
        budget: budgetSummary(),
      };
    const hydrator = createFragranceHydrator(source, { previewDryRun: true });
    const stores = await Promise.all(
      [amazon, myntra].map(async (adapter) => {
        try {
          const search = adapter.search;
          if (!search?.load) throw new Error('Dedicated search unavailable');
          const url = search.url(query, 'in');
          const rows = (
            await loadAndParse(adapter, url, (body) => search.parse(body, url), {
              kind: 'search',
            })
          ).slice(0, 200);
          const checked = await hydrator.verify(adapter.id, rows);
          return {
            store: adapter.id,
            searchFound: rows.length,
            selectedProductProof: Boolean(checked.offer),
            verification: checked.offer ? 'verified' : 'rejected',
            freshPrice: checked.offer ? 'fresh' : 'unverified',
            reason: checked.diagnostic.status,
            eligibleCandidates: checked.diagnostic.eligibleCandidates,
          };
        } catch {
          return {
            store: adapter.id,
            searchFound: 0,
            selectedProductProof: false,
            verification: 'failed',
            freshPrice: 'unverified',
            reason: 'search-failed',
          };
        }
      }),
    );
    return {
      source: {
        status: 'verified',
        selectedProductProof: true,
        freshPrice: 'fresh',
        fetched,
      },
      stores,
      budget: budgetSummary(),
    };
  });
}

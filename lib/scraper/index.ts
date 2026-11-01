import 'server-only';
import { loadAndParse } from './load';
import { resolveStore } from './stores';
import { dedicatedFirst } from './provider-routes';

export { ScrapeError } from './errors';
export { parseAmazonProduct } from './stores/amazon';

export function normalizeProductURL(input: string) {
  const url = new URL(input.trim());
  return resolveStore(url).normalize(url);
}

/** Fetch and parse a product page from any supported store. */
export async function scrapeProduct(
  url: string,
  policy: { allowFallback: boolean; maxPaidRequests: 0 | 1 | 2 } = {
    allowFallback: false,
    maxPaidRequests: 1,
  },
) {
  const adapter = resolveStore(new URL(url));
  const parse = adapter.productAPI?.matches(new URL(url))
    ? adapter.productAPI.parse
    : adapter.parse;
  const api = adapter.productAPI?.matches(new URL(url)) ? adapter.productAPI : undefined;
  if (!api) return loadAndParse(adapter, url, (body) => parse(body, url));
  const results = await dedicatedFirst(
    {
      paid: true,
      run: async () => [await loadAndParse(adapter, url, (body) => parse(body, url))],
    },
    api.fallback
      ? {
          paid: api.fallback.paid,
          run: async () => [api.fallback!.parse(await api.fallback!.load(url), url)],
        }
      : undefined,
    policy,
  );
  return results[0];
}

import 'server-only';
import { loadAndParse } from './load';
import { resolveStore } from './stores';

export { ScrapeError } from './errors';
export { parseAmazonProduct } from './stores/amazon';

export function normalizeProductURL(input: string) {
  const url = new URL(input.trim());
  return resolveStore(url).normalize(url);
}

/** Fetch and parse a product page from any supported store. */
export async function scrapeProduct(url: string) {
  const adapter = resolveStore(new URL(url));
  const parse = adapter.productAPI?.matches(new URL(url))
    ? adapter.productAPI.parse
    : adapter.parse;
  return loadAndParse(adapter, url, (body) => parse(body, url));
}

import 'server-only';
import type { Offer } from '@/types';
import { discoverOffers } from './discovery';
import { isAccessory, tokenize } from './match';
import { searchableStores, type Region } from './stores';
import { isVerifiedMatch, matchesDiscoveryQuery } from '@/lib/verified-offers';

export type SearchResult = {
  title: string;
  image?: string;
  offers: Offer[];
  best: Offer;
  relevance: number;
};

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<SearchResponse> }>();

export type SearchResponse = { results: SearchResult[]; failedStores: string[] };

/** Share of the query's words that appear in a title. */
function relevance(query: string, title: string) {
  const q = tokenize(query);
  if (!q.size) return 0;
  const t = tokenize(title);
  let hits = 0;
  for (const token of q) if (t.has(token)) hits++;
  return hits / q.size;
}

async function run(query: string, region: Region): Promise<SearchResponse> {
  const stores = searchableStores(region);
  const settled = await Promise.allSettled(
    stores.map((adapter) => discoverOffers(adapter, query, region)),
  );

  const failedStores = stores
    .filter((_, i) => settled[i].status === 'rejected')
    .map((a) => a.name);
  const offers = settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value.slice(0, 20) : []))
    .filter(
      (o) =>
        Number.isFinite(o.price) &&
        o.price > 0 &&
        !isAccessory(o.title, query) &&
        matchesDiscoveryQuery(query, o.title),
    );

  // Group listings of the same product across stores.
  const groups: Offer[][] = [];
  for (const offer of offers) {
    const group = groups.find(
      (g) =>
        !g.some((o) => o.store === offer.store) &&
        g.every(
          (other) => other.currency === offer.currency && isVerifiedMatch(other, offer),
        ) &&
        offer.price >= g[0].price * 0.5 &&
        offer.price <= g[0].price * 2,
    );
    if (group) group.push(offer);
    else groups.push([offer]);
  }

  const results = groups
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.price - b.price);
      const lead = group[0];
      return {
        title: lead.title,
        image: group.find((o) => o.image)?.image,
        offers: sorted,
        best: sorted[0],
        relevance: relevance(query, lead.title),
      };
    })
    // Most relevant first, then listings found on more stores.
    .sort((a, b) => b.relevance - a.relevance || b.offers.length - a.offers.length)
    .slice(0, 18);

  return { results, failedStores };
}

/** Search every store that serves the region; results are cached briefly per query. */
export function searchStores(query: string, region: Region) {
  const key = `verified-v1:${region}:${query.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = run(query, region);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

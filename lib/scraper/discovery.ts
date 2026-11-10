import 'server-only';
import type { Offer } from '@/types';
import type { Region, StoreAdapter } from './stores/types';
import { loadAndParse } from './load';
import { dedicatedFirst } from './provider-routes';
import { previewWebsiteBudgetActive } from './preview-provider-budget';

export const DISCOVERY_TTL_MS = 10 * 60_000;
export const DISCOVERY_FAILURE_COOLDOWN_MS = 60_000;
export const DISCOVERY_CANDIDATE_LIMIT = 20;
export const DISCOVERY_POOL_LIMIT = 200;
export type DiscoveryObservation = {
  cacheHit: boolean;
  parsedCandidates: number;
  candidateLimit: number;
  truncated: boolean;
};
const cache = new Map<
  string,
  { until: number; pending: Promise<Offer[]>; parsedCandidates: number }
>();

/** Shared by product comparison and name search. Coalesce concurrent paid work. */
export function discoverOffers(
  adapter: StoreAdapter,
  query: string,
  region: Region,
  policy: { allowFallback: boolean; maxPaidRequests: 0 | 1 | 2 } = {
    allowFallback: false,
    maxPaidRequests: 1,
  },
  observe?: (result: DiscoveryObservation) => void,
  candidateLimit: 20 | 200 = DISCOVERY_CANDIDATE_LIMIT,
): Promise<Offer[]> {
  const search = adapter.search;
  if (!search || !search.regions.includes(region) || search.enabled?.() === false)
    return Promise.resolve([]);
  const key = `${adapter.id}:${region}:${query.trim().toLowerCase()}:${policy.allowFallback}:${policy.maxPaidRequests}`;
  const isolated = previewWebsiteBudgetActive();
  const hit = isolated ? undefined : cache.get(key);
  const observed = (
    entry: { pending: Promise<Offer[]>; parsedCandidates: number },
    cacheHit: boolean,
  ) =>
    entry.pending.then((offers) => {
      observe?.({
        cacheHit,
        parsedCandidates: Math.min(entry.parsedCandidates, 10_000),
        candidateLimit,
        truncated: entry.parsedCandidates > candidateLimit,
      });
      return offers.slice(0, candidateLimit);
    });
  if (hit && hit.until > Date.now()) return observed(hit, true);
  const entry = {
    until: Date.now() + DISCOVERY_TTL_MS,
    pending: Promise.resolve([] as Offer[]),
    parsedCandidates: 0,
  };
  entry.pending = Promise.resolve()
    .then(async () => {
      const url = search.url(query, region);
      return dedicatedFirst(
        {
          paid: Boolean(
            search.load || (process.env.SCRAPINGDOG_API_KEY && !search.headers),
          ),
          run: () =>
            loadAndParse(adapter, url, (body) => search.parse(body, url), {
              headers: search.headers?.(),
              kind: 'search',
            }),
        },
        search.fallback
          ? {
              paid: search.fallback.paid,
              run: async () =>
                search.fallback!.parse(await search.fallback!.load(url), url),
            }
          : undefined,
        policy,
      );
    })
    .then((offers) => {
      entry.until = Date.now() + DISCOVERY_TTL_MS;
      entry.parsedCandidates = offers.length;
      return offers
        .slice(0, DISCOVERY_POOL_LIMIT)
        .filter((o) => Number.isFinite(o.price) && o.price > 0);
    })
    .catch((error) => {
      entry.until = Date.now() + DISCOVERY_FAILURE_COOLDOWN_MS;
      throw error;
    });
  if (!isolated) {
    cache.set(key, entry);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  // Every caller receives its own array so cached candidates cannot be overwritten.
  return observed(entry, false);
}

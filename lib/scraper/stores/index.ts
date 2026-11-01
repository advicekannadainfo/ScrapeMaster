import { amazon } from './amazon';
import { flipkart } from './flipkart';
import { generic } from './generic';
import { myntra } from './myntra';
import type { Region, StoreAdapter } from './types';

/** Dedicated adapters first; the generic structured-data adapter handles everything else. */
export const adapters: StoreAdapter[] = [amazon, flipkart, myntra];

export function resolveStore(url: URL): StoreAdapter {
  return adapters.find((adapter) => adapter.matches(url)) ?? generic;
}

/** Stores whose search can be used for this marketplace right now. */
export function searchableStores(region: Region) {
  return adapters.filter(
    (a) => a.search?.regions.includes(region) && (a.search.enabled?.() ?? true),
  );
}

export { amazon, flipkart, myntra, generic };
export { regionFromCurrency } from './types';
export type { Region, StoreAdapter } from './types';

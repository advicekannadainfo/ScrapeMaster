import type { Offer, ScrapedProduct } from '@/types';

export type Region = 'us' | 'in' | 'uk' | 'de';

export interface StoreAdapter {
  id: string;
  name: string;
  /** 'browser' for stores that only serve data to real browser engines. */
  fetchMode?: 'http' | 'browser';
  matches(url: URL): boolean;
  /** Canonical URL so tracking params don't create duplicate products. */
  normalize(url: URL): string;
  parse(html: string, url: string): ScrapedProduct;
  /** Dedicated product provider. Called only for matching product URLs; never retried. */
  productAPI?: {
    matches(url: URL): boolean;
    load(url: string): Promise<string>;
    parse(body: string, url: string): ScrapedProduct;
  };
  /** Optional: search the store for comparable offers. */
  search?: {
    regions: Region[];
    /** False when search needs credentials that aren't configured. */
    enabled?: () => boolean;
    url(query: string, region: Region): string;
    parse(body: string, pageUrl: string): Offer[];
    /** Set for an official API: fetched over plain HTTP with these headers. */
    headers?: () => Record<string, string>;
  };
}

export function regionFromCurrency(currency: string): Region {
  if (currency.includes('₹')) return 'in';
  if (currency.includes('£')) return 'uk';
  if (currency.includes('€')) return 'de';
  return 'us';
}

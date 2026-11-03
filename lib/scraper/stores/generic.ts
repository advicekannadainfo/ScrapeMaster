import * as cheerio from 'cheerio';
import { ScrapeError } from '../errors';
import { extractStructured } from '../structured';
import type { StoreAdapter } from './types';

const KNOWN_STORES: Record<string, string> = {
  'walmart.com': 'Walmart',
  'bestbuy.com': 'Best Buy',
  'target.com': 'Target',
  'ebay.com': 'eBay',
  'newegg.com': 'Newegg',
  'costco.com': 'Costco',
  'myntra.com': 'Myntra',
  'ajio.com': 'AJIO',
  'croma.com': 'Croma',
  'reliancedigital.in': 'Reliance Digital',
  'tatacliq.com': 'Tata CLiQ',
  'snapdeal.com': 'Snapdeal',
  'nykaa.com': 'Nykaa',
  'meesho.com': 'Meesho',
  'apple.com': 'Apple',
  'samsung.com': 'Samsung',
  'currys.co.uk': 'Currys',
  'argos.co.uk': 'Argos',
  'otto.de': 'OTTO',
  'mediamarkt.de': 'MediaMarkt',
};

const TRACKING_PARAMS =
  /^(utm_|fbclid|gclid|msclkid|ref|ref_|tag|affid|affiliate|srsltid|_ga)/i;

export function storeFromHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^(www|m|shop)\./, '');
  const known = Object.keys(KNOWN_STORES).find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (known) return { id: known, name: KNOWN_STORES[known] };
  const label = host.split('.')[0];
  return { id: host, name: label.charAt(0).toUpperCase() + label.slice(1) };
}

export function parseGenericProduct(html: string, url: string) {
  const $ = cheerio.load(html);
  const data = extractStructured($);
  const store = storeFromHost(new URL(url).hostname);

  if (!data.title || !data.price) {
    throw new ScrapeError(
      `Could not find product details on ${store.name}. The page may not be a product page.`,
      'parse',
    );
  }

  if (data.inStock === undefined || !data.currency)
    throw new ScrapeError(
      'Product stock or currency evidence is missing; offer unverified',
      'parse',
    );
  if (!Number.isFinite(data.price) || data.price <= 0)
    throw new ScrapeError('Product has no valid positive price', 'parse');
  const original = Math.max(data.originalPrice ?? 0, data.price);
  return {
    url,
    store: store.id,
    storeName: store.name,
    title: data.title,
    currency: data.currency,
    brand: data.brand,
    image: data.image ? new URL(data.image, url).toString() : '',
    currentPrice: data.price,
    originalPrice: original,
    discountRate: Math.round(((original - data.price) / original) * 100),
    category: data.category ?? data.brand ?? 'General',
    description: data.description ?? '',
    isOutOfStock: data.inStock === false,
    stars: data.stars ?? 0,
    reviewsCount: Math.round(data.reviewsCount ?? 0),
  };
}

/** Works for any store that publishes schema.org Product data or OpenGraph price tags. */
export const generic: StoreAdapter = {
  id: 'generic',
  name: 'Online store',
  matches: () => true,
  normalize(url) {
    const clean = new URL(url);
    clean.hash = '';
    for (const key of [...clean.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) clean.searchParams.delete(key);
    }
    return clean.toString();
  },
  parse: parseGenericProduct,
};

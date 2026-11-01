import * as cheerio from 'cheerio';
import { extractPrice } from '../extract';
import { extractStructured } from '../structured';
import { ScrapeError } from '../errors';
import type { StoreAdapter } from './types';
import { z } from 'zod';
import { fetchMyntraProductJSON, myntraProductID } from '../http';
import type { ScrapedProduct } from '@/types';

const money = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .transform(Number)
  .refine(Number.isFinite);
const apiProduct = z.object({
  productId: z.union([z.string(), z.number()]).transform(String),
  name: z.string().trim().min(1),
  brand: z.string().optional(),
  mrp: money.optional().nullable(),
  overall_rating: z.number().min(0).max(5).optional().nullable(),
  ratings_count: z.number().int().nonnegative().optional().nullable(),
  images: z.array(z.string().url()).optional(),
  sizes: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        mrp: money.optional().nullable(),
        discounted_price: money.optional().nullable(),
        available: z.boolean(),
        stock: z.number().int().nonnegative().optional().nullable(),
      }),
    )
    .min(1),
});

export function parseMyntraAPIProduct(body: string, url: string): ScrapedProduct {
  const id = myntraProductID(url);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ScrapeError('Myntra Product API returned invalid JSON', 'parse');
  }
  const result = z.object({ product_results: apiProduct }).safeParse(raw);
  if (!result.success)
    throw new ScrapeError('Myntra Product API returned invalid product data', 'parse');
  const product = result.data.product_results;
  if (product.productId !== id)
    throw new ScrapeError('Myntra Product API returned a different product ID', 'parse');
  const available = product.sizes.filter((s) => s.available && s.stock !== 0);
  if (!available.length)
    throw new ScrapeError('No available Myntra size with a selling price', 'parse');
  if (available.some((s) => !s.discounted_price || s.discounted_price <= 0))
    throw new ScrapeError(
      'Myntra selling price is missing for an available size',
      'parse',
    );
  if (new Set(available.map((s) => s.discounted_price)).size !== 1)
    throw new ScrapeError(
      'Myntra sizes have different prices; select a size before tracking',
      'unsupported',
    );
  // Deterministic size, with its own MRP. Never combine a price and MRP from different sizes.
  const selected = [...available].sort((a, b) => a.label.localeCompare(b.label))[0];
  const price = selected.discounted_price!;
  const original = selected.mrp ?? price;
  if (original < price)
    throw new ScrapeError('Myntra selling price exceeds the selected size MRP', 'parse');
  const brand = product.brand?.trim();
  const title =
    brand && !product.name.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${product.name}`
      : product.name;
  return {
    url,
    store: 'myntra.com',
    storeName: 'Myntra',
    title,
    currency: '₹',
    image: product.images?.find((image) => /^https?:\/\//.test(image)) ?? '',
    currentPrice: price,
    originalPrice: original,
    discountRate: Math.round(((original - price) / original) * 100),
    category: brand || 'General',
    description: `Myntra product ${id}. Price for size: ${selected.label}.`,
    isOutOfStock: false,
    stars: product.overall_rating ?? 0,
    reviewsCount: product.ratings_count ?? 0,
  };
}

type ProductState = {
  name?: string;
  mrp?: number;
  discountedPrice?: number;
  price?: number;
  media?: { albums?: { images?: { src?: string }[] }[] };
};

// Read only JSON, never execute scripts supplied by a retailer.
function productState(scripts: string[]): ProductState {
  for (const script of scripts) {
    const marker = /window\.__myx\s*=\s*/.exec(script);
    if (!marker) continue;
    const start = script.indexOf('{', marker.index + marker[0].length);
    if (start < 0) continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < script.length; i++) {
      const char = script[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const state = JSON.parse(script.slice(start, i + 1));
          if (state?.pdpData && typeof state.pdpData === 'object') return state.pdpData;
        } catch {
          // Other representations below may still contain usable product data.
        }
        break;
      }
    }
  }
  return {};
}

export function parseMyntraProduct(html: string, url: string) {
  const $ = cheerio.load(html);
  const data = extractStructured($);
  const state = productState(
    $('script')
      .map((_, el) => $(el).html() ?? '')
      .get(),
  );
  const title =
    [$('.pdp-title').first().text(), $('.pdp-name').first().text()]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() ||
    state.name ||
    data.title;
  const current =
    extractPrice($('.pdp-price').first()) ||
    Number(state.discountedPrice ?? state.price) ||
    data.price ||
    0;
  if (!title || !Number.isFinite(current) || current <= 0)
    throw new ScrapeError(
      'Could not find product details on Myntra. The page may be blocked or not a product page.',
      'parse',
    );
  const original = Math.max(
    extractPrice($('.pdp-mrp').first()) ||
      Number(state.mrp) ||
      data.originalPrice ||
      current,
    current,
  );
  const image = data.image || state.media?.albums?.[0]?.images?.[0]?.src || '';
  return {
    url,
    store: 'myntra.com',
    storeName: 'Myntra',
    title,
    currency: '₹',
    image: image ? new URL(image, url).toString() : '',
    currentPrice: current,
    originalPrice: original,
    discountRate: Math.round(((original - current) / original) * 100),
    category: data.category || 'Fashion',
    description: data.description || '',
    isOutOfStock: data.inStock === false,
    stars: data.stars || 0,
    reviewsCount: Math.round(data.reviewsCount || 0),
  };
}

export const myntra: StoreAdapter = {
  // Preserve the generic adapter's existing database and circuit identifiers.
  id: 'myntra.com',
  name: 'Myntra',
  fetchMode: 'browser',
  matches: (url) => /(^|\.)myntra\.com$/i.test(url.hostname),
  normalize(url) {
    return `https://www.myntra.com${url.pathname}`;
  },
  parse: parseMyntraProduct,
  productAPI: {
    matches: (url) => /\/\d+\/buy\/?$/.test(url.pathname),
    load: fetchMyntraProductJSON,
    parse: parseMyntraAPIProduct,
  },
};

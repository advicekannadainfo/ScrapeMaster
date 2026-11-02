import * as cheerio from 'cheerio';
import { extractPrice } from '../extract';
import { extractStructured } from '../structured';
import { ScrapeError } from '../errors';
import type { StoreAdapter } from './types';
import { z } from 'zod';
import { fetchMyntraProductJSON, myntraProductID } from '../http';
import type { ScrapedProduct } from '@/types';
import type { Offer } from '@/types';
import { fetchMyntraSearchJSON } from '../http';

const searchResponse = z.object({
  search_results: z.array(
    z.object({
      productId: z.number().int().positive(),
      productName: z.string().trim().min(1),
      brand: z.string().trim().min(1),
      price: z.number().positive().finite(),
      mrp: z.number().positive().finite(),
      rating: z.number().min(0).max(5).optional(),
      landingPageUrl: z.string(),
      searchImage: z.string().url().optional(),
      sizes: z.string().optional(),
      inventoryInfo: z.array(
        z.object({
          skuId: z.number().int().positive(),
          label: z.string(),
          inventory: z.number().int().nonnegative(),
          available: z.boolean(),
        }),
      ),
    }),
  ),
});

export function parseMyntraSearch(body: string): Offer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ScrapeError('Myntra Search API returned invalid JSON', 'parse');
  }
  const result = searchResponse.safeParse(raw);
  if (!result.success)
    throw new ScrapeError('Myntra Search API returned invalid search data', 'parse');
  return result.data.search_results.flatMap((item) => {
    if (!item.inventoryInfo.some((s) => s.available && s.inventory > 0)) return [];
    const url = new URL(item.landingPageUrl, 'https://www.myntra.com/');
    if (myntraProductID(url.toString()) !== String(item.productId))
      throw new ScrapeError(
        'Myntra search result product ID conflicts with URL',
        'parse',
      );
    if (item.price > item.mrp)
      throw new ScrapeError('Myntra search price exceeds MRP', 'parse');
    let image = '';
    if (item.searchImage) {
      const img = new URL(item.searchImage);
      if (
        ['http:', 'https:'].includes(img.protocol) &&
        img.hostname === 'assets.myntassets.com' &&
        !img.username &&
        !img.password &&
        !img.port
      ) {
        img.protocol = 'https:';
        image = img.toString();
      }
    }
    // A catalog size list is not the selected variant. Never append a guessed size.
    const title = item.productName.toLowerCase().startsWith(item.brand.toLowerCase())
      ? item.productName
      : `${item.brand} ${item.productName}`;
    return [
      {
        store: 'myntra.com',
        brand: item.brand,
        storeProductId: String(item.productId),
        storeName: 'Myntra',
        title,
        url: `https://www.myntra.com${url.pathname}`,
        price: item.price,
        originalPrice: item.mrp,
        currency: '₹',
        image,
      },
    ];
  });
}

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

const identifier = z
  .union([z.string().regex(/^\d+$/), z.number().int().positive()])
  .transform(String);
const realProduct = z.object({
  id: identifier,
  name: z.string().trim().min(1),
  brand: z.object({ name: z.string().trim().min(1) }),
  mrp: money.optional(),
  price: z.object({ discounted: money, mrp: money }),
  selectedSeller: z.object({
    sellerPartnerId: identifier,
    discountedPrice: money,
    netQuantity: z
      .array(z.object({ quantity: money, unit: z.string(), type: z.string().optional() }))
      .optional(),
    discount: z
      .object({ discountId: z.string().nullable().optional() })
      .nullable()
      .optional(),
  }),
  buyButtonSellerOrder: z
    .array(z.object({ skuId: identifier, sellerPartnerId: identifier }))
    .min(1),
  ratings: z
    .object({
      averageRating: z.number().min(0).max(5),
      totalCount: z.number().int().nonnegative().optional(),
      reviewInfo: z
        .object({
          reviewsCount: z
            .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
            .transform(Number),
        })
        .optional(),
    })
    .optional(),
  media: z.object({
    albums: z.array(
      z.object({
        images: z.array(
          z.object({
            imageURL: z.string().optional(),
            secureSrc: z.string().optional(),
            src: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
  sizes: z
    .array(
      z.object({
        mrp: money,
        discounted_price: money,
        seller_partner_id: identifier,
        discount_id: z.string().nullable().optional(),
        frg_list_link: z.string().optional(),
        available_count: z.number().int().nonnegative().optional(),
        sellable_inventory_count: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});

function parseRealMyntraProduct(raw: unknown, url: string, id: string): ScrapedProduct {
  const result = z.object({ product_results: realProduct }).safeParse(raw);
  if (!result.success)
    throw new ScrapeError(
      'Myntra Product API returned invalid real product data',
      'parse',
    );
  const p = result.data.product_results;
  if (p.id !== id)
    throw new ScrapeError('Myntra Product API returned a different product ID', 'parse');
  const fail = (message: string): never => {
    throw new ScrapeError(message, 'parse');
  };
  const seller = p.selectedSeller;
  const skus = new Set(
    p.buyButtonSellerOrder
      .filter((s) => s.sellerPartnerId === seller.sellerPartnerId)
      .map((s) => s.skuId),
  );
  if (skus.size !== 1) fail('Myntra selected seller SKU is missing or ambiguous');
  const sku = [...skus][0];
  const discount = seller.discount?.discountId;
  const discountProduct = (value: string) => {
    const match = /^(\d+):\d+$/.exec(value);
    return match?.[1] ?? fail('Myntra discount product reference is invalid');
  };
  if (discount && discountProduct(discount) !== id)
    fail('Myntra selected seller references a different product');
  const offers = p.sizes.filter((offer) => {
    const discountId = offer.discount_id ? discountProduct(offer.discount_id) : undefined;
    if (!offer.frg_list_link) return false;
    let link: URL;
    try {
      link = new URL(offer.frg_list_link, 'https://www.myntra.com');
    } catch {
      return false;
    }
    if (link.origin !== 'https://www.myntra.com' || link.pathname !== '/free-gift-list')
      return false;
    const param = (name: string) => {
      const values = link.searchParams.getAll(name);
      return values.length === 1 && /^\d+$/.test(values[0]) ? values[0] : undefined;
    };
    const productId = param('baseStyleId');
    const sellerId = param('sellerPartnerId');
    const skuId = param('skuId');
    if (discountId && productId && discountId !== productId)
      fail('Myntra offer has conflicting product references');
    if (sellerId && sellerId !== offer.seller_partner_id)
      fail('Myntra offer has conflicting seller references');
    return (
      productId === id &&
      sellerId === seller.sellerPartnerId &&
      skuId === sku &&
      offer.seller_partner_id === seller.sellerPartnerId &&
      (discount ? offer.discount_id === discount : !offer.discount_id)
    );
  });
  if (offers.length !== 1)
    fail('Myntra selected product/seller/SKU offer is missing or ambiguous');
  const selected = offers[0];
  const price = selected.discounted_price;
  const mrp = selected.mrp;
  if (
    price <= 0 ||
    mrp < price ||
    price !== p.price.discounted ||
    price !== seller.discountedPrice ||
    mrp !== p.price.mrp ||
    (p.mrp !== undefined && p.mrp !== mrp)
  )
    fail('Myntra selected offer has missing or conflicting price/MRP');
  const counts = [selected.available_count, selected.sellable_inventory_count].filter(
    (n): n is number => n !== undefined,
  );
  if (!counts.length) fail('Myntra selected offer stock is missing');
  const image = p.media.albums
    .flatMap((a) => a.images)
    .flatMap((i) => [i.imageURL, i.secureSrc, i.src])
    .map((value) => {
      if (!value || value.includes('$')) return '';
      try {
        const parsed = new URL(value);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.hostname !== 'assets.myntassets.com' ||
          parsed.username ||
          parsed.password ||
          parsed.port
        )
          return '';
        parsed.protocol = 'https:';
        return parsed.toString();
      } catch {
        return '';
      }
    })
    .find(Boolean);
  if (!image) fail('Myntra product image is missing or invalid');
  const volumeFrom = (quantity: number, unit: string) => {
    if (/^(ml|millilit(?:er|re)s?)$/i.test(unit)) return quantity;
    if (/^(l|lit(?:er|re)s?)$/i.test(unit)) return quantity * 1000;
    return undefined;
  };
  const titleVolumes = [
    ...p.name.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi,
    ),
  ].map((m) => volumeFrom(Number(m[1]), m[2]));
  const netVolumes = seller.netQuantity?.map((q) => volumeFrom(q.quantity, q.unit)) ?? [];
  const volumeCandidates = [...titleVolumes, ...netVolumes];
  if (new Set(volumeCandidates).size > 1)
    fail('Myntra title and selected seller quantity conflict');
  const selectedVolume =
    volumeCandidates.length === 1 ||
    (volumeCandidates.length > 1 &&
      volumeCandidates.every((v) => v === volumeCandidates[0]))
      ? volumeCandidates[0]
      : undefined;
  return {
    url,
    store: 'myntra.com',
    storeName: 'Myntra',
    brand: p.brand.name,
    variant: selectedVolume ? `${selectedVolume}ml` : undefined,
    title: p.name,
    currency: '₹',
    image: image!,
    currentPrice: price,
    originalPrice: mrp,
    discountRate: Math.round(((mrp - price) / mrp) * 100),
    category: p.brand.name,
    description: `Myntra product ${id}. Seller ${seller.sellerPartnerId}, SKU ${sku}.`,
    stars: p.ratings?.averageRating ?? 0,
    reviewsCount: p.ratings?.reviewInfo?.reviewsCount ?? 0,
    isOutOfStock: counts.some((n) => n === 0),
  };
}

export function parseMyntraAPIProduct(body: string, url: string): ScrapedProduct {
  const id = myntraProductID(url);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ScrapeError('Myntra Product API returned invalid JSON', 'parse');
  }
  // Actual provider payloads are validated independently; never fall back to
  // the older documented shape after a real-schema identity/price failure.
  if (raw && typeof raw === 'object' && 'product_results' in raw) {
    const p = raw.product_results;
    if (p && typeof p === 'object' && 'id' in p)
      return parseRealMyntraProduct(raw, url, id);
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
  search: {
    regions: ['in'],
    enabled: () => Boolean(process.env.SCRAPINGDOG_API_KEY),
    url: (query) =>
      `https://www.myntra.com/${encodeURIComponent(query.trim().replace(/\s+/g, '-'))}?rawQuery=${encodeURIComponent(query.trim())}`,
    load: fetchMyntraSearchJSON,
    parse: parseMyntraSearch,
  },
  productAPI: {
    matches: (url) => /\/\d+\/buy\/?$/.test(url.pathname),
    load: fetchMyntraProductJSON,
    parse: parseMyntraAPIProduct,
  },
};

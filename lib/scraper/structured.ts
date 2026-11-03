import type { CheerioAPI } from 'cheerio';
import { parsePrice } from './extract';

export type StructuredProduct = {
  title?: string;
  image?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  currency?: string;
  inStock?: boolean;
  stars?: number;
  reviewsCount?: number;
  category?: string;
  brand?: string;
};

type Json = Record<string, unknown>;

/** Unknown, preorder and backorder must never imply immediately available stock. */
function stockEvidence(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  const status = value.trim().split(/[\/#]/).pop()?.toLowerCase().replace(/[ _-]/g, '');
  if (status === 'instock') return true;
  if (['outofstock', 'soldout', 'discontinued', 'oos'].includes(status ?? ''))
    return false;
  return undefined;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
  AED: 'AED ',
  SGD: 'S$',
};

export function currencySymbol(code?: string) {
  if (!code) return undefined;
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function isType(node: Json, type: string) {
  return asArray(node['@type'] as string | string[]).some(
    (t) => String(t).toLowerCase() === type,
  );
}

/** Walk JSON-LD graphs and return the first node of the given @type. */
function findNode(data: unknown, type: string): Json | undefined {
  if (!data || typeof data !== 'object') return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findNode(item, type);
      if (found) return found;
    }
    return undefined;
  }
  const node = data as Json;
  if (isType(node, type)) return node;
  return findNode(node['@graph'], type);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'name' in value)
    return text((value as Json).name);
  return undefined;
}

function imageUrl(value: unknown): string | undefined {
  const first = asArray(value as unknown[])[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object')
    return text((first as Json).url) ?? text((first as Json).contentUrl);
  return undefined;
}

function num(value: unknown) {
  const n = typeof value === 'number' ? value : parsePrice(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function extractJsonLd($: CheerioAPI): StructuredProduct {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      continue;
    }
    const product =
      findNode(data, 'product') ??
      findNode(findNode(data, 'productgroup')?.hasVariant, 'product');
    if (!product) continue;

    const offers = asArray(product.offers as Json | Json[]).flatMap((o) =>
      isType(o, 'aggregateoffer') ? [{ ...o, price: o.lowPrice ?? o.price }] : [o],
    );
    const offer = offers.find((o) => num(o.price)) ?? offers[0];
    const spec = asArray(offer?.priceSpecification as Json | Json[]);
    const listPrice = spec.find((s) =>
      String(s.priceType ?? '')
        .toLowerCase()
        .includes('listprice'),
    );
    const rating = product.aggregateRating as Json | undefined;

    return {
      title: text(product.name),
      image: imageUrl(product.image),
      description: text(product.description),
      price: num(offer?.price) ?? num(spec[0]?.price),
      originalPrice: num(listPrice?.price),
      currency: currencySymbol(
        text(offer?.priceCurrency) ?? text(spec[0]?.priceCurrency),
      ),
      inStock: stockEvidence(offer?.availability),
      stars: num(rating?.ratingValue),
      reviewsCount: num(rating?.reviewCount ?? rating?.ratingCount),
      category: text(product.category)?.split(/[>/]/).pop()?.trim(),
      brand: text(product.brand),
    };
  }
  return {};
}

export function extractMeta($: CheerioAPI): StructuredProduct {
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = $(
        `meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`,
      ).attr('content');
      if (value?.trim()) return value.trim();
    }
    return undefined;
  };

  return {
    title:
      meta('og:title', 'twitter:title') ??
      ($('h1').first().text().trim() || $('title').text().trim() || undefined),
    image: meta('og:image', 'og:image:secure_url', 'twitter:image'),
    description: meta('og:description', 'description'),
    price: num(meta('product:price:amount', 'og:price:amount', 'price')),
    currency: currencySymbol(
      meta('product:price:currency', 'og:price:currency', 'priceCurrency'),
    ),
    inStock: (() => {
      const availability = meta(
        'product:availability',
        'og:availability',
        'availability',
      );
      return stockEvidence(availability);
    })(),
  };
}

/** JSON-LD first, OpenGraph/meta tags as fallback for each field. */
export function extractStructured($: CheerioAPI): StructuredProduct {
  const ld = extractJsonLd($);
  const meta = extractMeta($);
  const merged: StructuredProduct = { ...meta };
  for (const [key, value] of Object.entries(ld)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

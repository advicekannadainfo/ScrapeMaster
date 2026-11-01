import * as cheerio from 'cheerio';
import { z } from 'zod';
import { ScrapeError } from '../errors';
import { generic } from './generic';
import type { StoreAdapter } from './types';

type Json = Record<string, unknown>;
const record = (x: unknown): x is Json =>
  Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const isType = (x: Json, name: string) => [x['@type']].flat().includes(name);
const money = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .transform(Number)
  .refine((n) => Number.isFinite(n) && n > 0);
const text = z.string().trim().min(1);
const offerSchema = z.object({
  '@type': z.literal('Offer'),
  price: money,
  priceCurrency: z.literal('INR'),
  availability: z.enum([
    'https://schema.org/InStock',
    'http://schema.org/InStock',
    'https://schema.org/OutOfStock',
    'http://schema.org/OutOfStock',
    'https://schema.org/SoldOut',
    'https://schema.org/Discontinued',
  ]),
  url: z.string().optional(),
  priceSpecification: z.unknown().optional(),
});
const productSchema = z.object({
  name: text,
  url: z.string(),
  brand: z.union([text, z.object({ name: text })]),
  sku: z.union([text, z.number().int().positive()]).optional(),
  productID: z.union([text, z.number().int().positive()]).optional(),
  image: z.unknown(),
  offers: z.unknown(),
  description: z.string().optional(),
  category: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  aggregateRating: z.unknown().optional(),
});

/** No inferred DOM selectors or store-specific state. Only the standard Product contract. */
export function structuredIndiaStore(domain: string, name: string): StoreAdapter {
  const matches = (url: URL) =>
    [domain, `www.${domain}`, `m.${domain}`].includes(url.hostname.toLowerCase());
  const normalize = (input: URL) => {
    if (
      !matches(input) ||
      input.protocol !== 'https:' ||
      input.username ||
      input.password ||
      input.port
    )
      throw new ScrapeError(`Invalid ${name} product URL`, 'disallowed');
    // Generic normalization removes only known tracking keys; variant selectors survive.
    return generic.normalize(input);
  };
  return {
    id: domain,
    name,
    matches,
    normalize,
    fetchMode: 'http',
    parse(html, input) {
      const url = normalize(new URL(input));
      const $ = cheerio.load(html);
      const products: Json[] = [];
      const visit = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!record(value)) return;
        if (isType(value, 'Product')) products.push(value);
        // Do not descend into recommendations, ItemList or arbitrary hasVariant arrays.
        if (value['@graph']) visit(value['@graph']);
      };
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          visit(JSON.parse($(el).text()));
        } catch {
          /* another script may contain the product */
        }
      });
      const samePage = (value: string) => {
        try {
          return normalize(new URL(value, url)) === url;
        } catch {
          return false;
        }
      };
      const selected = products.filter(
        (p) => typeof p.url === 'string' && samePage(p.url),
      );
      if (selected.length !== 1)
        throw new ScrapeError(
          `${name} needs one JSON-LD Product matching the exact URL; page/variant is unsupported`,
          'parse',
        );
      const result = productSchema.safeParse(selected[0]);
      if (!result.success)
        throw new ScrapeError(
          `${name} JSON-LD product fields are missing or invalid`,
          'parse',
        );
      const p = result.data;
      const id = p.productID ?? p.sku;
      if (id === undefined)
        throw new ScrapeError(`${name} canonical product identifier is missing`, 'parse');
      const rawOffers = Array.isArray(p.offers) ? p.offers : [p.offers];
      const offers = rawOffers.filter(
        (o) => record(o) && (!o.url || (typeof o.url === 'string' && samePage(o.url))),
      );
      if (offers.length !== 1)
        throw new ScrapeError(`${name} offer/variant selection is ambiguous`, 'parse');
      const offer = offerSchema.safeParse(offers[0]);
      if (!offer.success)
        throw new ScrapeError(
          `${name} needs an explicit INR selling price and supported stock status; aggregate prices are unsupported`,
          'parse',
        );
      const selling = offer.data;
      let original = selling.price;
      const specs = Array.isArray(selling.priceSpecification)
        ? selling.priceSpecification
        : [selling.priceSpecification];
      const list = specs.filter(
        (s) => record(s) && s.priceType === 'https://schema.org/ListPrice',
      );
      if (list.length > 1)
        throw new ScrapeError(`${name} has conflicting list prices`, 'parse');
      if (list.length) {
        const value = list[0] as Json;
        const parsed = money.safeParse(value.price);
        if (
          !parsed.success ||
          value.priceCurrency !== 'INR' ||
          parsed.data < selling.price
        )
          throw new ScrapeError(`${name} list price is invalid`, 'parse');
        original = parsed.data;
      }
      const pictures = Array.isArray(p.image) ? p.image : [p.image];
      const image = pictures
        .map((i) =>
          typeof i === 'string' ? i : record(i) && typeof i.url === 'string' ? i.url : '',
        )
        .map((value) => {
          try {
            const img = new URL(value, url);
            return value &&
              img.protocol === 'https:' &&
              !img.username &&
              !img.password &&
              !img.port
              ? img.toString()
              : '';
          } catch {
            return '';
          }
        })
        .find(Boolean);
      if (!image)
        throw new ScrapeError(`${name} HTTPS product image is missing`, 'parse');
      const brand = typeof p.brand === 'string' ? p.brand : p.brand.name;
      const baseTitle = p.name.toLowerCase().startsWith(brand.toLowerCase())
        ? p.name
        : `${brand} ${p.name}`;
      const explicitVariants = [p.color, p.size].filter((v): v is string => Boolean(v));
      const title = [
        baseTitle,
        ...explicitVariants.filter((v) => {
          const normalized = (s: string) =>
            ` ${s
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .trim()} `;
          return !normalized(baseTitle).includes(normalized(v));
        }),
      ].join(' ');
      const rating = z
        .object({
          ratingValue: z.coerce.number().min(0).max(5),
          reviewCount: z.coerce.number().int().nonnegative().optional(),
        })
        .safeParse(p.aggregateRating);
      return {
        url,
        store: domain,
        storeName: name,
        storeProductId: String(id),
        brand,
        variant: [p.color, p.size].filter(Boolean).join(' / ') || undefined,
        title,
        currency: '₹',
        currentPrice: selling.price,
        originalPrice: original,
        discountRate: Math.round(((original - selling.price) / original) * 100),
        image: image!,
        category: p.category ?? 'General',
        description: p.description ?? '',
        isOutOfStock: !selling.availability.endsWith('/InStock'),
        stars: rating.success ? rating.data.ratingValue : 0,
        reviewsCount: rating.success ? (rating.data.reviewCount ?? 0) : 0,
      };
    },
  };
}

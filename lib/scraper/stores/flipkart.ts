import * as cheerio from 'cheerio';
import type { Offer } from '@/types';
import { extractPrice, parsePrice } from '../extract';
import { ScrapeError } from '../errors';
import { extractStructured } from '../structured';
import { env, isFlipkartAffiliateConfigured } from '@/lib/env';
import type { StoreAdapter } from './types';
import { z } from 'zod';
import { fetchFlipkartSearchJSON, fetchFlipkartProductJSON, fetchHtml } from '../http';
import { parseFlipkartAPIProduct } from './retail-product-json';
import { flipkartProductInput } from '../retail-product-input';
import { rememberFlipkartSearch } from '../flipkart-evidence';

const dedicatedResults = z.object({
  search_results: z.array(
    z.object({
      title: z.string().trim().min(1),
      url: z.string().url(),
      price: z.number().finite().positive(),
      image: z.string().url().optional(),
      product_id: z.string().trim().min(1),
    }),
  ),
});

export function parseFlipkartSearchAPI(body: string): Offer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ScrapeError('Flipkart Search API returned invalid JSON', 'parse');
  }
  const result = dedicatedResults.safeParse(raw);
  if (!result.success)
    throw new ScrapeError(
      'Flipkart Search API returned unsupported or invalid search data',
      'parse',
    );
  const offers = result.data.search_results.map((item) => {
    const url = new URL(item.url);
    if (
      url.protocol !== 'https:' ||
      !/^(www\.)?flipkart\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.includes('/p/') ||
      url.searchParams.getAll('pid').length !== 1 ||
      url.searchParams.get('pid') !== item.product_id
    )
      throw new ScrapeError(
        'Flipkart search URL/product identifier cannot be verified',
        'parse',
      );
    return {
      store: 'flipkart',
      storeName: 'Flipkart',
      title: item.title,
      url: canonicalUrl(item.url),
      price: item.price,
      currency: '₹',
      image: item.image,
      storeProductId: item.product_id,
    };
  });
  rememberFlipkartSearch(offers);
  return offers;
}

const dedicatedSearch: NonNullable<StoreAdapter['search']> = {
  regions: ['in'],
  enabled: () => Boolean(process.env.SCRAPINGDOG_API_KEY),
  url: (query) => `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`,
  load: fetchFlipkartSearchJSON,
  parse: parseFlipkartSearchAPI,
};

// Flipkart ships obfuscated class names that change periodically; keep current and legacy ones.
const SELECTORS = {
  title: 'h1 span.VU-ZEz, h1 span.B_NuCI, h1._6EBuvT span, h1',
  price: 'div.Nx9bqj.CxhGGd, div._30jeq3._16Jk6d, div.Nx9bqj',
  mrp: 'div.yRaY8j.A6\\+E6v, div._3I9_wc._2p6lqe, div.yRaY8j',
  image: 'img.DByuf4, img._396cs4, img._2r_T1I',
  rating: 'div.XQDdHH, div._3LWZlK',
  reviews: 'span.Wphh3N, span._2_R_DZ',
  soldOut: 'div.Z8JjpR, div._16FRp0',
  breadcrumbs: 'div.r2CdBx a, div._1MR4o5 a',
  highlights: 'li._7eSDEz, li._21Ahn-',
};

export function parseFlipkartProduct(html: string, url: string) {
  const $ = cheerio.load(html);
  const data = extractStructured($);

  const title =
    $(SELECTORS.title).first().text().replace(/\s+/g, ' ').trim() || data.title;
  if (!title)
    throw new ScrapeError(
      'Could not read the Flipkart page. It may be blocked or unavailable.',
      'blocked',
    );

  const current = extractPrice($(SELECTORS.price)) || data.price || 0;
  if (!Number.isFinite(current) || current <= 0)
    throw new ScrapeError('Flipkart returned no valid product price.', 'parse');
  const mrp = extractPrice($(SELECTORS.mrp)) || data.originalPrice || current;
  const original = Math.max(mrp, current);
  const crumbs = $(SELECTORS.breadcrumbs)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((c) => c && c.toLowerCase() !== 'home');
  const highlights = $(SELECTORS.highlights)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  return {
    url,
    store: 'flipkart',
    storeName: 'Flipkart',
    title,
    currency: '₹',
    image: $(SELECTORS.image).first().attr('src') || data.image || '',
    currentPrice: current,
    originalPrice: original,
    discountRate: original > 0 ? Math.round(((original - current) / original) * 100) : 0,
    category: crumbs.at(-2) || data.category || 'General',
    description: highlights.join('\n') || data.description || '',
    isOutOfStock: $(SELECTORS.soldOut).length > 0 || data.inStock === false,
    stars: parseFloat($(SELECTORS.rating).first().text()) || data.stars || 0,
    reviewsCount:
      Math.round(parsePrice($(SELECTORS.reviews).first().text())) ||
      data.reviewsCount ||
      0,
  };
}

type Money = { amount?: number; currency?: string };
type AffiliateProduct = {
  productBaseInfoV1?: {
    title?: string;
    productUrl?: string;
    imageUrls?: Record<string, string>;
    maximumRetailPrice?: Money;
    flipkartSellingPrice?: Money;
    flipkartSpecialPrice?: Money;
    inStock?: boolean;
  };
};

/** Canonical product URL (path + pid) from an affiliate deep link. */
function canonicalUrl(link: string) {
  const url = new URL(link, 'https://www.flipkart.com');
  const pid = url.searchParams.get('pid');
  const path = url.pathname.replace(/^\/dl(?=\/)/, '');
  return `https://www.flipkart.com${path}${pid ? `?pid=${pid}` : ''}`;
}

/**
 * Search results from Flipkart's official Affiliate API. Flipkart's
 * robots.txt asks crawlers not to fetch its search pages, so search only
 * runs through this API, when affiliate credentials are configured.
 */
export function parseFlipkartAffiliateSearch(body: string): Offer[] {
  let data: { products?: AffiliateProduct[] };
  try {
    data = JSON.parse(body);
  } catch {
    throw new ScrapeError('Flipkart returned an unreadable response', 'parse');
  }
  return (data.products ?? []).flatMap(({ productBaseInfoV1: info }) => {
    if (!info?.title || !info.productUrl || info.inStock === false) return [];
    const price =
      info.flipkartSpecialPrice?.amount || info.flipkartSellingPrice?.amount || 0;
    const mrp = info.maximumRetailPrice?.amount ?? 0;
    if (!price) return [];
    const images = info.imageUrls ?? {};
    return [
      {
        store: 'flipkart',
        storeName: 'Flipkart',
        title: info.title.replace(/\s+/g, ' ').trim(),
        url: canonicalUrl(info.productUrl),
        price,
        originalPrice: mrp > price ? mrp : undefined,
        currency: '₹',
        image: images['400x400'] ?? images['200x200'] ?? Object.values(images)[0],
      },
    ];
  });
}

const AFFILIATE_SEARCH = 'https://affiliate-api.flipkart.net/affiliate/1.0/search.json';

export const flipkart: StoreAdapter = {
  id: 'flipkart',
  name: 'Flipkart',
  // Plain HTTP requests receive an empty app shell without product data.
  fetchMode: 'browser',
  matches: (url) => /(^|\.)flipkart\.com$/i.test(url.hostname),
  normalize(url) {
    if (process.env.SCRAPINGDOG_API_KEY) return flipkartProductInput(url.toString()).url;
    const pid = url.searchParams.get('pid');
    return `https://www.flipkart.com${url.pathname}${pid ? `?pid=${pid}` : ''}`;
  },
  parse: parseFlipkartProduct,
  get productAPI() {
    return process.env.SCRAPINGDOG_API_KEY
      ? {
          matches: (url: URL) => {
            try {
              flipkartProductInput(url.toString());
              return true;
            } catch {
              return false;
            }
          },
          load: fetchFlipkartProductJSON,
          parse: parseFlipkartAPIProduct,
          fallback: {
            paid: true,
            load: fetchHtml,
            parse: (html: string, input: string) => {
              const target = flipkartProductInput(input);
              const $ = cheerio.load(html);
              const canonical = $('link[rel="canonical"]').attr('href');
              if (
                !canonical ||
                canonicalUrl(flipkartProductInput(canonical).url) !==
                  canonicalUrl(target.url)
              )
                throw new ScrapeError(
                  'Flipkart HTML fallback cannot verify canonical product identity',
                  'parse',
                );
              const structured = extractStructured($);
              if (structured.inStock === undefined)
                throw new ScrapeError('Flipkart HTML fallback stock is unknown', 'parse');
              const product = parseFlipkartProduct(html, target.url);
              if (!product.image.startsWith('https://'))
                throw new ScrapeError(
                  'Flipkart HTML fallback needs an HTTPS product image',
                  'parse',
                );
              return product;
            },
          },
        }
      : undefined;
  },
  get search() {
    if (process.env.SCRAPINGDOG_API_KEY)
      return {
        ...dedicatedSearch,
        ...(isFlipkartAffiliateConfigured
          ? {
              fallback: {
                paid: false,
                load: async (input: string) =>
                  fetchHtml(
                    `${AFFILIATE_SEARCH}?query=${encodeURIComponent(new URL(input).searchParams.get('q') ?? '')}&resultCount=10`,
                    {
                      'Fk-Affiliate-Id': env.FLIPKART_AFFILIATE_ID!,
                      'Fk-Affiliate-Token': env.FLIPKART_AFFILIATE_TOKEN!,
                      Accept: 'application/json',
                    },
                  ),
                parse: parseFlipkartAffiliateSearch,
              },
            }
          : {}),
      };
    return {
      regions: ['in' as const],
      enabled: () => isFlipkartAffiliateConfigured,
      url: (query: string) =>
        `${AFFILIATE_SEARCH}?query=${encodeURIComponent(query)}&resultCount=10`,
      parse: parseFlipkartAffiliateSearch,
      headers: () => ({
        'Fk-Affiliate-Id': env.FLIPKART_AFFILIATE_ID!,
        'Fk-Affiliate-Token': env.FLIPKART_AFFILIATE_TOKEN!,
        Accept: 'application/json',
      }),
    };
  },
};

import * as cheerio from 'cheerio';
import type { Offer } from '@/types';
import {
  extractCategory,
  extractCurrency,
  extractDescription,
  extractImage,
  extractPrice,
  extractRating,
  parsePrice,
} from '../extract';
import { ScrapeError } from '../errors';
import type { Region, StoreAdapter } from './types';
import { z } from 'zod';
import { fetchAmazonSearchJSON, fetchAmazonProductJSON, fetchHtml } from '../http';
import { parseAmazonAPIProduct } from './retail-product-json';
import { amazonIndiaProductInput } from '../retail-product-input';

const searchEnvelope = z.object({ results: z.array(z.unknown()) });
const dedicatedRow = z.object({
  type: z.literal('search_product'),
  title: z.string().trim().min(1),
  asin: z.string().regex(/^[A-Z0-9]{10}$/i),
  optimized_url: z.string().url(),
  extracted_price: z.unknown().optional(),
  price_string: z.unknown().optional(),
  price: z.unknown().optional(),
  currency: z.enum(['₹', 'INR']),
  image: z.string().url().optional(),
  sponsored: z.boolean(),
  availability_quantity: z.number().int().nonnegative().optional(),
});

function formattedINR(value: unknown): number | undefined {
  if (typeof value !== 'string') return;
  const match =
    /^(?:₹|INR)\s*((?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?)$/i.exec(
      value.trim(),
    );
  if (!match) return;
  const price = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Only the documented object envelope is supported; array snippets are ambiguous. */
export function parseAmazonSearchAPI(body: string): Offer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ScrapeError('Amazon Search API returned invalid JSON', 'parse');
  }
  const envelope = searchEnvelope.safeParse(raw);
  if (!envelope.success)
    throw new ScrapeError(
      'Amazon Search API returned unsupported response shape',
      'parse',
    );
  let invalid = 0;
  const offers: Offer[] = [];
  for (const value of envelope.data.results) {
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      typeof value.type === 'string' &&
      value.type !== 'search_product'
    )
      continue;
    const result = dedicatedRow.safeParse(value);
    if (!result.success) {
      invalid++;
      continue;
    }
    const row = result.data;
    if (row.sponsored || row.availability_quantity === 0) continue;
    const url = new URL(row.optimized_url);
    const asin = url.pathname
      .match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
      ?.toUpperCase();
    if (
      url.protocol !== 'https:' ||
      !/^(www\.)?amazon\.in$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      asin !== row.asin.toUpperCase()
    ) {
      invalid++;
      continue;
    }
    const price =
      typeof row.extracted_price === 'number' &&
      Number.isFinite(row.extracted_price) &&
      row.extracted_price > 0
        ? row.extracted_price
        : (formattedINR(row.price_string) ?? formattedINR(row.price));
    if (!price) {
      invalid++;
      continue;
    }
    let image: string | undefined;
    if (row.image) {
      const img = new URL(row.image);
      if (img.protocol === 'https:' && !img.username && !img.password && !img.port)
        image = img.toString();
    }
    offers.push({
      store: 'amazon',
      storeName: 'Amazon',
      title: row.title,
      url: `https://www.amazon.in/dp/${asin}`,
      storeProductId: asin,
      price,
      currency: '₹',
      image,
    });
  }
  // Mixed valid/invalid rows can still yield verified candidates. Do not silently
  // convert a wholly malformed product response into "no products found".
  if (invalid && !offers.length)
    throw new ScrapeError('Amazon Search API had no valid product listings', 'parse');
  return offers;
}

const HOST =
  /(^|\.)amazon\.(com|in|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|com\.mx|com\.br|nl|se|pl|sg|ae|sa)$/i;
const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i;
const DOMAINS: Record<Region, string> = {
  us: 'www.amazon.com',
  in: 'www.amazon.in',
  uk: 'www.amazon.co.uk',
  de: 'www.amazon.de',
};

export function parseAmazonProduct(html: string, url: string) {
  const $ = cheerio.load(html);

  const title = $('#productTitle').text().trim();
  if (!title) {
    throw new ScrapeError(
      'Could not read the product page. The store may have served a captcha.',
      'blocked',
    );
  }

  const currentPrice = extractPrice(
    $('.priceToPay .a-offscreen'),
    $('.priceToPay span.a-price-whole'),
    $('#corePrice_feature_div .a-offscreen'),
    $('#priceblock_dealprice'),
    $('#priceblock_ourprice'),
    $('.a-price .a-offscreen'),
  );
  const originalPrice = extractPrice(
    $('.basisPrice .a-offscreen'),
    $('.a-price.a-text-price span.a-offscreen'),
    $('#listPrice'),
    $('#priceblock_ourprice'),
  );

  const availability = $('#availability span').text().trim().toLowerCase();
  const current = currentPrice || originalPrice;
  const original = Math.max(originalPrice, current);

  return {
    url,
    store: 'amazon',
    storeName: 'Amazon',
    title,
    currency: extractCurrency($('.a-price-symbol')),
    image: extractImage($),
    currentPrice: current,
    originalPrice: original,
    discountRate: original > 0 ? Math.round(((original - current) / original) * 100) : 0,
    category: extractCategory($),
    description: extractDescription($),
    isOutOfStock:
      availability.includes('currently unavailable') ||
      availability.includes('out of stock'),
    ...extractRating($),
  };
}

/** Amazon's bot check: a captcha form instead of the requested page. */
export function isAmazonBotCheck($: cheerio.CheerioAPI) {
  return (
    $('form[action*="validateCaptcha"]').length > 0 ||
    /robot check|enter the characters you see below/i.test($('title, h4').text())
  );
}

export function parseAmazonSearch(html: string, pageUrl: string): Offer[] {
  const $ = cheerio.load(html);
  const origin = new URL(pageUrl).origin;
  // Raise instead of returning nothing so callers can retry in a real browser.
  if (isAmazonBotCheck($)) throw new ScrapeError('Amazon served a bot check', 'blocked');

  return $('[data-component-type="s-search-result"][data-asin]')
    .toArray()
    .flatMap((el) => {
      const item = $(el);
      const asin = item.attr('data-asin');
      // Brand and title can sit in separate elements; join text nodes with spaces.
      const title = item
        .find('h2')
        .find('*')
        .addBack()
        .contents()
        .filter((_, node) => node.type === 'text')
        .map((_, node) => $(node).text().trim())
        .get()
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');
      const price = parsePrice(item.find('.a-price .a-offscreen').first().text());
      const listPrice = parsePrice(
        item.find('.a-price.a-text-price .a-offscreen').first().text(),
      );
      if (!asin || !title || !price || item.find('.puis-sponsored-label-text').length)
        return [];
      return [
        {
          store: 'amazon',
          storeName: 'Amazon',
          title,
          url: `${origin}/dp/${asin}`,
          price,
          originalPrice: listPrice > price ? listPrice : undefined,
          currency: item.find('.a-price-symbol').first().text().trim() || '$',
          image: item.find('img.s-image').attr('src'),
        },
      ];
    });
}

/** Ranked items from an Amazon Best Sellers page, read by structure. */
export function parseAmazonBestsellers(
  html: string,
  pageUrl: string,
): (Offer & { rank: number })[] {
  const $ = cheerio.load(html);
  if (isAmazonBotCheck($)) throw new ScrapeError('Amazon served a bot check', 'blocked');
  const origin = new URL(pageUrl).origin;

  return $('[id^="gridItemRoot"]')
    .toArray()
    .flatMap((el, index) => {
      const item = $(el);
      const href = item.find('a[href*="/dp/"]').first().attr('href') ?? '';
      const asin = href.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
      const title = item.find('img[alt]').first().attr('alt')?.trim();
      const priceText = item
        .find('*')
        .filter(
          (_, n) =>
            $(n).children().length === 0 &&
            /^₹\s?[\d,]+(\.\d+)?$/.test($(n).text().trim()),
        )
        .first()
        .text();
      const price = parsePrice(priceText);
      if (!asin || !title || !price) return [];
      const rank =
        Number(item.find('.zg-bdg-text').text().replace(/\D/g, '')) || index + 1;
      return [
        {
          store: 'amazon',
          storeName: 'Amazon',
          title,
          url: `${origin}/dp/${asin}`,
          price,
          currency: '₹',
          image: item.find('img').first().attr('src'),
          rank,
        },
      ];
    });
}

export const amazon: StoreAdapter = {
  id: 'amazon',
  name: 'Amazon',
  matches: (url) => HOST.test(url.hostname),
  normalize(url) {
    if (process.env.SCRAPINGDOG_API_KEY && /^(www\.|m\.)?amazon\.in$/.test(url.hostname))
      return amazonIndiaProductInput(url.toString()).url;
    const asin = url.pathname.match(ASIN)?.[1];
    return asin
      ? `https://${url.hostname.toLowerCase()}/dp/${asin.toUpperCase()}`
      : url.toString();
  },
  parse: parseAmazonProduct,
  get productAPI() {
    return process.env.SCRAPINGDOG_API_KEY
      ? {
          matches: (url: URL) =>
            /^(www\.|m\.)?amazon\.in$/.test(url.hostname) &&
            /\/(dp|gp\/product|gp\/aw\/d)\//.test(url.pathname),
          load: fetchAmazonProductJSON,
          parse: parseAmazonAPIProduct,
          fallback: {
            paid: true,
            load: fetchHtml,
            parse: (html: string, input: string) => {
              const target = amazonIndiaProductInput(input);
              const $ = cheerio.load(html);
              if (String($('#ASIN').attr('value') ?? '').toUpperCase() !== target.asin)
                throw new ScrapeError(
                  'Amazon HTML fallback cannot verify selected ASIN',
                  'parse',
                );
              if (!/^in stock\.?$/i.test($('#availability').text().trim()))
                throw new ScrapeError(
                  'Amazon HTML fallback stock is unknown or unavailable',
                  'parse',
                );
              const p = parseAmazonProduct(html, target.url);
              if (
                p.currency !== '₹' ||
                !Number.isFinite(p.currentPrice) ||
                p.currentPrice <= 0
              )
                throw new ScrapeError(
                  'Amazon HTML fallback has no valid INR selling price',
                  'parse',
                );
              return { ...p, storeProductId: target.asin };
            },
          },
        }
      : undefined;
  },
  get search() {
    if (process.env.SCRAPINGDOG_API_KEY)
      return {
        regions: ['us', 'in', 'uk', 'de'] as Region[],
        url: (query: string, region: Region) =>
          `https://${DOMAINS[region]}/s?k=${encodeURIComponent(query)}`,
        load: (input: string) => {
          const url = new URL(input);
          if (
            !Object.values(DOMAINS).includes(url.hostname) ||
            url.protocol !== 'https:' ||
            url.pathname !== '/s' ||
            url.username ||
            url.password ||
            url.port ||
            !url.searchParams.get('k')
          )
            throw new ScrapeError('Invalid Amazon search URL', 'disallowed');
          if (
            url.hostname === 'www.amazon.in' &&
            url.pathname === '/s' &&
            url.searchParams.get('k')
          )
            return fetchAmazonSearchJSON(url.searchParams.get('k')!);
          if (
            !Object.values(DOMAINS).includes(url.hostname) ||
            url.protocol !== 'https:' ||
            url.pathname !== '/s' ||
            url.username ||
            url.password ||
            url.port
          )
            throw new ScrapeError('Invalid Amazon search URL', 'disallowed');
          return fetchHtml(input);
        },
        parse: (body: string, pageUrl: string) =>
          new URL(pageUrl).hostname === 'www.amazon.in'
            ? parseAmazonSearchAPI(body)
            : parseAmazonSearch(body, pageUrl),
        fallback: { paid: true, load: fetchHtml, parse: parseAmazonSearch },
      };
    return {
      regions: ['us', 'in', 'uk', 'de'] as Region[],
      url: (query: string, region: Region) =>
        `https://${DOMAINS[region]}/s?k=${encodeURIComponent(query)}`,
      parse: parseAmazonSearch,
    };
  },
};
